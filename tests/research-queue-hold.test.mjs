// ============================================================
// 🧪 tests/research-queue-hold.test.mjs — คิวชะลอหยิบงานจนรีเสิร์ชเสร็จ (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3)
// ------------------------------------------------------------
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3) — ไฟล์ใหม่
//   A. src/lib/research-agent/queueHold.js — getResearchHoldMs (ค่าเริ่มต้น WAIT_MS(write)+60000 · เพดาน 600000 · 0 = ปิด)
//      filterResearchHeld กับที่เก็บปลอม + นาฬิกา/timer ปลอม: queued/leased = hold · done/failed/expired/ไม่มีแถว/อายุครบ/
//      เลย deadlineAt/worker ออฟไลน์/แถวผิดรูป/เวลาล้ำอนาคต/ไม่ใช่งานข่าว = ไม่ hold · ปิดสวิตช์/shadow/assist/HOLD_MS=0 = ไม่แตะ
//      ที่เก็บ ไม่ import store · ที่เก็บโยน/ช้าเกิน 3 วิ = ไม่ hold (fail-open) · log 1 บรรทัด/รอบ · ลำดับคงเดิม · เพดานตรวจ 20 งาน
//      · ที่เก็บตัวจริง (store.js · แถว rreq_<jobId>) ผ่าน Supabase ปลอม
//   B. getNextPendingJobs ตัวจริง (src/lib/services/queueService.js · persistStore/supabase/uuid ปลอม · claim ผ่าน CAS ปลอม):
//      hold ข้ามงานแรกแล้วหยิบงานถัดไป (งานที่ hold ยัง pending · ไม่นับ processing) · ตัวช่วยได้งาน pending "ทั้งหมด" ·
//      ทุกงาน hold = ไม่หยิบ → ใบขอเสร็จรอบถัดไปหยิบตามลำดับ · ตัวช่วยล้ม/คืนของแปลก/อ่านค้าง = หยิบตามเดิม ·
//      ปิดสวิตช์/shadow/assist = ผลเท่าซอร์สที่ถอด hook ทุกไบต์ (งานที่หยิบ · แถว · log · คำสั่งฐาน) + ไม่เรียก/ไม่ import ตัวช่วย
//   C. GET /api/queue/status ตัวจริง — researchHold {heldMs, maxMs} เฉพาะงาน pending ที่ hold · ช่องอื่นเท่าซอร์สที่ถอด hook ·
//      ไม่ hold/ล้ม/ไม่ใช่ pending/ปิดสวิตช์ = คำตอบเท่าซอร์สที่ถอด hook ทุกไบต์
//   D. discord-bot/index.js pollJobUntilDone — "⏳ กำลังค้นคว้าก่อนเขียน (x/y นาที)" แก้เมื่อตัวเลขเปลี่ยน · ไม่ปลุก worker ระหว่าง
//      hold (ปลุกทันทีเมื่อ hold จบ) · ยืดเวลารอผลเท่าเพดาน hold (บีบ ≤ 10 นาที) · ไม่มีช่อง/ช่องผิดรูป = ข้อความ/คำขอ/log/timer
//      เท่าซอร์สที่ถอด hook ทุกไบต์
//   E. mutation 15 แบบ — ข้อสอบต้องแดงทุกแบบ ของจริงเขียว
// ไม่มี timer จริง: ตัวช่วยใช้ timer ฉีด (เทสยิงเอง) · บอทใช้นาฬิกาเสมือน · ไม่ unref · settleWithin กันค้าง (tests/helpers/fake-deadline.mjs)
// ไม่ต่อเน็ต · ไม่แตะ DB จริง · ไม่เขียนไฟล์ใน repo (ซอร์สที่ถอด hook/กลายพันธุ์โหลดผ่าน data: URL)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { settleWithin } from './helpers/fake-deadline.mjs';
import { importSource, installResearchHooks, replaceOnce, ROOT, srcUrl } from './helpers/research-web-fakes.mjs';

// ── hook โมดูล: '@/…' → ไฟล์จริงใต้ src หรือตัวปลอม · 'uuid' ปลอม (attemptId คงที่) ───────────────────────
const SB_STUB = 'export const isSupabaseReady = () => globalThis.__QH.sbReady !== false; export const getSupabase = () => globalThis.__QH.sb;';
const hooks = installResearchHooks({
  stubs: {
    '@/lib/supabase': SB_STUB,
    '@/lib/persistStore': 'export const createStore = (...a) => globalThis.__QH.createStore(...a);',
    '@/lib/services/queueService': [
      'export const getJobStatus = (...a) => globalThis.__QH.getJobStatus(...a);',
      'export const getQueueOverview = (...a) => globalThis.__QH.getQueueOverview(...a);',
      'export const cleanupStaleJobs = (...a) => globalThis.__QH.cleanupStaleJobs(...a);',
    ].join('\n'),
    '@/lib/logger': 'export const createLogger = (name) => new Proxy({}, { get: (_, level) => (...a) => globalThis.__QH.routeLogs.push(`${name}:${String(level)}:${a.join(" ")}`) });',
    uuid: 'export const v4 = () => globalThis.__QH.uuid();',
  },
  parentStubs: [{ specifier: '../supabase.js', parentEndsWith: '/lib/services/queueService.js', source: SB_STUB }],
});

// '@/lib/research-agent/queueHold' (ที่ queueService/route dynamic import) → ตัวห่อของจริง: จดการเรียก + ฉีดนาฬิกา/timer ปลอม
//   (globalThis.__QH.holdOpts) · applyImpl/infoImpl = แทนตัวช่วยเพื่อทดสอบ fail-open ฝั่งผู้เรียก
const HOLD_FILE_URL = srcUrl('lib/research-agent/queueHold.js');
const HOLD_WRAPPER = [
  `import * as real from ${JSON.stringify(HOLD_FILE_URL)};`,
  `export * from ${JSON.stringify(HOLD_FILE_URL)};`,
  'const extra = () => globalThis.__QH.holdOpts || {};',
  'export async function applyResearchHold(jobs, options = {}) {',
  '  globalThis.__QH.holdCalls.push({ fn: "applyResearchHold", ids: Array.isArray(jobs) ? jobs.map((j) => j && j.id) : null });',
  '  if (globalThis.__QH.applyImpl) return globalThis.__QH.applyImpl(jobs, options);',
  '  return real.applyResearchHold(jobs, { ...options, ...extra() });',
  '}',
  'export async function getResearchHoldInfo(job, options = {}) {',
  '  globalThis.__QH.holdCalls.push({ fn: "getResearchHoldInfo", id: job && job.id });',
  '  if (globalThis.__QH.infoImpl) return globalThis.__QH.infoImpl(job, options);',
  '  return real.getResearchHoldInfo(job, { ...options, ...extra() });',
  '}',
].join('\n');
hooks.overrides.set('@/lib/research-agent/queueHold', `data:text/javascript,${encodeURIComponent(HOLD_WRAPPER)}`);

// queueService ตั้ง setInterval 60 วิ (watchdog) ตอนโหลดถ้ายังไม่มี — กันไว้ก่อน import (ไม่มี timer จริงในเทส)
globalThis.__queueWatchdog = globalThis.__queueWatchdog || 'disabled-in-test';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SRC = Object.freeze({
  hold: read('src/lib/research-agent/queueHold.js'),
  queue: read('src/lib/services/queueService.js'),
  status: read('src/app/api/queue/status/route.js'),
  bot: read('discord-bot/index.js'),
  env: read('.env.example'),
  doc: read('docs/RESEARCH-AGENT.md'),
  suite: read('tests/news-suite.json'),
});

const holdMod = await import(HOLD_FILE_URL);
const storeMod = await import(srcUrl('lib/research-agent/store.js'));
const modesMod = await import(srcUrl('lib/research-agent/modes.js'));
const queueMod = await import(srcUrl('lib/services/queueService.js'));
const statusRoute = await import(srcUrl('app/api/queue/status/route.js'));

// ── ค่าคงที่/ของปลอมร่วม ─────────────────────────────────────────────
const NOW = Date.UTC(2026, 9, 1, 5, 0, 0); // 12:00 เวลาไทย
const SEC = 1000;
const MIN = 60 * SEC;
const WRITE = Object.freeze({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'write' });
const iso = (ms) => new Date(ms).toISOString();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const flush = () => new Promise((resolve) => setImmediate(resolve));
let seq = 0;
const tag = (name) => `${name}-${++seq}`;

function newsJob(id, minutesAgo, extra = {}) {
  return {
    id, userId: 'discord-bot', payload: { input: `ข่าวทดสอบ ${id}`, jobType: 'news' }, status: 'pending', attemptId: null,
    position: 1, result: null, error: null, createdAt: iso(NOW - minutesAgo * MIN), startedAt: null, completedAt: null, ...extra,
  };
}
const coverJob = (id, minutesAgo) => ({ ...newsJob(id, minutesAgo), payload: { input: 'ปก', jobType: 'cover' } });

/** ใบขอค้นคว้ารูปสัญญา 2.1 (buildResearchRequest) — ageMs = อายุ ณ NOW */
function researchRequest(jobId, { status = 'queued', ageMs = 45 * SEC, deadlineMin = 15, ...extra } = {}) {
  const created = NOW - ageMs;
  return {
    id: jobId, workflowId: `unify_${jobId}`, rawText: 'เนื้อข่าว', sourceUrls: [], userId: 'discord-bot', status,
    attempt: status === 'queued' ? 0 : 1, createdAt: iso(created), deadlineAt: iso(created + deadlineMin * MIN), revision: 1, ...extra,
  };
}
const workerSeen = (agoMs, workerId = 'w-main') => ({ id: workerId, workerId, lastSeenAt: iso(NOW - agoMs), lastEvent: 'lease', revision: 2 });

/** timer ปลอม: เทสยิงเอง · จด args ไว้พิสูจน์ว่าไม่ขอ background/unref */
function fakeTimers() {
  const live = new Set();
  const created = [];
  return {
    setTimer(fn, ms, ...rest) { const t = { fn, ms, rest }; live.add(t); created.push(t); return t; },
    clearTimer(t) { live.delete(t); },
    pending: () => live.size,
    created,
    fireAll() { const list = [...live]; live.clear(); for (const t of list) t.fn(); return list.length; },
  };
}

/** ที่เก็บปลอมระดับ createResearchStorage (getRequest/listWorkers) */
function fakeStorage({ requests = {}, workers = [workerSeen(20 * SEC)] } = {}) {
  const calls = [];
  return {
    calls,
    async getRequest(jobId) { calls.push(['getRequest', jobId]); return Object.hasOwn(requests, jobId) ? clone(requests[jobId]) : null; },
    async listWorkers(opts) { calls.push(['listWorkers', clone(opts)]); return clone(workers); },
  };
}

/**
 * โลกปลอม: ตาราง store_items ในหน่วยความจำ (job_queue + research-requests + research-workers) · Supabase ปลอมที่รองรับทั้ง
 * claim แบบ CAS ของ queueService (single/filter) และ getDoc/listDocs ของ store.js (maybeSingle/order/limit)
 * failResearch: 'throw' | 'hang' = อ่าน store research-* ล้ม/ค้าง · timers = timer ปลอมที่ตัวช่วยใช้ (ผ่าน holdOpts)
 */
function makeWorld({ jobs = [], requests = [], workers = [workerSeen(20 * SEC)] } = {}) {
  const rows = new Map();
  const calls = [];
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
    rows, calls, failResearch: null, timers: fakeTimers(),
    job: (id) => clone(rows.get(id)?.data ?? null),
    setRequest(jobId, patch) { Object.assign(rows.get(`rreq_${jobId}`).data, clone(patch)); },
    snapshot: () => [...rows.values()].map((r) => clone(r)),
  };
  function exec(st) {
    calls.push({ op: st.op, eqs: clone(st.eqs) });
    const storeName = st.eqs.find(([col]) => col === 'store_name')?.[1];
    if (world.failResearch && String(storeName || '').startsWith('research-')) {
      if (world.failResearch === 'hang') return new Promise(() => {});
      throw new Error('SECRET transport failure');
    }
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
    async getAll() { return [...rows.values()].filter((r) => r.store_name === 'job_queue').map((r) => clone(r.data)); },
    async findById(id) { const r = rows.get(id); return r && r.store_name === 'job_queue' ? clone(r.data) : null; },
    async update(id, fn) { const r = rows.get(id); const next = fn(clone(r.data)); r.data = clone(next); return clone(next); },
    async add(item) { rows.set(item.id, { id: item.id, store_name: 'job_queue', data: clone(item) }); return item; },
    async remove(id) { rows.delete(id); },
  };
  return world;
}

/** สถานะร่วมของ stub ('@/lib/supabase' · persistStore · uuid · queueService ของ route · ตัวห่อ queueHold) */
function freshState(world, extra = {}) {
  let n = 0;
  const state = {
    sb: world.sb, sbReady: true, createStore: () => world.queueStore, uuid: () => `attempt-${++n}`,
    holdOpts: { now: () => NOW, timers: world.timers }, holdCalls: [], routeLogs: [], applyImpl: null, infoImpl: null,
    getJobStatus: async () => null,
    getQueueOverview: async () => ({ pending: 0, processing: 1, total: 1, busy: true, estimatedWaitMinutes: 3 }),
    cleanupStaleJobs: async () => 0,
    ...extra,
  };
  globalThis.__QH = state;
  return state;
}

const ENV_KEYS = ['RESEARCH_AGENT', 'RESEARCH_AGENT_MODE', 'RESEARCH_AGENT_HOLD_MS', 'RESEARCH_AGENT_WAIT_MS', 'QUEUE_LOCAL_NEWS',
  'QUEUE_ATOMIC_CLAIM', 'QUEUE_COVER_ON_VERCEL'];
/** ตั้ง env เฉพาะรอบนี้ (QUEUE_LOCAL_NEWS=1 = งานข่าวหยิบได้ทั้งบน Windows และ CI ubuntu) แล้วคืนค่าเดิมเสมอ */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { QUEUE_LOCAL_NEWS: '1' }, vars);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
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

// ── ซอร์สที่ถอด hook W3 (ฉบับก่อนแก้ทุกไบต์) + ตัวโหลดสำเนา ──────────────────────────────────
const QUEUE_HOOK_START = '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3): คิวชะลอหยิบงานข่าว';
const QUEUE_HOOK_END = '    const pendingJobs = _pickable.slice(0, availableSlots);\n';
const QUEUE_ORIGINAL = [
  '    const pendingJobs = allJobs',
  "      .filter(j => j.status === 'pending' && canRunHere(j))",
  '      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))',
  '      .slice(0, availableSlots);',
  '',
].join('\n');
function stripQueueHook(src) {
  const a = src.indexOf(QUEUE_HOOK_START);
  const b = src.indexOf(QUEUE_HOOK_END);
  assert.ok(a > 0 && b > a && src.indexOf(QUEUE_HOOK_START, a + 1) === -1, 'hook W3 ใน queueService ต้องเจอครั้งเดียว');
  const out = src.slice(0, a) + QUEUE_ORIGINAL + src.slice(b + QUEUE_HOOK_END.length);
  assert.ok(!/research-agent|_pickable|_raEnv/.test(out), 'ถอดแล้วต้องไม่เหลือร่องรอย W3');
  return out;
}
const queueImportable = (src) => replaceOnce(src, "from '../supabase.js';", "from '@/lib/supabase';", 'queueService supabase import');
const loadQueueCopy = (src, name) => importSource(queueImportable(src), tag(name));

const ROUTE_HOOK_START = '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3): งาน pending ที่คิวชะลอ';
const ROUTE_HOOK_END = '      : null;\n\n';
const ROUTE_FIELD_NOW = "      completedAt: jobStatus.completedAt,\n      ...(researchHold ? { researchHold } : {}), // ★ W3 — ของเดิม: completedAt เป็นช่องสุดท้าย (ไม่มีช่องนี้)\n";
const ROUTE_FIELD_BEFORE = '      completedAt: jobStatus.completedAt\n';
function stripRouteHook(src) {
  const a = src.indexOf(ROUTE_HOOK_START);
  const b = src.indexOf(ROUTE_HOOK_END, a);
  assert.ok(a > 0 && b > a, 'hook W3 ใน queue/status ต้องเจอ');
  const out = replaceOnce(src.slice(0, a) + src.slice(b + ROUTE_HOOK_END.length), ROUTE_FIELD_NOW, ROUTE_FIELD_BEFORE, 'route field');
  assert.ok(!/researchHold|research-agent|_raEnv/.test(out), 'ถอดแล้วต้องไม่เหลือร่องรอย W3');
  return out;
}

// บอท: บล็อกที่ W3 เติม/แก้ใน discord-bot/index.js (ตรงทุกไบต์) — [ปัจจุบัน, ก่อนแก้]
const BOT_W3_EDITS = [
  [[
    '// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3): ช่อง researchHold ของ /api/queue/status (คิวชะลอหยิบงานรอรีเสิร์ช)',
    '//   {heldMs, maxMs} เป็นตัวเลขถูกรูป → {heldMs, maxMs} (บีบเพดาน 10 นาที = เพดาน hold ฝั่งเว็บ กันค่าเพี้ยนยืดเวลารอไม่รู้จบ)',
    '//   ไม่มี/ผิดรูป = null → บอทใช้ข้อความ/การปลุก worker/เวลารอเดิมทุกไบต์',
    'const QUEUE_HOLD_MAX_MS = 10 * 60 * 1000;',
    'function queueResearchHold(raw) {',
    "  if (!raw || typeof raw !== 'object') return null;",
    '  const { heldMs, maxMs } = raw;',
    "  if (typeof heldMs !== 'number' || typeof maxMs !== 'number' || !Number.isFinite(heldMs) || !Number.isFinite(maxMs)) return null;",
    '  if (heldMs < 0 || maxMs <= 0) return null;',
    '  const cap = Math.min(maxMs, QUEUE_HOLD_MAX_MS);',
    '  return { heldMs: Math.min(heldMs, cap), maxMs: cap };',
    '}',
    '',
    '',
  ], ['']],
  [[
    "    let notFoundCount = 0; // ★ Track consecutive 'job not found'",
    '    // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3): คิวชะลอหยิบงานรอรีเสิร์ช — สถานะคิวตอบ researchHold',
    '    //   ระหว่างงาน pending ถูก hold → ข้อความรอ "⏳ กำลังค้นคว้าก่อนเขียน (x/y นาที)" · ไม่ปลุก worker เปล่าระหว่าง hold',
    '    //   · ยืดเวลารอผลเท่าเพดาน hold ที่เห็น (hold ≤ 10 นาที + ท่อ ≤ ~13 นาที เกิน 15 นาทีเดิมได้ — ไม่ยืด = บอทตัดว่าหมดเวลา',
    '    //   ทั้งที่งานยังเดิน → พนักงานส่งซ้ำ = เจนเบิ้ล) · ไม่มีช่องนี้ (ปิดสวิตช์/โหมดอื่น) = เดิมทุกไบต์',
    '    let holdExtraMs = 0;',
    "    let lastHoldText = '';",
    '',
    '    while (Date.now() - pollStartTime < maxPollTime + holdExtraMs) { // ★ W3 ของเดิม: while (Date.now() - pollStartTime < maxPollTime) {',
  ], [
    "    let notFoundCount = 0; // ★ Track consecutive 'job not found'",
    '',
    '    while (Date.now() - pollStartTime < maxPollTime) {',
  ]],
  [[
    '        notFoundCount = 0; // reset on success',
    "        const hold = st.status === 'pending' ? queueResearchHold(st.researchHold) : null; // ★ W3: null = ไม่ได้ถูกชะลอ (ทางเดิม)",
    '',
    '        // === Fallback: re-trigger worker if still pending after 10s ===',
    '        // ★ W3: + !hold — งานที่ถูกชะลอ ปลุกไปก็ถูกข้าม (เก็บโควตาปลุก 3 ครั้งไว้ปลุกทันทีเมื่อ hold จบ)',
    "        //   ของเดิม: if (st.status === 'pending' && (Date.now() - pollStartTime > 10000) && workerRetriggerCount < 3) {",
    "        if (st.status === 'pending' && !hold && (Date.now() - pollStartTime > 10000) && workerRetriggerCount < 3) {",
  ], [
    '        notFoundCount = 0; // reset on success',
    '',
    '        // === Fallback: re-trigger worker if still pending after 10s ===',
    "        if (st.status === 'pending' && (Date.now() - pollStartTime > 10000) && workerRetriggerCount < 3) {",
  ]],
  [[
    '        if (hold) { // ★ W3: กำลังชะลอรอรีเสิร์ช → แก้ข้อความเมื่อตัวเลขเปลี่ยน (ไม่สแปม Discord) · ยืดเวลารอเท่าเพดาน hold',
    '          holdExtraMs = Math.max(holdExtraMs, hold.maxMs);',
    '          const holdText = `⏳ กำลังค้นคว้าก่อนเขียน (${Math.floor(hold.heldMs / 60000)}/${Math.ceil(hold.maxMs / 60000)} นาที)`;',
    "          if (lastStatus !== 'research_hold' || holdText !== lastHoldText) {",
    '            await processingMsg.edit(holdText).catch(() => {});',
    '            lastHoldText = holdText;',
    '          }',
    "          lastStatus = 'research_hold';",
    '          continue;',
    '        }',
    '',
    "        if (st.status === 'pending' && st.status !== lastStatus) {",
  ], [
    "        if (st.status === 'pending' && st.status !== lastStatus) {",
  ]],
];
function stripBotHook(src) {
  let out = src;
  for (const [now, before] of BOT_W3_EDITS) out = replaceOnce(out, now.join('\n'), before.join('\n'), `bot W3: ${now.find((l) => l.trim()).slice(0, 50)}`);
  assert.ok(!/researchHold|queueResearchHold|holdExtraMs|research_hold/.test(out), 'ถอดแล้วต้องไม่เหลือร่องรอย W3');
  return out;
}

// ============================================================
// A. queueHold.js
// ============================================================
async function checkHoldMs(m) {
  assert.equal(m.getResearchHoldMs({}), 360_000, 'ไม่ตั้ง = WAIT_MS(write 300000) + 60000');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_WAIT_MS: '120000' }), 180_000, 'ตาม WAIT_MS ที่ตั้ง + 60000');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_WAIT_MS: '999999' }), 360_000, 'WAIT_MS ถูกบีบเพดาน write 300000 ก่อน');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_HOLD_MS: '0' }), 0, '0 = ปิด');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_HOLD_MS: '90000' }), 90_000);
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_HOLD_MS: ' "120000" ' }), 120_000, 'ทนเครื่องหมายคำพูด/space แบบ modes.js');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_HOLD_MS: '9999999' }), 600_000, 'เพดาน 600000');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_HOLD_MS: '-5' }), 0, 'ติดลบ = 0 (ปิด · ทิศปลอดภัย)');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_HOLD_MS: 'abc' }), 360_000, 'อ่านไม่ได้ = ค่าเริ่มต้น');
  assert.equal(m.getResearchHoldMs({ RESEARCH_AGENT_HOLD_MS: '' }), 360_000);
  assert.equal(m.isResearchHoldOn({}), false);
  assert.equal(m.isResearchHoldOn({ RESEARCH_AGENT: '1' }), false, 'shadow');
  assert.equal(m.isResearchHoldOn({ RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }), false);
  assert.equal(m.isResearchHoldOn({ RESEARCH_AGENT: '0', RESEARCH_AGENT_MODE: 'write' }), false);
  assert.equal(m.isResearchHoldOn(WRITE), true);
  assert.equal(m.isResearchHoldOn({ ...WRITE, RESEARCH_AGENT_HOLD_MS: '0' }), false);
}

/** งานหนึ่งตัวกับแถวใบขอหนึ่งแบบ → ผล filterResearchHeld */
async function heldFor(m, row, { env = WRITE, workers, now = NOW } = {}) {
  const job = newsJob('q_case01', 1);
  const storage = fakeStorage({ requests: row === undefined ? {} : { q_case01: row }, ...(workers ? { workers } : {}) });
  const out = await m.filterResearchHeld([job], { env, now: () => now, loadStorage: async () => storage, log: null, timers: fakeTimers() });
  return { out, storage };
}

async function checkHoldCases(m) {
  const yes = async (label, row, opts) => {
    const { out } = await heldFor(m, row, opts);
    assert.equal(out.held.length, 1, `${label}: ต้อง hold`);
    assert.equal(out.ready.length, 0, `${label}: ready ต้องว่าง`);
  };
  const no = async (label, row, opts) => {
    const { out } = await heldFor(m, row, opts);
    assert.equal(out.held.length, 0, `${label}: ต้องไม่ hold`);
    assert.equal(out.ready.length, 1, `${label}: ต้องหยิบได้`);
  };
  await yes('queued สด + worker ออนไลน์', researchRequest('q_case01'));
  await yes('leased สด', researchRequest('q_case01', { status: 'leased' }));
  await yes('leased ไม่ต้องดูชีพจร (มี worker หยิบแล้ว)', researchRequest('q_case01', { status: 'leased' }), { workers: [] });
  // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): worker ตายกลางงาน — leased ที่ชีพจรขาด > 150 วิ = ไม่ hold
  //   (now − (heartbeatAt ?? leasedAt) · อายุใบขอ 4 นาที < HOLD_MS 6 นาที = ถ้าไม่ดูชีพจรจะ hold)
  const beat = (agoMs, extra = {}) => researchRequest('q_case01', {
    status: 'leased', ageMs: 4 * MIN, leasedAt: iso(NOW - 4 * MIN), heartbeatAt: iso(NOW - agoMs), ...extra,
  });
  await no('leased ชีพจรขาด 151 วิ (worker ตายกลางงาน)', beat(151 * SEC));
  await yes('leased ชีพจรขาด 150 วิพอดี = ยัง hold', beat(150 * SEC));
  await yes('leased ชีพจรสด 20 วิ แม้ leasedAt เก่า 4 นาที (heartbeatAt ชนะ)', beat(20 * SEC));
  await no('leased ไม่มี heartbeatAt + leasedAt เก่า 4 นาที (นับจาก leasedAt)', beat(0, { heartbeatAt: undefined }));
  for (const status of ['done', 'failed', 'expired', 'weird']) await no(`status ${status}`, researchRequest('q_case01', { status }));
  await no('ไม่มีแถว', undefined);
  await no('อายุครบ hold พอดี (360 วิ)', researchRequest('q_case01', { ageMs: 360 * SEC }));
  await yes('อายุ 360 วิ − 1ms', researchRequest('q_case01', { ageMs: 360 * SEC - 1 }));
  await no('เลย deadlineAt (เส้นตายใบขอ 1 นาที อายุ 2 นาที)', researchRequest('q_case01', { ageMs: 2 * MIN, deadlineMin: 1 }));
  await no('queued + worker ออฟไลน์ (ชีพจรล่าสุด 11 นาที)', researchRequest('q_case01'), { workers: [workerSeen(11 * MIN)] });
  await no('queued + ไม่มี worker เลย', researchRequest('q_case01'), { workers: [] });
  await yes('queued + ชีพจรล่าสุด 9 นาที', researchRequest('q_case01'), { workers: [workerSeen(9 * MIN)] });
  await no('แถวเป็น array', []);
  await no('แถวเป็นข้อความ', 'queued');
  await no('ไม่มี createdAt', { ...researchRequest('q_case01'), createdAt: undefined });
  await no('createdAt อ่านไม่ได้', { ...researchRequest('q_case01'), createdAt: 'เมื่อวาน' });
  await no('createdAt ล้ำอนาคต 2 นาที (เวลาเพี้ยน — กัน hold ไม่รู้จบ)', researchRequest('q_case01', { ageMs: -2 * MIN }));
  const skew = await heldFor(m, researchRequest('q_case01', { ageMs: -30 * SEC }));
  assert.deepEqual(skew.out.held, [{ jobId: 'q_case01', ageMs: 0 }], 'นาฬิกาคลาด ≤ 60 วิ = อายุ 0 ยัง hold');
  await no('HOLD_MS=0 = ปิด', researchRequest('q_case01'), { env: { ...WRITE, RESEARCH_AGENT_HOLD_MS: '0' } });
  await yes('HOLD_MS=120000 อายุ 45 วิ', researchRequest('q_case01'), { env: { ...WRITE, RESEARCH_AGENT_HOLD_MS: '120000' } });
  await no('HOLD_MS=30000 อายุ 45 วิ', researchRequest('q_case01'), { env: { ...WRITE, RESEARCH_AGENT_HOLD_MS: '30000' } });
}

async function checkReadyOrderAndLog(m) {
  const jobs = [newsJob('q_hold01', 5), newsJob('q_free02', 4), coverJob('q_cover3', 3), newsJob('q_hold04', 2), newsJob('q_none05', 1),
    { ...newsJob('bad id!', 0) }];
  const storage = fakeStorage({ requests: {
    q_hold01: researchRequest('q_hold01', { ageMs: 45 * SEC }),
    q_free02: researchRequest('q_free02', { status: 'done' }),
    q_cover3: researchRequest('q_cover3'),
    q_hold04: researchRequest('q_hold04', { status: 'leased', ageMs: 130 * SEC }),
  } });
  const lines = [];
  const out = await m.filterResearchHeld(jobs, { env: WRITE, now: () => NOW, loadStorage: async () => storage, log: (l) => lines.push(l), timers: fakeTimers() });
  assert.deepEqual(out.ready.map((j) => j.id), ['q_free02', 'q_cover3', 'q_none05', 'bad id!'], 'ลำดับเดิม ตัดเฉพาะงานที่ hold');
  assert.ok(out.ready.every((j) => jobs.includes(j)), 'คืนวัตถุงานตัวเดิม (ไม่ clone)');
  assert.deepEqual(out.held, [{ jobId: 'q_hold01', ageMs: 45_000 }, { jobId: 'q_hold04', ageMs: 130_000 }]);
  assert.equal(out.holdMs, 360_000);
  assert.deepEqual(lines, ['[QueueService] ⏳ hold q_hold01 รอรีเสิร์ช (อายุ 45s/360s) · q_hold04 (อายุ 130s/360s)'], 'log บรรทัดเดียวต่อรอบ');
  const reads = storage.calls.filter(([fn]) => fn === 'getRequest').map(([, id]) => id);
  assert.deepEqual(reads, ['q_hold01', 'q_free02', 'q_hold04', 'q_none05'], 'อ่านเฉพาะงานข่าวที่ jobId ถูกรูป (ไม่อ่านงานปก/id แปลก)');
  assert.equal(storage.calls.filter(([fn]) => fn === 'listWorkers').length, 1, 'ชีพจร worker อ่านครั้งเดียวต่อรอบ');
  // ไม่มีงานไหนต้อง hold = ไม่มี log · ready = รายการเดิม
  const quiet = [];
  const none = await m.filterResearchHeld([newsJob('q_free02', 1)], { env: WRITE, now: () => NOW, loadStorage: async () => storage, log: (l) => quiet.push(l), timers: fakeTimers() });
  assert.deepEqual(none.held, []);
  assert.deepEqual(quiet, []);
}

async function checkOffNoTouch(m) {
  const envs = [{}, { RESEARCH_AGENT: '1' }, { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'shadow' }, { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' },
    { RESEARCH_AGENT: '0', RESEARCH_AGENT_MODE: 'write' }, { ...WRITE, RESEARCH_AGENT_HOLD_MS: '0' }];
  for (const env of envs) {
    const jobs = [newsJob('q_hold01', 2)];
    let loads = 0;
    const lines = [];
    const timers = fakeTimers();
    const out = await m.filterResearchHeld(jobs, { env, now: () => NOW, loadStorage: async () => { loads += 1; return fakeStorage(); }, log: (l) => lines.push(l), timers });
    assert.equal(out.ready, jobs, `${JSON.stringify(env)}: ปิด = คืนรายการตัวเดิม`);
    assert.deepEqual(out.held, []);
    assert.equal(loads, 0, `${JSON.stringify(env)}: ปิด = ไม่แตะที่เก็บ`);
    assert.deepEqual(lines, []);
    assert.equal(timers.created.length, 0, 'ปิด = ไม่ตั้ง timer');
  }
}

async function checkFailOpen(m) {
  const jobs = [newsJob('q_hold01', 2), newsJob('q_hold02', 1)];
  const requests = { q_hold01: researchRequest('q_hold01'), q_hold02: researchRequest('q_hold02', { status: 'leased' }) };
  const base = { env: WRITE, now: () => NOW };
  { // 1) โหลดที่เก็บล้ม → ไม่ hold ทั้งรอบ + warning บรรทัดเดียว (ไม่มีข้อความดิบจาก DB)
    const lines = [];
    const out = await m.filterResearchHeld(jobs, { ...base, loadStorage: async () => { throw new Error('SECRET db down'); }, log: (l) => lines.push(l), timers: fakeTimers() });
    assert.equal(out.ready, jobs);
    assert.deepEqual(out.held, []);
    assert.equal(out.reason, 'unavailable');
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('SECRET'));
  }
  { // 2) ที่เก็บใช้ไม่ได้ (ไม่มี getRequest) → ไม่ hold
    const out = await m.filterResearchHeld(jobs, { ...base, loadStorage: async () => ({}), log: null, timers: fakeTimers() });
    assert.equal(out.ready, jobs);
    assert.equal(out.reason, 'unavailable');
  }
  { // 3) อ่านใบขอล้มเฉพาะใบเดียว → ใบนั้นไม่ hold ใบอื่นยัง hold
    const storage = fakeStorage({ requests });
    const orig = storage.getRequest;
    storage.getRequest = async (id) => { if (id === 'q_hold01') throw new Error('x'); return orig(id); };
    const out = await m.filterResearchHeld(jobs, { ...base, loadStorage: async () => storage, log: null, timers: fakeTimers() });
    assert.deepEqual(out.held.map((h) => h.jobId), ['q_hold02']);
  }
  { // 4) อ่านชีพจร worker ล้ม → ใบ queued ไม่ hold · ใบ leased ยัง hold
    const storage = fakeStorage({ requests });
    storage.listWorkers = async () => { throw new Error('x'); };
    const out = await m.filterResearchHeld(jobs, { ...base, loadStorage: async () => storage, log: null, timers: fakeTimers() });
    assert.deepEqual(out.held.map((h) => h.jobId), ['q_hold02']);
  }
  { // 5) อ่านค้าง → timer 3 วิ (ผู้เรียกขอนานกว่าก็ถูกบีบ) ยิงแล้ว = ไม่ hold ทั้งรอบ + warning
    const timers = fakeTimers();
    const lines = [];
    const pending = m.filterResearchHeld(jobs, {
      ...base, timers, timeoutMs: 60_000, log: (l) => lines.push(l),
      loadStorage: async () => ({ getRequest: () => new Promise(() => {}), listWorkers: async () => [] }),
    });
    await flush();
    assert.equal(timers.pending(), 1, 'ต้องตั้ง timer เพดานเวลาอ่าน');
    assert.equal(timers.created[0].ms, 3000, 'เวลาอ่านรวมไม่เกิน 3 วิ');
    timers.fireAll();
    const out = await settleWithin(pending, 'filterResearchHeld หลัง timer 3 วิ');
    assert.equal(out.ready, jobs);
    assert.equal(out.reason, 'timeout');
    assert.deepEqual(lines, ['[QueueService] ⚠️ research hold: อ่านใบขอเกิน 3000ms — ไม่ชะลองานรอบนี้ (fail-open)']);
  }
  { // 6) อ่านสำเร็จ → timer ถูก clear · ไม่ขอ background/unref
    const timers = fakeTimers();
    const out = await m.filterResearchHeld(jobs, { ...base, loadStorage: async () => fakeStorage({ requests }), log: null, timers });
    assert.equal(out.held.length, 2);
    assert.equal(timers.pending(), 0, 'timer ต้องถูก clear');
    assert.ok(timers.created.every((t) => t.rest.length === 0), 'ไม่ส่งตัวเลือก background/unref');
  }
  { // 7) นาฬิกาเสีย → ไม่ hold
    const out = await m.filterResearchHeld(jobs, { env: WRITE, now: () => Number.NaN, loadStorage: async () => fakeStorage({ requests }), log: null, timers: fakeTimers() });
    assert.equal(out.ready, jobs);
    assert.equal(out.reason, 'bad_clock');
  }
  { // 8) timer ฉีดพัง → ไม่โยน ไม่ hold
    const out = await m.filterResearchHeld(jobs, { ...base, loadStorage: async () => fakeStorage({ requests }), log: null, timers: { setTimer() { throw new Error('x'); }, clearTimer() {} } });
    assert.equal(out.ready, jobs);
    assert.deepEqual(out.held, []);
  }
}

async function checkScanLimit(m) {
  const jobs = Array.from({ length: 25 }, (_, i) => newsJob(`q_many${String(i).padStart(2, '0')}`, 30 - i));
  const storage = fakeStorage({ requests: Object.fromEntries(jobs.map((j) => [j.id, researchRequest(j.id)])) });
  const out = await m.filterResearchHeld(jobs, { env: WRITE, now: () => NOW, loadStorage: async () => storage, log: null, timers: fakeTimers() });
  assert.equal(out.held.length, 20, 'ตรวจไม่เกิน 20 งานต่อรอบ');
  assert.deepEqual(out.ready.map((j) => j.id), jobs.slice(20).map((j) => j.id), 'งานที่เกินเพดาน = ไม่ hold (fail-open)');
  assert.equal(storage.calls.filter(([fn]) => fn === 'getRequest').length, 20);
}

async function checkInfoAndApply(m) {
  const job = { ...newsJob('q_hold01', 1), position: 1, queuesAhead: 0 };
  const opts = { env: WRITE, now: () => NOW, timers: fakeTimers(), loadStorage: async () => fakeStorage({ requests: { q_hold01: researchRequest('q_hold01', { ageMs: 65 * SEC }) } }) };
  const { value: info, lines } = await captureConsole(() => m.getResearchHoldInfo(job, opts));
  assert.deepEqual(info, { heldMs: 65_000, maxMs: 360_000 });
  assert.deepEqual(lines, [], 'status route ไม่ log ทุก poll');
  assert.equal(await m.getResearchHoldInfo({ ...job, status: 'processing' }, opts), null);
  assert.equal(await m.getResearchHoldInfo(null, opts), null);
  assert.equal(await m.getResearchHoldInfo(job, { ...opts, loadStorage: async () => fakeStorage({ requests: { q_hold01: researchRequest('q_hold01', { status: 'done' }) } }) }), null);
  assert.equal(await m.getResearchHoldInfo(job, { ...opts, loadStorage: async () => { throw new Error('x'); } }), null);
  assert.equal(await m.getResearchHoldInfo(job, { ...opts, env: {} }), null);
  const jobs = [newsJob('q_hold01', 2), newsJob('q_free02', 1)];
  const ready = await m.applyResearchHold(jobs, { ...opts, log: null, loadStorage: async () => fakeStorage({ requests: { q_hold01: researchRequest('q_hold01') } }) });
  assert.deepEqual(ready.map((j) => j.id), ['q_free02']);
  assert.deepEqual(await m.applyResearchHold('not-a-list', opts), []);
  assert.equal(await m.applyResearchHold(jobs, { ...opts, env: {} }), jobs);
}

test('A1 getResearchHoldMs/isResearchHoldOn — ค่าเริ่มต้น WAIT_MS(write)+60000 · เพดาน 600000 · 0 = ปิด · เฉพาะ RESEARCH_AGENT=1 + write', async () => {
  await checkHoldMs(holdMod);
  assert.equal(holdMod.RESEARCH_HOLD_READ_TIMEOUT_MS, 3000);
  assert.equal(holdMod.RESEARCH_HOLD_MAX_MS, 600_000);
});

// ★ 1 ต.ค. 69 (W5): + leased ชีพจรขาด > 150 วิ · ของเดิมชื่อข้อ: 'A2 filterResearchHeld: ตารางกรณี hold/ไม่ hold (queued/leased · done/failed/expired · ไม่มีแถว · อายุ · deadline · worker ออฟไลน์ · แถวผิดรูป · เวลาเพี้ยน)'
test('A2 filterResearchHeld: ตารางกรณี hold/ไม่ hold (queued/leased · done/failed/expired · ไม่มีแถว · อายุ · deadline · worker ออฟไลน์ · แถวผิดรูป · เวลาเพี้ยน · leased ชีพจรขาด > 150 วิ (W5))', async () => {
  await checkHoldCases(holdMod);
});

test('A3 filterResearchHeld: ลำดับคงเดิม ตัดเฉพาะงานที่ hold · ไม่อ่านงานปก/id แปลก · log บรรทัดเดียวต่อรอบ', async () => {
  await checkReadyOrderAndLog(holdMod);
});

test('A4 ปิดสวิตช์/shadow/assist/RESEARCH_AGENT=0/HOLD_MS=0 → ไม่แตะที่เก็บ ไม่ตั้ง timer ไม่ log คืนรายการเดิม', async () => {
  await checkOffNoTouch(holdMod);
});

test('A5 fail-open: ที่เก็บล้ม/ใช้ไม่ได้ · ใบเดียวล้ม · ชีพจรล้ม · อ่านค้างเกิน 3 วิ (timer ปลอม) · นาฬิกาเสีย · timer พัง = ไม่ hold ไม่โยน', async () => {
  await checkFailOpen(holdMod);
});

test('A6 เพดานตรวจ 20 งานต่อรอบ · getResearchHoldInfo/applyResearchHold ไม่โยน ไม่ log', async () => {
  await checkScanLimit(holdMod);
  await checkInfoAndApply(holdMod);
});

test('A7 ที่เก็บตัวจริง (store.js · แถว rreq_<jobId>) ผ่าน Supabase ปลอม · ไม่ส่ง loadStorage = import store เองเฉพาะตอนเปิด write', async () => {
  const fresh = await importSource(SRC.hold, tag('queue-hold-e2e')); // สำเนาใหม่ = parent ใหม่ → hook เห็นทุก import
  const world = makeWorld({ requests: [researchRequest('q_hold01'), researchRequest('q_free02', { status: 'done' })] });
  freshState(world);
  const before = hooks.resolved.length;
  const off = await fresh.filterResearchHeld([newsJob('q_hold01', 2)], { env: { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }, now: () => NOW, timers: fakeTimers(), log: null });
  assert.deepEqual(off.held, []);
  assert.ok(!hooks.resolved.slice(before).some((s) => s.startsWith('@/lib/research-agent/store')), 'โหมดอื่น = ไม่ import store');
  assert.equal(world.calls.length, 0, 'โหมดอื่น = ไม่แตะฐาน');
  const out = await fresh.filterResearchHeld([newsJob('q_hold01', 2), newsJob('q_free02', 1)], { env: WRITE, now: () => NOW, timers: fakeTimers(), log: null });
  assert.deepEqual(out.held, [{ jobId: 'q_hold01', ageMs: 45_000 }]);
  assert.deepEqual(out.ready.map((j) => j.id), ['q_free02']);
  assert.ok(hooks.resolved.slice(before).includes('@/lib/research-agent/store'), 'โหมด write = dynamic import store');
  const ids = world.calls.flatMap((c) => c.eqs.filter(([col]) => col === 'id').map(([, v]) => v));
  assert.ok(ids.includes('rreq_q_hold01') && ids.includes('rreq_q_free02'), 'อ่านแถว rreq_<jobId>');
  assert.ok(world.calls.some((c) => c.eqs.some(([col, v]) => col === 'store_name' && v === 'research-workers')), 'อ่านชีพจร worker เมื่อมีใบ queued');
  globalThis.__QH.sbReady = false;
  const down = await fresh.filterResearchHeld([newsJob('q_hold01', 2)], { env: WRITE, now: () => NOW, timers: fakeTimers(), log: null });
  assert.equal(down.reason, 'unavailable', 'Supabase ไม่พร้อม = ไม่ hold');
});

test('A8 สัญญาร่วม: regex jobId = store.RESEARCH_JOB_ID_RE · offline = modes · ไม่ import store แบบ static · timer ไม่ unref', () => {
  assert.equal(String(holdMod.RESEARCH_HOLD_JOB_ID_RE), String(storeMod.RESEARCH_JOB_ID_RE));
  assert.equal(modesMod.RESEARCH_AGENT_OFFLINE_AFTER_MS, 10 * MIN);
  assert.ok(!/^import[^;]*research-agent\/store/m.test(SRC.hold), 'store ต้องเป็น dynamic import เท่านั้น');
  assert.ok(!/\bunref\b/.test(SRC.hold.replace(/^\s*\/\/.*$/gm, '')), 'timer ของตัวช่วยต้องไม่ unref');
});

// ============================================================
// ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5) — ข้อเสริม 2 ข้อของคิวชะลอ
//   A9 worker ตายกลางงาน: modes.isResearchLeaseStale (ตัวช่วยร่วมกับท่อโหมด write · readCards.readWriteOutcome)
//   A10 hold เฉพาะสายข้อความ: งานที่ input มีลิงก์ (URL ล้วน = ลิงก์ + ข้อความอื่น ≤ 20 ตัวอักษร) หรือรูป = ไม่ hold
// ============================================================
const MODES_SRC = read('src/lib/research-agent/modes.js');
const URL_ONLY = 'https://www.facebook.com/somepage/posts/1649392430310047/';
const TEXT_INPUT = 'ชาวสวีเดนสวมขาเทียมช่วยชาวบ้านราชบุรีตักทรายใส่กระสอบรับมือน้ำขึ้น';
const urlJob = (id, input, extra = {}) => ({ ...newsJob(id, 2), payload: { input, jobType: 'news', ...extra } });

function checkLeaseStaleUnit(m) {
  const req = (extra) => ({ status: 'leased', leasedAt: iso(NOW - 4 * MIN), ...extra });
  assert.equal(m.RESEARCH_AGENT_LEASE_STALE_MS, 150_000);
  assert.equal(m.isResearchLeaseStale(req({ heartbeatAt: iso(NOW - 151 * SEC) }), NOW), true, 'ชีพจรขาด 151 วิ');
  assert.equal(m.isResearchLeaseStale(req({ heartbeatAt: iso(NOW - 150 * SEC) }), NOW), false, '150 วิพอดี = ยังไม่ขาด');
  assert.equal(m.isResearchLeaseStale(req({ heartbeatAt: iso(NOW - 20 * SEC) }), NOW), false, 'heartbeatAt ชนะ leasedAt');
  assert.equal(m.isResearchLeaseStale(req({}), NOW), true, 'ไม่มี heartbeatAt = นับจาก leasedAt');
  assert.equal(m.isResearchLeaseStale({ status: 'queued', leasedAt: iso(NOW - 9 * MIN) }, NOW), false, 'ไม่ใช่ leased = ไม่ตัดสิน');
  assert.equal(m.isResearchLeaseStale({ status: 'leased' }, NOW), false, 'ไม่มีเวลา = ไม่ตัดสินแทน (คงพฤติกรรมเดิม)');
  assert.equal(m.isResearchLeaseStale({ status: 'leased', heartbeatAt: 'เมื่อวาน' }, NOW), false, 'เวลาอ่านไม่ได้ = ไม่ตัดสิน');
  assert.equal(m.isResearchLeaseStale(null, NOW), false);
  assert.equal(m.isResearchLeaseStale([], NOW), false);
  assert.equal(m.isResearchLeaseStale(req({}), Number.NaN), false, 'นาฬิกาเสีย = ไม่ตัดสิน');
  assert.equal(m.isResearchLeaseStale(req({ heartbeatAt: iso(NOW - 61 * SEC) }), NOW, 60_000), true, 'staleMs ฉีดได้');
}

async function checkTextPathOnly(m) {
  // ตัวตรวจ = กติกา /api/auto/process (detectInputType · สายข้อความต้องไม่มีลิงก์และไม่มีรูป)
  assert.equal(m.isTextPathInput({ input: TEXT_INPUT }), true, 'ข้อความล้วน = สายข้อความ');
  assert.equal(m.isTextPathInput({ input: URL_ONLY }), false, 'URL ล้วน');
  assert.equal(m.isTextPathInput({ input: `ดูนี่ ${URL_ONLY}` }), false, 'ลิงก์ + ข้อความ ≤ 20 ตัวอักษร = URL ล้วน');
  assert.equal(m.isTextPathInput({ input: `${TEXT_INPUT} ${URL_ONLY}` }), false, 'ลิงก์ + ข้อความยาว = ท่อส่งสาย URL ไม่ใช่สายข้อความ');
  assert.equal(m.isTextPathInput({ input: TEXT_INPUT, images: ['data:image/png;base64,AAAA'] }), false, 'มีรูป = สายรูป');
  assert.equal(m.isTextPathInput({ url: URL_ONLY }), false, 'ไม่มี input ใช้ url (ลำดับเดียวกับ route)');
  assert.equal(m.isTextPathInput({ input: TEXT_INPUT, sourceUrls: [URL_ONLY] }), true, 'ลิงก์ที่บอทแยกไป sourceUrls ไม่นับ (input เป็นข้อความ)');
  assert.equal(m.isTextPathInput(undefined), true, 'ไม่มี payload = กติกาเดิม (ตรวจต่อ)');
  assert.equal(m.isTextPathInput({ input: '' }), true);
  // ผลจริงของ filterResearchHeld: ใบขอ leased สดเหมือนกันทุกงาน — งานข้อความ hold · งาน URL ล้วน/ลิงก์+ข้อความสั้น หยิบตามปกติ
  const jobs = [newsJob('q_text01', 4), urlJob('q_url01', URL_ONLY), urlJob('q_url02', `ดูนี่ ${URL_ONLY}`)];
  const storage = fakeStorage({ requests: Object.fromEntries(jobs.map((j) => [j.id, researchRequest(j.id, { status: 'leased' })])) });
  const out = await m.filterResearchHeld(jobs, { env: WRITE, now: () => NOW, loadStorage: async () => storage, log: null, timers: fakeTimers() });
  assert.deepEqual(out.held.map((h) => h.jobId), ['q_text01'], 'hold เฉพาะงานสายข้อความ');
  assert.deepEqual(out.ready.map((j) => j.id), ['q_url01', 'q_url02'], 'งาน URL ล้วน = หยิบตามปกติ (ไม่ชะลอเปล่า)');
  assert.deepEqual(storage.calls.filter(([fn]) => fn === 'getRequest').map(([, id]) => id), ['q_text01'], 'งาน URL ไม่ต้องอ่านใบขอ');
  const info = await m.getResearchHoldInfo(urlJob('q_url01', URL_ONLY), { env: WRITE, now: () => NOW, loadStorage: async () => storage, timers: fakeTimers() });
  assert.equal(info, null, '/api/queue/status ไม่ขึ้น researchHold ให้งาน URL');
}

test('A9 (W5) worker ตายกลางงาน: modes.isResearchLeaseStale — leased + ชีพจรขาด > 150 วิ (heartbeatAt ?? leasedAt) · ไม่ใช่ leased/ไม่มีเวลา = ไม่ตัดสิน · queueHold/readCards ใช้ตัวช่วยเดียวกัน', () => {
  checkLeaseStaleUnit(modesMod);
  assert.match(SRC.hold, /^ {2}if \(isResearchLeaseStale\(row, nowMs\)\) return null;$/m, 'queueHold ใช้ตัวช่วยร่วม');
});

test('A10 (W5) hold เฉพาะสายข้อความ: input URL ล้วน (ลิงก์ + ข้อความ ≤ 20 ตัวอักษร) / ลิงก์ + ข้อความยาว / มีรูป = ไม่ hold · ข้อความล้วน = hold ตามเดิม · ตัวตรวจเดียวกับ /api/auto/process', async () => {
  await checkTextPathOnly(holdMod);
});

// ============================================================
// B. getNextPendingJobs ตัวจริง
// ============================================================
async function runQueue(mod, spec, env, { applyImpl = null, failResearch = null } = {}) {
  const world = makeWorld(clone(spec));
  world.failResearch = failResearch;
  const st = freshState(world, { applyImpl });
  const before = hooks.resolved.length;
  const { value, lines } = await withEnv(env, () => captureConsole(() => mod.getNextPendingJobs(1)));
  return { claimed: value, lines, world, st, resolved: hooks.resolved.slice(before) };
}

const SPEC_SKIP = () => ({
  jobs: [newsJob('q_hold01', 5), newsJob('q_free02', 4), newsJob('q_next03', 3)],
  requests: [researchRequest('q_hold01'), researchRequest('q_free02', { status: 'done' }), researchRequest('q_next03')],
});

async function checkQueueHoldSkips(mod) {
  const r = await runQueue(mod, SPEC_SKIP(), WRITE);
  assert.deepEqual(r.claimed.map((j) => j.id), ['q_free02'], 'hold งานแรก → หยิบงานถัดไปที่ไม่ถูก hold');
  assert.equal(r.claimed[0].status, 'processing');
  assert.equal(r.claimed[0].attemptId, 'attempt-1');
  assert.equal(r.world.job('q_free02').status, 'processing');
  for (const id of ['q_hold01', 'q_next03']) {
    assert.equal(r.world.job(id).status, 'pending', `${id}: งานที่ hold ยัง pending`);
    assert.equal(r.world.job(id).attemptId, null, `${id}: ไม่ถูก claim`);
  }
  assert.deepEqual(r.st.holdCalls, [{ fn: 'applyResearchHold', ids: ['q_hold01', 'q_free02', 'q_next03'] }], 'ตัวช่วยได้งาน pending ทั้งหมด (ไม่ใช่แค่ slice)');
  assert.deepEqual(r.lines.filter((l) => l.includes('⏳')), ['log:[QueueService] ⏳ hold q_hold01 รอรีเสิร์ช (อายุ 45s/360s) · q_next03 (อายุ 45s/360s)']);
  assert.ok(r.lines.includes('log:[QueueService] 🔄 Claimed 1 job(s): q_free02'));
}

async function checkQueueAllHeldThenRelease(mod) {
  const spec = { jobs: [newsJob('q_hold01', 5), newsJob('q_hold02', 4)], requests: [researchRequest('q_hold01'), researchRequest('q_hold02', { status: 'leased' })] };
  const world = makeWorld(spec);
  freshState(world);
  const first = await withEnv(WRITE, () => captureConsole(() => mod.getNextPendingJobs(1)));
  assert.deepEqual(first.value, [], 'ทุกงาน hold = ไม่หยิบ');
  assert.equal(world.job('q_hold01').status, 'pending');
  assert.equal(world.job('q_hold02').status, 'pending');
  assert.ok(!first.lines.some((l) => l.includes('Claimed')));
  assert.ok(!first.lines.some((l) => l.includes('Concurrency limit')), 'งานที่ hold ไม่นับเป็น processing');
  world.setRequest('q_hold02', { status: 'done' }); // งานที่สองค้นเสร็จก่อน → หยิบงานที่สอง (งานแรกยังค้น)
  const second = await withEnv(WRITE, () => captureConsole(() => mod.getNextPendingJobs(1)));
  assert.deepEqual(second.value.map((j) => j.id), ['q_hold02']);
  world.setRequest('q_hold01', { status: 'failed' });
  await world.queueStore.update('q_hold02', (j) => ({ ...j, status: 'completed' }));
  const third = await withEnv(WRITE, () => captureConsole(() => mod.getNextPendingJobs(1)));
  assert.deepEqual(third.value.map((j) => j.id), ['q_hold01'], 'ใบขอจบ (failed) = หยิบตามปกติ');
}

async function checkQueueFailOpen(mod) {
  const spec = () => ({ jobs: [newsJob('q_hold01', 5), newsJob('q_free02', 4)], requests: [researchRequest('q_hold01')] });
  const thrown = await runQueue(mod, spec(), WRITE, { applyImpl: async () => { throw new Error('helper broken'); } });
  assert.deepEqual(thrown.claimed.map((j) => j.id), ['q_hold01'], 'ตัวช่วยโยน = หยิบตามลำดับเดิม');
  const garbage = await runQueue(mod, spec(), WRITE, { applyImpl: async () => 'garbage' });
  assert.deepEqual(garbage.claimed.map((j) => j.id), ['q_hold01'], 'ตัวช่วยคืนของแปลก = หยิบตามลำดับเดิม');
  const broken = await runQueue(mod, spec(), WRITE, { failResearch: 'throw' });
  assert.deepEqual(broken.claimed.map((j) => j.id), ['q_hold01'], 'อ่านใบขอล้ม = หยิบตามลำดับเดิม');
  // อ่านใบขอค้าง → timer 3 วิ (ปลอม) ยิง → หยิบตามเดิม
  const world = makeWorld(spec());
  world.failResearch = 'hang';
  freshState(world);
  const run = withEnv(WRITE, () => captureConsole(async () => {
    const p = mod.getNextPendingJobs(1);
    for (let i = 0; i < 50 && world.timers.pending() === 0; i += 1) await flush();
    assert.equal(world.timers.pending(), 1, 'ตัวช่วยตั้ง timer 3 วิระหว่างอ่าน');
    world.timers.fireAll();
    return p;
  }));
  const { value, lines } = await settleWithin(run, 'getNextPendingJobs หลัง timer 3 วิ');
  assert.deepEqual(value.map((j) => j.id), ['q_hold01'], 'อ่านค้างเกิน 3 วิ = หยิบตามเดิม');
  assert.ok(lines.includes('log:[QueueService] ⚠️ research hold: อ่านใบขอเกิน 3000ms — ไม่ชะลองานรอบนี้ (fail-open)'));
}

const PARITY_ENVS = Object.freeze([
  ['ปิดสวิตช์', {}],
  ['shadow', { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'shadow' }],
  ['assist', { RESEARCH_AGENT: '1', RESEARCH_AGENT_MODE: 'assist' }],
  ['RESEARCH_AGENT=0 + write', { RESEARCH_AGENT: '0', RESEARCH_AGENT_MODE: 'write' }],
  ['RESEARCH_AGENT ว่าง + write', { RESEARCH_AGENT: '', RESEARCH_AGENT_MODE: 'write' }],
]);
const PARITY_SPECS = () => [
  SPEC_SKIP(),
  { jobs: [newsJob('q_hold01', 5), { ...newsJob('q_proc02', 4), status: 'processing', attemptId: 'a0', startedAt: iso(NOW - MIN) }], requests: [researchRequest('q_hold01')] },
  { jobs: [coverJob('q_cover1', 5), newsJob('q_hold02', 4)], requests: [researchRequest('q_hold02')] },
  { jobs: [newsJob('q_late09', 1), newsJob('q_early1', 9)], requests: [researchRequest('q_early1')] },
  { jobs: [], requests: [] },
];

async function checkQueueParity(current, legacy) {
  for (const [label, env] of PARITY_ENVS) {
    for (const [i, spec] of PARITY_SPECS().entries()) {
      const a = await runQueue(current, spec, env);
      const b = await runQueue(legacy, spec, env);
      const where = `${label} · โลก #${i}`;
      assert.deepEqual(normalizeTimes(clone(a.claimed)), normalizeTimes(clone(b.claimed)), `${where}: งานที่หยิบ`);
      assert.deepEqual(normalizeTimes(a.world.snapshot()), normalizeTimes(b.world.snapshot()), `${where}: แถวหลังหยิบ`);
      assert.deepEqual(a.lines, b.lines, `${where}: log`);
      assert.deepEqual(a.world.calls, b.world.calls, `${where}: คำสั่งฐาน`);
      assert.deepEqual(a.st.holdCalls, [], `${where}: ไม่เรียกตัวช่วย`);
      assert.ok(!a.resolved.some((s) => s.startsWith('@/lib/research-agent')), `${where}: ไม่ import โมดูลรีเสิร์ช`);
    }
  }
}

test('B1 getNextPendingJobs (write): hold ข้ามงานแรกแล้วหยิบงานถัดไป · งานที่ hold ยัง pending · ตัวช่วยได้งาน pending ทั้งหมด', async () => {
  await checkQueueHoldSkips(queueMod);
});

test('B2 getNextPendingJobs (write): ทุกงาน hold = ไม่หยิบ (ไม่นับ processing) → ใบขอเสร็จ/ล้มรอบถัดไปหยิบตามลำดับ', async () => {
  await checkQueueAllHeldThenRelease(queueMod);
});

test('B3 getNextPendingJobs (write): ตัวช่วยโยน/คืนของแปลก/อ่านล้ม/อ่านค้างเกิน 3 วิ = หยิบตามเดิม (fail-open)', async () => {
  await checkQueueFailOpen(queueMod);
});

test('B4 getNextPendingJobs ปิดสวิตช์/shadow/assist: ผลเท่าซอร์สที่ถอด hook ทุกไบต์ + ไม่เรียก/ไม่ import ตัวช่วย', async () => {
  const legacy = await loadQueueCopy(stripQueueHook(SRC.queue), 'queue-legacy');
  const current = await loadQueueCopy(SRC.queue, 'queue-current');
  await checkQueueParity(current, legacy);
  await checkQueueParity(queueMod, legacy); // ไฟล์จริง (import '../supabase.js' ผ่าน hook ของ parent) ต้องได้ผลเดียวกัน
  // ควบคุม: โหมด write ด้วยโลกเดียวกัน ฉบับปัจจุบันต้องต่างจากซอร์สที่ถอด hook (เทสนี้มองเห็น hook จริง)
  const a = await runQueue(current, SPEC_SKIP(), WRITE);
  const b = await runQueue(legacy, SPEC_SKIP(), WRITE);
  assert.deepEqual(a.claimed.map((j) => j.id), ['q_free02']);
  assert.deepEqual(b.claimed.map((j) => j.id), ['q_hold01']);
  assert.ok(a.resolved.includes('@/lib/research-agent/queueHold'), 'โหมด write = dynamic import ตัวช่วย');
});

// ============================================================
// C. GET /api/queue/status ตัวจริง
// ============================================================
function statusRequest(id) {
  const url = `http://api.test/api/queue/status?id=${id}`;
  return Object.assign(new Request(url), { nextUrl: new URL(url) });
}

async function runRoute(route, { job, env, requests = [], infoImpl = null }) {
  const world = makeWorld({ requests });
  const st = freshState(world, { infoImpl, getJobStatus: async (id) => (job && id === job.id ? clone(job) : null) });
  const before = hooks.resolved.length;
  const res = await withEnv(env, () => route.GET(statusRequest(job ? job.id : 'q_missing')));
  return { status: res.status, body: await res.json(), holdCalls: st.holdCalls, resolved: hooks.resolved.slice(before) };
}

const PENDING_JOB = () => ({ ...newsJob('q_hold01', 1), position: 2, queuesAhead: 1 });

async function checkRouteHold(route, legacy) {
  const a = await runRoute(route, { job: PENDING_JOB(), env: WRITE, requests: [researchRequest('q_hold01', { ageMs: 130 * SEC })] });
  const b = await runRoute(legacy, { job: PENDING_JOB(), env: WRITE, requests: [researchRequest('q_hold01', { ageMs: 130 * SEC })] });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.researchHold, { heldMs: 130_000, maxMs: 360_000 }, 'งาน pending ที่ hold → researchHold');
  const { researchHold, ...rest } = a.body;
  assert.ok(researchHold);
  assert.deepEqual(rest, b.body, 'ช่องอื่นเท่าซอร์สที่ถอด hook ทุกช่อง');
  assert.deepEqual(a.holdCalls, [{ fn: 'getResearchHoldInfo', id: 'q_hold01' }]);
}

async function checkRouteNoHold(route, legacy) {
  const cases = [
    ['ใบขอเสร็จแล้ว', { job: PENDING_JOB(), env: WRITE, requests: [researchRequest('q_hold01', { status: 'done' })] }, 1],
    ['ไม่มีใบขอ', { job: PENDING_JOB(), env: WRITE }, 1],
    ['ตัวช่วยโยน', { job: PENDING_JOB(), env: WRITE, requests: [researchRequest('q_hold01')], infoImpl: async () => { throw new Error('x'); } }, 1],
    ['งาน processing', { job: { ...PENDING_JOB(), status: 'processing', attemptId: 'a1', startedAt: iso(NOW) }, env: WRITE, requests: [researchRequest('q_hold01')] }, 0],
    ['งาน completed', { job: { ...PENDING_JOB(), status: 'completed', result: { success: true }, completedAt: iso(NOW) }, env: WRITE, requests: [researchRequest('q_hold01')] }, 0],
    ['ไม่พบงาน (404)', { job: null, env: WRITE }, 0],
  ];
  for (const [label, opts, calls] of cases) {
    const a = await runRoute(route, opts);
    const b = await runRoute(legacy, opts);
    assert.equal(a.status, b.status, `${label}: status`);
    assert.deepEqual(a.body, b.body, `${label}: คำตอบเท่าซอร์สที่ถอด hook ทุกไบต์`);
    assert.ok(!Object.hasOwn(a.body, 'researchHold'), `${label}: ไม่มีช่อง researchHold`);
    assert.equal(a.holdCalls.length, calls, `${label}: เรียกตัวช่วย ${calls} ครั้ง`);
  }
}

async function checkRouteOff(route, legacy) {
  for (const [label, env] of PARITY_ENVS) {
    const opts = { job: PENDING_JOB(), env, requests: [researchRequest('q_hold01')] };
    const a = await runRoute(route, opts);
    const b = await runRoute(legacy, opts);
    assert.deepEqual(a.body, b.body, `${label}: คำตอบเท่าซอร์สที่ถอด hook ทุกไบต์`);
    assert.deepEqual(a.holdCalls, [], `${label}: ไม่เรียกตัวช่วย`);
    assert.ok(!a.resolved.some((s) => s.startsWith('@/lib/research-agent')), `${label}: ไม่ import โมดูลรีเสิร์ช`);
  }
}

test('C1 /api/queue/status (write): งาน pending ที่ hold ตอบเพิ่ม researchHold {heldMs, maxMs} · ช่องอื่นเท่าเดิม', async () => {
  const legacy = await importSource(stripRouteHook(SRC.status), tag('status-legacy'));
  await checkRouteHold(statusRoute, legacy);
});

test('C2 /api/queue/status: ไม่ hold/ตัวช่วยล้ม/ไม่ใช่ pending/404/ปิดสวิตช์/shadow/assist = คำตอบเท่าซอร์สที่ถอด hook ทุกไบต์', async () => {
  const legacy = await importSource(stripRouteHook(SRC.status), tag('status-legacy'));
  await checkRouteNoHold(statusRoute, legacy);
  const fresh = await importSource(SRC.status, tag('status-current')); // parent ใหม่ → hook เห็นทุก import
  await checkRouteOff(fresh, legacy);
});

test('B5/C3 ตัวเช็คสวิตช์ที่เขียนซ้ำในไฟล์ล็อก (queueService + queue/status) ตรงกับ modes.js ทุกรูปค่า env — เรียกตัวช่วย ⇔ RESEARCH_AGENT=1 และโหมด write', async () => {
  const agents = [undefined, '', '1', ' 1 ', '"1"', "'1'", '0', 'true', '01'];
  const modeValues = [undefined, '', 'write', ' WRITE ', '"write"', 'Write', 'assist', 'writer'];
  let on = 0;
  for (const agent of agents) {
    for (const mode of modeValues) {
      const env = {};
      if (agent !== undefined) env.RESEARCH_AGENT = agent;
      if (mode !== undefined) env.RESEARCH_AGENT_MODE = mode;
      const want = modesMod.isResearchAgentOn(env) && modesMod.getResearchAgentMode(env) === 'write';
      if (want) on += 1;
      const q = await runQueue(queueMod, { jobs: [newsJob('q_free02', 1)], requests: [] }, env);
      assert.equal(q.st.holdCalls.length > 0, want, `queueService ${JSON.stringify(env)}`);
      assert.deepEqual(q.claimed.map((j) => j.id), ['q_free02'], `queueService ${JSON.stringify(env)}: ไม่มีใบขอ = หยิบตามปกติ`);
      const r = await runRoute(statusRoute, { job: PENDING_JOB(), env });
      assert.equal(r.holdCalls.length > 0, want, `queue/status ${JSON.stringify(env)}`);
      assert.ok(!Object.hasOwn(r.body, 'researchHold'), `queue/status ${JSON.stringify(env)}: ไม่มีใบขอ = ไม่มีช่อง`);
    }
  }
  assert.equal(on, 4 * 4, 'ชุดค่าที่ต้องเปิด = RESEARCH_AGENT 4 รูป × write 4 รูป');
});

// ============================================================
// D. discord-bot/index.js — pollJobUntilDone
// ============================================================
const BOT_URL = new URL('../discord-bot/index.js', import.meta.url);
const botRequire = createRequire(BOT_URL);
const API = 'http://api.test';
const BOT_JOB = 'q_bot000000000001';
const START = NOW;

class FakeEmbed {
  constructor() { this.data = {}; }
  setColor(c) { this.data.color = c; return this; }
  setTitle(t) { this.data.title = t; return this; }
  setDescription(d) { this.data.description = d; return this; }
  addFields(...f) { (this.data.fields ||= []).push(...f.flat()); return this; }
  setFooter(f) { this.data.footer = f; return this; }
}

/** นาฬิกาเสมือน (แบบ tests/bot-research-card.test.mjs): timer เรียงตามเวลา · step() เดินไป timer ถัดไปแล้วยิง */
function makeScheduler(start = START) {
  let now = start;
  let id = 0;
  const queue = [];
  const delays = [];
  return {
    now: () => now,
    delays,
    setTimeout: (fn, ms = 0) => { const delay = Math.max(0, Number(ms) || 0); const t = { id: ++id, at: now + delay, fn, cleared: false }; queue.push(t); delays.push(delay); return t; },
    clearTimeout: (t) => { if (t && typeof t === 'object') t.cleared = true; },
    pending: () => queue.filter((t) => !t.cleared).length,
    async step() {
      const live = queue.filter((t) => !t.cleared).sort((a, b) => a.at - b.at || a.id - b.id);
      if (live.length === 0) return false;
      const t = live[0];
      queue.splice(queue.indexOf(t), 1);
      if (t.at > now) now = t.at;
      t.fn();
      await flush();
      return true;
    },
  };
}
function makeFakeDate(sched) {
  return class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(sched.now()); else super(...args); }
    static now() { return sched.now(); }
  };
}
async function drive(sched, promise, label, maxSteps = 6000) {
  let settled = false;
  let failure = null;
  let value;
  promise.then((v) => { settled = true; value = v; }, (e) => { settled = true; failure = e; });
  const loop = (async () => {
    for (let i = 0; i < maxSteps; i += 1) {
      await flush();
      if (settled) return;
      if (!(await sched.step())) { await flush(); if (!settled) throw new Error(`${label}: ไม่มี timer เหลือแต่งานยังไม่จบ`); }
    }
    throw new Error(`${label}: เกิน ${maxSteps} ก้าว`);
  })();
  await settleWithin(loop, label, 20_000);
  if (failure) throw failure;
  return value;
}

const HOLD = (heldSec, maxSec = 360) => ({ success: true, status: 'pending', position: 1, queuesAhead: 0, researchHold: { heldMs: heldSec * SEC, maxMs: maxSec * SEC } });
const PENDING = (extra = {}) => ({ success: true, status: 'pending', position: 1, queuesAhead: 0, ...extra });
const PROCESSING = () => ({ success: true, status: 'processing' });
const DONE = () => ({
  success: true,
  status: 'completed',
  result: {
    success: true,
    data: {
      caseId: '06001',
      newsData: { newsTitle: 'ลุงสามล้อ' },
      analysisResult: { versions: [{ content: 'เนื้อข่าว V1', style: 'Classic', _source: 'classic' }], qualityWarnings: [] },
    },
  },
});
const HOLD_TEXT = (x, y = 6) => `⏳ กำลังค้นคว้าก่อนเขียน (${x}/${y} นาที)`;
const WAIT_TEXT = '📋 **รอคิว** (ลำดับที่ 1) มี 0 คิวก่อนหน้า ⏳\nประมาณ 0 นาที';

function loadBot(src, axios, sched) {
  class FakeClient {
    constructor(opts) { this.opts = opts; this.user = { tag: 'bot#0' }; this.channels = { fetch: async () => { throw new Error('no channel'); } }; }
    once() {}
    on() {}
    async login() {}
    async destroy() {}
  }
  const discord = { Client: FakeClient, GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, GuildMessageReactions: 1024 }, Partials: { Message: 3, Reaction: 5 }, EmbedBuilder: FakeEmbed };
  const fakeRequire = (name) => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'discord.js') return discord;
    if (name === 'axios') return axios;
    return botRequire(name); // 'os' · './queue-errors' · './researchCard' ของจริง (สวิตช์รีเสิร์ชฝั่งบอทปิด = no-op)
  };
  const mod = { exports: {} };
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.map(String).join(' ')), warn: (...a) => logs.push(a.map(String).join(' ')), error: (...a) => logs.push(a.map(String).join(' ')) };
  const fakeProcess = { env: { API_URL: `${API}/api/auto/process`, API_KEY: 'S3CRET' }, on() {}, exit() {} };
  const fakeMath = Object.assign(Object.create(Math), { random: () => 0.5 });
  new Function('require', 'module', 'exports', 'process', 'console', 'setTimeout', 'clearTimeout', 'Date', 'Math', src)(
    fakeRequire, mod, mod.exports, fakeProcess, fakeConsole, sched.setTimeout, sched.clearTimeout, makeFakeDate(sched), fakeMath);
  return { bot: mod.exports, logs };
}

/** poll หนึ่งงานจนจบ · statusAt(n) = คำตอบ /api/queue/status ครั้งที่ n (เริ่ม 1) */
async function runBotPoll({ src = SRC.bot, statusAt }) {
  const sched = makeScheduler(START);
  const calls = [];
  let polls = 0;
  const axios = {
    async get(url, opts) {
      calls.push(['get', url, sched.now() - START, clone(opts?.headers)]);
      if (url.startsWith(`${API}/api/queue/status?id=`)) { polls += 1; return { data: clone(statusAt(polls)) }; }
      if (url.startsWith(`${API}/api/bot/tracking`)) return { data: { success: true, count: 0, items: [] } };
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body) {
      calls.push(['post', url, clone(body), sched.now() - START]);
      if (url === `${API}/api/queue/worker`) return { data: { success: true } };
      throw new Error(`unexpected POST ${url}`);
    },
    async delete(url) { calls.push(['delete', url]); return { data: { success: true } }; },
  };
  const { bot, logs } = loadBot(src, axios, sched);
  const edits = [];
  const replies = [];
  const processingMsg = { id: 'P1', channelId: 'CH1', edit: async (c) => { edits.push(typeof c === 'string' ? c : c.content); }, react: async () => {}, delete: async () => {} };
  const message = { id: 'M1', channelId: 'CH1', guildId: 'G1', author: { id: 'U1', tag: 'u#0' }, reply: async (o) => { replies.push(clone(o)); return processingMsg; }, react: async () => {} };
  let error = null;
  try {
    await drive(sched, bot.pollJobUntilDone({ jobId: BOT_JOB, processingMsg, message, headers: { 'x-api-key': 'S3CRET' }, queueUrl: `${API}/api/queue/add`, jobStartTime: START }), 'pollJobUntilDone');
  } catch (e) {
    error = String(e?.message || e);
  }
  const workerPosts = calls.filter(([m, url]) => m === 'post' && url === `${API}/api/queue/worker`).map((c) => c[3]);
  return { edits, replies, calls, logs, error, polls, elapsed: sched.now() - START, delays: sched.delays, workerPosts };
}
const seqStatus = (list) => (n) => list[Math.min(n, list.length) - 1];

async function checkBotHoldFlow(src) {
  const r = await runBotPoll({ src, statusAt: seqStatus([HOLD(45), HOLD(48), HOLD(65), HOLD(125), PENDING(), PROCESSING(), DONE()]) });
  assert.equal(r.error, null);
  assert.deepEqual(r.edits.slice(0, 4), [HOLD_TEXT(0), HOLD_TEXT(1), HOLD_TEXT(2), WAIT_TEXT], 'ข้อความรอรีเสิร์ช แก้เมื่อตัวเลขเปลี่ยน แล้วกลับเป็นรอคิวเมื่อ hold จบ');
  assert.ok(r.edits[4].startsWith('⚡ **Auto Pipeline V2**'), 'processing = progress เดิม');
  assert.match(r.edits.at(-1), /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u);
  assert.deepEqual(r.workerPosts, [15_000], 'ไม่ปลุก worker ระหว่าง hold · ปลุกทันทีที่ hold จบ (poll ที่ 15 วิ)');
}

async function checkBotReentry(src) {
  const r = await runBotPoll({ src, statusAt: seqStatus([HOLD(45), PENDING(), HOLD(50), PROCESSING(), DONE()]) });
  assert.equal(r.error, null);
  assert.deepEqual(r.edits.slice(0, 3), [HOLD_TEXT(0), WAIT_TEXT, HOLD_TEXT(0)], 'กลับเข้า hold อีกรอบ = แก้ข้อความกลับ แม้ตัวเลขเดิม');
}

/** hold 5 นาทีแรก แล้วท่อวิ่งจนนาทีที่ 17 → งานเสร็จ (เกิน 15 นาทีเดิม แต่ไม่เกิน 15 + เพดาน hold 6) */
const LONG_JOB = (n) => (n <= 100 ? HOLD(n * 3) : n <= 340 ? PROCESSING() : DONE());

async function checkBotDeadline(src) {
  const r = await runBotPoll({ src, statusAt: LONG_JOB });
  assert.equal(r.error, null, 'hold แล้วต้องยืดเวลารอผล — ไม่ตัดหมดเวลาที่ 15 นาที');
  assert.equal(r.polls, 341);
  assert.match(r.edits.at(-1), /^✅ \*\*สร้างข่าวสำเร็จ!\*\*/u);
  const noHold = await runBotPoll({ src, statusAt: () => PROCESSING() });
  assert.equal(noHold.error, 'หมดเวลารอคิว (15 นาที) กรุณาลองใหม่', 'ไม่มี hold = 15 นาทีเดิม');
  assert.equal(noHold.polls, 300);
  const capped = await runBotPoll({ src, statusAt: (n) => (n === 1 ? { ...HOLD(1), researchHold: { heldMs: 1000, maxMs: 99_999_999 } } : PROCESSING()) });
  assert.equal(capped.error, 'หมดเวลารอคิว (15 นาที) กรุณาลองใหม่');
  assert.equal(capped.polls, 500, 'เพดานยืด ≤ 10 นาที (15 + 10 = 25 นาที = 500 poll) แม้เว็บส่งค่าเพี้ยน');
  assert.equal(capped.edits[0], HOLD_TEXT(0, 10));
}

const BOT_PARITY = () => [
  ['รอคิวแล้วทำ', seqStatus([PENDING(), PENDING(), PENDING(), PENDING(), PENDING(), PROCESSING(), PROCESSING(), PROCESSING(), DONE()])],
  ['ล้มปลายทาง', seqStatus([PENDING(), PROCESSING(), { success: true, status: 'failed', error: 'งานล้ม', errorType: 'PIPELINE_ERROR', failedStep: 'generate' }])],
  ['ไม่พบงาน', seqStatus([PENDING(), { success: false, error: 'ไม่พบ' }])],
  ['researchHold ผิดรูป (ข้อความ)', seqStatus([PENDING({ researchHold: { heldMs: '45000', maxMs: 360000 } }), PENDING({ researchHold: 'x' }), PROCESSING(), DONE()])],
  ['researchHold ผิดรูป (ติดลบ/0/null/array)', seqStatus([PENDING({ researchHold: { heldMs: -1, maxMs: 360000 } }), PENDING({ researchHold: { heldMs: 1, maxMs: 0 } }),
    PENDING({ researchHold: null }), PENDING({ researchHold: [] }), PENDING({ researchHold: { heldMs: 1 } }), PROCESSING(), DONE()])],
  ['researchHold บนงาน processing (ไม่สนใจ)', seqStatus([{ ...PROCESSING(), researchHold: { heldMs: 1000, maxMs: 360000 } }, DONE()])],
];

async function checkBotParity(src, legacySrc) {
  for (const [label, statusAt] of BOT_PARITY()) {
    const a = await runBotPoll({ src, statusAt });
    const b = await runBotPoll({ src: legacySrc, statusAt });
    for (const key of ['edits', 'replies', 'calls', 'logs', 'error', 'polls', 'elapsed', 'delays', 'workerPosts']) {
      assert.deepEqual(a[key], b[key], `${label}: ${key} ต้องเท่าซอร์สที่ถอด hook ทุกไบต์`);
    }
  }
  const timeoutA = await runBotPoll({ src, statusAt: () => PENDING() });
  const timeoutB = await runBotPoll({ src: legacySrc, statusAt: () => PENDING() });
  assert.deepEqual([timeoutA.error, timeoutA.polls, timeoutA.edits, timeoutA.workerPosts], [timeoutB.error, timeoutB.polls, timeoutB.edits, timeoutB.workerPosts], 'pending ค้าง: หมดเวลา 15 นาทีเท่าเดิม');
}

test('D1 บอท: researchHold → "⏳ กำลังค้นคว้าก่อนเขียน (x/y นาที)" แก้เมื่อตัวเลขเปลี่ยน · ไม่ปลุก worker ระหว่าง hold · กลับเข้า hold แก้ข้อความกลับ', async () => {
  await checkBotHoldFlow(SRC.bot);
  await checkBotReentry(SRC.bot);
  // ควบคุม: ซอร์สที่ถอด hook ไม่รู้จัก researchHold → ข้อความรอคิวเดิม + ปลุก worker ระหว่าง hold
  const legacy = await runBotPoll({ src: stripBotHook(SRC.bot), statusAt: seqStatus([HOLD(45), HOLD(48), HOLD(65), HOLD(125), PENDING(), PROCESSING(), DONE()]) });
  assert.equal(legacy.edits[0], WAIT_TEXT);
  assert.deepEqual(legacy.workerPosts, [12_000, 15_000]);
});

test('D2 บอท: hold แล้วยืดเวลารอผลเท่าเพดาน hold (งานเสร็จนาทีที่ 17 ได้ผล) · ไม่มี hold = 15 นาทีเดิม · เพดานยืด ≤ 10 นาที', async () => {
  await checkBotDeadline(SRC.bot);
});

test('D3 บอท: ไม่มีช่อง researchHold/ช่องผิดรูป/อยู่บนงานที่ไม่ใช่ pending = ข้อความ/คำขอ/log/timer เท่าซอร์สที่ถอด hook ทุกไบต์', async () => {
  await checkBotParity(SRC.bot, stripBotHook(SRC.bot));
  // โค้ดที่ W3 เติมในบอทต้องไม่อ่าน env/โมดูลรีเสิร์ชเอง (อ่านแค่ช่องในคำตอบคิว) — กันชนตัวถอดเลน C ใน bot-research-card
  const w3Code = BOT_W3_EDITS.map(([now]) => now.join('\n')).join('\n');
  assert.ok(!/RESEARCH_AGENT|\bresearch\./u.test(w3Code), 'W3 ไม่เติมการอ่าน env/โมดูลรีเสิร์ชในบอท');
});

// ============================================================
// เอกสาร + ทะเบียนเทส
// ============================================================
test('docs/.env.example/news-suite: RESEARCH_AGENT_HOLD_MS มีตัวอย่าง [Vercel] · คู่มือมีแถว env + วิธีถอย + หัวข้อคิวชะลอ · เทสนี้อยู่ในด่าน', () => {
  assert.match(SRC.env, /^# \[Vercel\][^\n]*คิวชะลอหยิบงาน[^\n]*\n(?:#[^\n]*\n)*# RESEARCH_AGENT_HOLD_MS=360000$/mu);
  assert.ok(SRC.doc.split('\n').some((l) => l.startsWith('| `RESEARCH_AGENT_HOLD_MS` | Vercel |')), 'ตาราง env');
  assert.ok(SRC.doc.includes('`RESEARCH_AGENT_HOLD_MS=0` → Redeploy'), 'วิธีถอย');
  assert.ok(SRC.doc.includes('**คิวชะลอหยิบงาน (W3 · SPEC-v3 ส่วน 9):**'), 'หัวข้อในส่วนโหมด write');
  assert.ok(JSON.parse(SRC.suite).include.includes('tests/research-queue-hold.test.mjs'), 'ลงทะเบียนใน tests/news-suite.json');
});

// ============================================================
// E. mutation — ข้อสอบต้องแดงทุกแบบ (ของจริงเขียวในข้อด้านบน)
// ============================================================
const holdMutant = (from, to, label) => importSource(replaceOnce(SRC.hold, from, to, label), tag(`hold-${label}`));

test('E. mutation 15 แบบ — ข้อสอบต้องแดงทุกแบบ', async (t) => {
  await t.test('M1 queueService: slice ก่อน hold → งานถัดไปที่ไม่ถูก hold ไม่ได้หยิบ', async () => {
    const src = replaceOnce(SRC.queue,
      '      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));\n    const _pickable',
      '      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))\n      .slice(0, availableSlots);\n    const _pickable', 'M1');
    await assert.rejects(checkQueueHoldSkips(await loadQueueCopy(src, 'queue-m1')));
  });
  await t.test('M2 queueService: เปิด hold ทุกโหมด (ไม่เช็ค MODE=write) → shadow/assist เรียก/ import ตัวช่วย', async () => {
    const src = replaceOnce(SRC.queue, " && _raEnv(process.env.RESEARCH_AGENT_MODE).toLowerCase() === 'write')\n      ? await import", ')\n      ? await import', 'M2');
    const legacy = await loadQueueCopy(stripQueueHook(SRC.queue), 'queue-legacy-m2');
    await assert.rejects(checkQueueParity(await loadQueueCopy(src, 'queue-m2'), legacy));
  });
  await t.test('M3 queueService: ไม่ catch ตัวช่วยล้ม → getNextPendingJobs โยน (ข่าวค้างคิว)', async () => {
    const src = replaceOnce(SRC.queue, '        .catch(() => _pendingHere)\n', '', 'M3');
    await assert.rejects(checkQueueFailOpen(await loadQueueCopy(src, 'queue-m3')));
  });
  await t.test('M4 queueHold: นับ done เป็นสถานะรอ → ใบขอเสร็จแล้วยังถูก hold', async () => {
    await assert.rejects(checkHoldCases(await holdMutant("new Set(['queued', 'leased'])", "new Set(['queued', 'leased', 'done'])", 'M4')));
  });
  await t.test('M5 queueHold: ไม่มีเพดานอายุ → hold เกิน RESEARCH_AGENT_HOLD_MS', async () => {
    await assert.rejects(checkHoldCases(await holdMutant('  if (ageMs >= holdMs) return null; // ครบเวลา hold แล้ว\n', '', 'M5')));
  });
  await t.test('M6 queueHold: อ่านค้างเกิน 3 วิแล้ว hold ทุกงาน (fail-closed) → ข่าวค้าง', async () => {
    await assert.rejects(checkFailOpen(await holdMutant("      return pass('timeout');", "      return { ready: [], held: [], holdMs, reason: 'timeout' };", 'M6')));
  });
  await t.test('M7 queueHold: ไม่สน worker ออฟไลน์ → ข่าวช้า 6 นาทีทุกชิ้นตอน worker ดับ', async () => {
    await assert.rejects(checkHoldCases(await holdMutant('    if (!workerSeen.some((t) => nowMs - t <= offlineAfterMs)) return null;', '', 'M7')));
  });
  await t.test('M8 queueHold: ไม่สนเส้นตายใบขอ → hold ใบที่หมดอายุแล้ว', async () => {
    await assert.rejects(checkHoldCases(await holdMutant('  if (Number.isFinite(deadlineMs) && deadlineMs <= nowMs) return null;', '', 'M8')));
  });
  await t.test('M9 queueHold: log บรรทัดละงาน (ไม่ใช่บรรทัดเดียวต่อรอบ)', async () => {
    await assert.rejects(checkReadyOrderAndLog(await holdMutant('  emit(log, holdLine(held, holdMs));', '  for (const h of held) emit(log, holdLine([h], holdMs));', 'M9')));
  });
  await t.test('M10 queueHold: ค่าเริ่มต้นไม่บวก 60 วิ → hold สั้นกว่าเวลารอของท่อ', async () => {
    await assert.rejects(checkHoldMs(await holdMutant('export const RESEARCH_HOLD_EXTRA_MS = 60_000;', 'export const RESEARCH_HOLD_EXTRA_MS = 0;', 'M10')));
  });
  await t.test('M11 queueHold: ไม่มีเพดานจำนวนงานที่ตรวจ', async () => {
    await assert.rejects(checkScanLimit(await holdMutant('.filter(isHoldCandidate).slice(0, RESEARCH_HOLD_SCAN_LIMIT)', '.filter(isHoldCandidate)', 'M11')));
  });
  await t.test('M12 queue/status: ไม่ส่ง researchHold ในคำตอบ → บอทไม่รู้ว่ากำลังค้นคว้า', async () => {
    const legacy = await importSource(stripRouteHook(SRC.status), tag('status-legacy-m12'));
    const src = replaceOnce(SRC.status, '      ...(researchHold ? { researchHold } : {}),', '', 'M12');
    await assert.rejects(checkRouteHold(await importSource(src, tag('status-m12')), legacy));
  });
  await t.test('M13 บอท: ไม่ยืดเวลารอผล → ตัดหมดเวลา 15 นาทีทั้งที่งานยังเดิน', async () => {
    const src = replaceOnce(SRC.bot, 'while (Date.now() - pollStartTime < maxPollTime + holdExtraMs) {', 'while (Date.now() - pollStartTime < maxPollTime) {', 'M13');
    await assert.rejects(checkBotDeadline(src));
  });
  await t.test('M14 บอท: ปลุก worker ระหว่าง hold → เปลืองโควตาปลุก', async () => {
    const src = replaceOnce(SRC.bot, "if (st.status === 'pending' && !hold && (Date.now()", "if (st.status === 'pending' && (Date.now()", 'M14');
    await assert.rejects(checkBotHoldFlow(src));
  });
  await t.test('M15 บอท: กลับเข้า hold ไม่แก้ข้อความกลับ (ค้าง "รอคิว")', async () => {
    const src = replaceOnce(SRC.bot, "          if (lastStatus !== 'research_hold' || holdText !== lastHoldText) {", '          if (holdText !== lastHoldText) {', 'M15');
    await assert.rejects(checkBotReentry(src));
  });
});

// ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): กลายพันธุ์ข้อเสริม — ข้อสอบต้องแดงทุกแบบ (ของจริงเขียวใน A2/A9/A10)
test('E2 (W5) mutation 3 แบบ — ข้อสอบต้องแดงทุกแบบ', async (t) => {
  await t.test('MW5-1 queueHold: ไม่ดูชีพจรใบ leased → worker ตายกลางงานยัง hold เต็ม 6 นาที', async () => {
    await assert.rejects(checkHoldCases(await holdMutant('  if (isResearchLeaseStale(row, nowMs)) return null;\n', '', 'MW5-1')), /ชีพจรขาด 151 วิ|ไม่มี heartbeatAt/u);
  });
  await t.test('MW5-2 queueHold: ไม่กรองสาย URL → งาน URL ล้วนถูกชะลอเปล่า', async () => {
    const from = '  if (!isTextPathInput(job.payload)) return false; // ★ 1 ต.ค. 69 (W5): สาย URL/รูป ไม่ใช้ฉบับเสริม = ไม่ชะลอ (หยิบตามปกติ)\n';
    await assert.rejects(checkTextPathOnly(await holdMutant(from, '', 'MW5-2')), /hold เฉพาะงานสายข้อความ/u);
  });
  await t.test('MW5-3 modes: นับชีพจรจาก leasedAt อย่างเดียว (ไม่ดู heartbeatAt) → worker ที่ยังส่งชีพจรถูกตัดว่าตาย', async () => {
    const m = await importSource(replaceOnce(MODES_SRC, 'request.heartbeatAt ?? request.leasedAt ??', 'request.leasedAt ??', 'MW5-3'), tag('modes-MW5-3'));
    assert.throws(() => checkLeaseStaleUnit(m), /150 วิพอดี|heartbeatAt ชนะ/u);
  });
});
