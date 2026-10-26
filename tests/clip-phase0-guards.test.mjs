/**
 * ★ 25 ต.ค. 69 เฟส 0 (กันพัง) — เทสพฤติกรรมจริงของ route คิวคลิปหลังเลิกดึงคิวทั้งก้อน + ปิดช่องโหว่
 *   P1: queue-list / job-status / ชีพจรเครื่องทีม ต้องไม่โหลด clip-jobs ทั้งก้อน (ใบที่เสร็จพกผลถอดเต็ม)
 *   P2: job-status อ่านฐานพลาด = 503 (งานยังทำอยู่) ไม่ใช่ 404 "ไม่พบงาน"
 *   P6: ลบทั้งคลังไม่ได้ · probe Gemini ต้องมีกุญแจ · submit ตรวจ hostname จริง
 * เทคนิค: module.register แปลง @/ → src/ และแทน persistStore/supabase/genai ด้วยตัวปลอมที่คุมผ่าน globalThis.__p0
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const STUBS = {
  persist: `
    export function createStore(name) { return globalThis.__p0.store(name); }
  `,
  supabase: `
    export function getSupabase() { return globalThis.__p0.supabase; }
    export function isSupabaseReady() { return globalThis.__p0.ready; }
  `,
  genai: `
    export class GoogleGenerativeAI {
      constructor() {}
      getGenerativeModel() {
        return { async generateContent() { globalThis.__p0.genaiCalls += 1; return { response: { text: () => '{"ok":true}' } }; } };
      }
    }
  `,
};
const STUB_BY_SPECIFIER = {
  '@/lib/persistStore': 'persist',
  '@/lib/supabase': 'supabase',
  '@google/generative-ai': 'genai',
};
const STUB_URLS = Object.fromEntries(Object.entries(STUBS)
  .map(([key, source]) => [key, `data:text/javascript,${encodeURIComponent(source)}`]));
const LOADER = `
const SRC = ${JSON.stringify(new URL('../src/', import.meta.url).href)};
const NEXT_SERVER = ${JSON.stringify(new URL('../node_modules/next/server.js', import.meta.url).href)};
const STUB_URLS = ${JSON.stringify(STUB_URLS)};
const BY_SPEC = ${JSON.stringify(STUB_BY_SPECIFIER)};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const hasExt = (s) => /[.][a-z]+$/i.test(s.split('?')[0]);
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return nextResolve(NEXT_SERVER, context);
  if (has(BY_SPEC, specifier)) return { url: STUB_URLS[BY_SPEC[specifier]], shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const path = specifier.slice(2);
    return nextResolve(new URL(hasExt(path) ? path : path + '.js', SRC).href, context);
  }
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !hasExt(specifier)) return nextResolve(specifier + '.js', context);
    throw error;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(LOADER)}`, import.meta.url);

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const HEARTBEAT_ID = '__clip_worker_heartbeat__';

/** ฐานปลอมแบบ PostgREST เท่าที่ route ใช้: select คอลัมน์/alias · eq/filter(eq|lt|in) · order · limit · head count · maybeSingle · update · insert */
function makeDb(rowsInit = []) {
  const rows = new Map(rowsInit.map((r) => [r.id, { id: r.id, store_name: r.store_name || 'clip-jobs', data: clone(r.data), created_at: r.created_at || r.data?.createdAt || '2026-10-25T00:00:00.000Z', updated_at: r.updated_at || r.data?.updatedAt || r.data?.createdAt || '2026-10-25T00:00:00.000Z' }]));
  const log = { selects: [], updates: 0, inserts: 0 };
  let failReads = false;
  let failCounts = false; // ★ เฟส 4 (ผู้ตรวจ): อ่านแถวงานได้ แต่ query นับคิว (head count) สะดุด
  const valueAt = (row, col) => {
    if (col.startsWith('data->>')) { const v = row.data?.[col.slice(7)]; return v == null ? v : String(v); }
    if (col.startsWith('data->')) return row.data?.[col.slice(6)];
    return row[col];
  };
  const project = (row, cols) => {
    if (cols === 'data') return { data: clone(row.data) };
    if (cols === 'id') return { id: row.id };
    const out = {};
    for (const part of cols.split(',').map((s) => s.trim())) {
      const [alias, expr] = part.includes(':') ? part.split(':') : [part, part];
      out[alias] = clone(valueAt(row, expr));
    }
    return out;
  };
  class Q {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.cols = '*'; this.opts = {}; this.ord = null; this.lim = null; }
    select(cols = '*', opts = {}) {
      if (this.op === 'update') { this.returning = cols; return this; }
      this.op = 'select'; this.cols = cols; this.opts = opts; log.selects.push({ cols, head: !!opts.head }); return this;
    }
    update(payload) { this.op = 'update'; this.payload = clone(payload); return this; }
    insert(row) { log.inserts += 1; rows.set(row.id, clone(row)); return Promise.resolve({ data: null, error: null }); }
    eq(col, v) { this.filters.push([col, 'eq', v]); return this; }
    neq(col, v) { this.filters.push([col, 'neq', v]); return this; }
    filter(col, op, v) { this.filters.push([col, op, v]); return this; }
    order(col, { ascending = true } = {}) { this.ord = [col, ascending]; return this; }
    limit(n) { this.lim = n; return this; }
    match(row) {
      return this.filters.every(([col, op, v]) => {
        const a = valueAt(row, col);
        if (op === 'eq') return a === v || (a != null && String(a) === String(v));
        if (op === 'neq') return !(a === v || (a != null && String(a) === String(v)));
        if (op === 'lt') return a != null && String(a) < String(v);
        if (op === 'in') return String(v).replace(/^\(|\)$/g, '').split(',').includes(a);
        throw new Error(`fake op ${op}`);
      });
    }
    matched() {
      let list = [...rows.values()].filter((r) => this.match(r));
      if (this.ord) list.sort((x, y) => (String(x[this.ord[0]]) < String(y[this.ord[0]]) ? -1 : 1) * (this.ord[1] ? 1 : -1));
      if (this.lim != null) list = list.slice(0, this.lim);
      return list;
    }
    async run() {
      if (this.op === 'update') {
        log.updates += 1;
        const list = this.matched();
        for (const r of list) Object.assign(r, clone(this.payload));
        return { data: list.map((r) => ({ id: r.id })), error: null };
      }
      if (failReads || (failCounts && this.opts.head)) return { data: null, count: null, error: { message: 'fetch failed: upstream timeout' } };
      const list = this.matched();
      if (this.opts.head) return { data: null, count: list.length, error: null };
      return { data: list.map((r) => project(r, this.cols)), error: null };
    }
    async maybeSingle() {
      if (failReads) return { data: null, error: { message: 'fetch failed: upstream timeout' } };
      const list = this.matched();
      return { data: list[0] ? project(list[0], this.cols) : null, error: null };
    }
    then(res, rej) { return this.run().then(res, rej); }
  }
  return {
    supabase: { from: (t) => new Q(t) },
    rows, log,
    setFailReads(v) { failReads = v; },
    setFailCounts(v) { failCounts = v; },
  };
}

function makeStore(db) {
  const calls = { getAll: 0, remove: 0, add: 0 };
  const store = () => ({
    async getAll() { calls.getAll += 1; return [...db.rows.values()].filter((r) => r.store_name === 'clip-jobs').map((r) => clone(r.data)); },
    async findById(id) { const r = db.rows.get(id); return r ? clone(r.data) : null; },
    async remove() { calls.remove += 1; return { removed: true }; },
    async add(item) { calls.add += 1; db.rows.set(item.id, { id: item.id, store_name: 'clip-jobs', data: clone(item), created_at: item.createdAt, updated_at: item.createdAt }); return item; },
    async update(id, fn) { const r = db.rows.get(id); r.data = fn(clone(r.data)); return clone(r.data); },
  });
  return { store, calls };
}

function setup(jobs, { ready = true } = {}) {
  const db = makeDb(jobs.map((j) => ({ id: j.id, data: j })));
  const { store, calls } = makeStore(db);
  globalThis.__p0 = { supabase: db.supabase, ready, store, genaiCalls: 0 };
  return { db, calls };
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const job = (id, status, extra = {}) => ({ id, url: `https://www.tiktok.com/@a/video/${id}`, platform: 'tiktok', kind: 'insight', user: 'ขิง', status, createdAt: iso(60_000), ...extra });
const req = (url, headers = {}) => ({ url, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, async json() { return {}; } });

const queueList = await import(new URL('../src/app/api/clip-transcript/queue-list/route.js', import.meta.url).href);
const jobStatus = await import(new URL('../src/app/api/clip-transcript/job-status/route.js', import.meta.url).href);
const cases = await import(new URL('../src/app/api/clip-transcript/cases/route.js', import.meta.url).href);
const geminiHealth = await import(new URL('../src/app/api/clip-transcript/gemini-health/route.js', import.meta.url).href);
const submit = await import(new URL('../src/app/api/clip-transcript/submit/route.js', import.meta.url).href);
const agentStatus = await import(new URL('../src/app/api/clip-agent/status/route.js', import.meta.url).href);

function sampleQueue() {
  return [
    job('done-heavy', 'done', { createdAt: iso(600_000), doneAt: iso(500_000), updatedAt: iso(500_000), result: { rawData: 'ผลถอดเต็ม'.repeat(5000) } }),
    job('err-1', 'error', { createdAt: iso(400_000), doneAt: iso(300_000), updatedAt: iso(300_000), error: 'yt-dlp ล้ม' }),
    job('cancel-1', 'cancelled', { createdAt: iso(350_000), cancelledAt: iso(340_000), updatedAt: iso(340_000) }),
    job('proc-1', 'processing', { createdAt: iso(200_000), startedAt: iso(100_000), attempts: 1 }),
    job('pend-1', 'pending', { createdAt: iso(90_000) }),
    job('pend-2', 'pending', { createdAt: iso(30_000) }),
    job('retry-1', 'retry_wait', { createdAt: iso(120_000), attempts: 2, nextRetryAt: iso(-60_000), statusNote: 'รอลองใหม่' }),
    { id: HEARTBEAT_ID, lastSeenAt: iso(20_000), host: '', version: 'clip-lease-v1' },
  ];
}

test('P1 queue-list: โหมด Supabase ไม่โหลดคิวทั้งก้อน และคืนผลเหมือนทางเดิมทุก field', async () => {
  const sample = sampleQueue();
  const { db, calls } = setup(sample);
  const fast = await (await queueList.GET()).json();
  assert.equal(calls.getAll, 0, 'ต้องไม่เรียก getAll ทั้งคิว');
  assert.equal(db.log.selects.filter((s) => s.cols === 'data' && !s.head).length, 1,
    'select คอลัมน์ data เต็มได้ครั้งเดียว คือแถวชีพจร');
  assert.ok(!JSON.stringify(fast).includes('ผลถอดเต็ม'), 'ห้ามมีผลถอดหลุดมาในรายการคิว');

  setup(sample, { ready: false }); // ทางไฟล์ = ตรรกะเดิมทุกบรรทัด ใช้เป็นเฉลย
  const legacy = await (await queueList.GET()).json();
  assert.deepEqual(fast.counts, legacy.counts);
  assert.deepEqual(fast.active, legacy.active);
  assert.deepEqual(fast.recent, legacy.recent);
  assert.equal(fast.worker.alive, true);
  assert.equal(legacy.worker.alive, true);
  assert.equal(fast.counts.pending, 2);
  assert.equal(fast.counts.cancelled, 1);
});

test('P1 ชีพจรเครื่องทีม: เขียนแถวเดียว ไม่โหลดคิวทั้งก้อน · ไม่มีแถว = สร้างใหม่', async () => {
  const hb = await import(new URL(`../src/app/api/clip-transcript/workerHeartbeat.js?fresh=${Date.now()}`, import.meta.url).href);
  const { db, calls } = setup([job('pend-1', 'pending'), { id: HEARTBEAT_ID, lastSeenAt: iso(600_000) }]);
  hb.touchWorkerHeartbeat({ host: 'team-pc', version: 'clip-lease-v1' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.getAll, 0, 'ชีพจรต้องไม่ getAll');
  assert.equal(db.log.updates, 1);
  assert.equal(db.log.inserts, 0);
  assert.ok(Date.parse(db.rows.get(HEARTBEAT_ID).data.lastSeenAt) > Date.now() - 5_000, 'lastSeenAt ต้องเป็นเวลาปัจจุบัน');

  const hb2 = await import(new URL(`../src/app/api/clip-transcript/workerHeartbeat.js?fresh2=${Date.now()}`, import.meta.url).href);
  const second = setup([job('pend-1', 'pending')]);
  hb2.touchWorkerHeartbeat({ host: 'team-pc' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(second.db.log.inserts, 1, 'ไม่มีแถวชีพจร = insert ใหม่');
  assert.equal(second.db.rows.get(HEARTBEAT_ID).data.host, 'team-pc');
});

test('P1/P2 job-status: ลำดับคิวนับด้วย count · ฐานสะดุด = 503 ไม่ใช่ 404 · ไม่มีใบ = 404', async () => {
  const { db, calls } = setup(sampleQueue());
  const pending = await (await jobStatus.GET(req('https://x/api/clip-transcript/job-status?id=pend-2'))).json();
  assert.equal(pending.position, 3, 'ข้างหน้ามี pend-1 + proc-1 → ลำดับที่ 3');
  assert.equal(calls.getAll, 0, 'job-status ต้องไม่ getAll');

  db.setFailReads(true);
  const flaky = await jobStatus.GET(req('https://x/api/clip-transcript/job-status?id=pend-2'));
  assert.equal(flaky.status, 503);
  assert.equal((await flaky.json()).errorType, 'JOB_STATUS_TEMPORARILY_UNAVAILABLE');

  db.setFailReads(false);
  const missing = await jobStatus.GET(req('https://x/api/clip-transcript/job-status?id=nope'));
  assert.equal(missing.status, 404);

  // ★ 26 ต.ค. 69 (เฟส 4 · ตัวกลาง queuePosition): แถวชีพจรของ worker อยู่ในคิวเดียวกัน — ต่อให้มีสถานะ pending ก็ห้ามนับเป็นงาน
  setup(sampleQueue().map((r) => (r.id === HEARTBEAT_ID ? { ...r, status: 'pending', createdAt: iso(999_000) } : r)));
  const withBeat = await (await jobStatus.GET(req('https://x/api/clip-transcript/job-status?id=pend-2'))).json();
  assert.equal(withBeat.position, 3, 'แถวชีพจรต้องไม่ดันลำดับคิว');
});

test('เฟส 4 (ผู้ตรวจ): อ่านใบงานได้แต่นับคิวสะดุด — job-status = 503 · clip-agent/status = 200 ตอบสถานะ ลำดับคิว null', async () => {
  const { db } = setup(sampleQueue());
  db.setFailCounts(true);
  const flaky = await jobStatus.GET(req('https://x/api/clip-transcript/job-status?id=pend-2'));
  assert.equal(flaky.status, 503, 'job-status: นับคิวล้ม = งานยังอยู่ ไม่ใช่ 500');
  assert.equal((await flaky.json()).errorType, 'JOB_STATUS_TEMPORARILY_UNAVAILABLE');

  const saved = process.env.CLIP_AGENT_API_KEY;
  process.env.CLIP_AGENT_API_KEY = 'p0-agent-key';
  try {
    const res = await agentStatus.GET(req('https://x/api/clip-agent/status?id=pend-2', { 'x-clip-agent-key': 'p0-agent-key' }));
    assert.equal(res.status, 200, 'เอเจนต์ต้องได้สถานะ ไม่ใช่ 500 STATUS_ERROR');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, 'pending');
    assert.equal(body.position, null, 'นับคิวไม่ได้ = null (ไม่เดาเลข)');

    db.setFailCounts(false);
    const ok = await (await agentStatus.GET(req('https://x/api/clip-agent/status?id=pend-2', { 'x-clip-agent-key': 'p0-agent-key' }))).json();
    assert.equal(ok.position, 3, 'ฐานกลับมา = ลำดับคิวตามจริง');

    // error ที่ไม่ใช่ "ฐานสะดุดชั่วคราว" (เช่นโค้ดพัง) ต้องไม่ถูกกลืนเป็น null — ยังเป็น 500 ให้ตามรอยได้
    globalThis.__p0.supabase = { from() { throw new Error('client พัง (ไม่ใช่ฐานสะดุด)'); } };
    const broken = await agentStatus.GET(req('https://x/api/clip-agent/status?id=pend-2', { 'x-clip-agent-key': 'p0-agent-key' }));
    assert.equal(broken.status, 500);
    assert.equal((await broken.json()).errorType, 'STATUS_ERROR');
  } finally {
    if (saved === undefined) delete process.env.CLIP_AGENT_API_KEY;
    else process.env.CLIP_AGENT_API_KEY = saved;
  }
});

test('P6 cases: ลบทั้งคลังด้วย id=all ไม่ได้ และไม่ลบอะไรเลย', async () => {
  const { calls } = setup(sampleQueue());
  const res = await cases.DELETE(req('https://x/api/clip-transcript/cases?kind=insight&id=all'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).errorType, 'BULK_DELETE_DISABLED');
  assert.equal(calls.remove, 0);
});

test('P6 gemini-health: probe ยิง Gemini ได้เฉพาะมีกุญแจ worker', async () => {
  const old = process.env.CLIP_WORKER_SECRET;
  const oldKey = process.env.GEMINI_VIDEO_API_KEY;
  process.env.CLIP_WORKER_SECRET = 'p0-secret';
  process.env.GEMINI_VIDEO_API_KEY = 'fake-key';
  try {
    setup([]);
    const denied = await geminiHealth.GET(req('https://x/api/clip-transcript/gemini-health?probe=gemini-3.7-flash&max=65536'));
    assert.equal(denied.status, 401);
    assert.equal(globalThis.__p0.genaiCalls, 0, 'ไม่มีกุญแจต้องไม่ยิง Gemini');
    const wrong = await geminiHealth.GET(req('https://x/api/clip-transcript/gemini-health?probe=gemini-3.7-flash', { 'x-clip-worker-secret': 'wrong' }));
    assert.equal(wrong.status, 401);
    const allowed = await geminiHealth.GET(req('https://x/api/clip-transcript/gemini-health?probe=gemini-3.7-flash', { 'x-clip-worker-secret': 'p0-secret' }));
    assert.equal(allowed.status, 200);
    assert.equal(globalThis.__p0.genaiCalls, 1);
  } finally {
    if (old === undefined) delete process.env.CLIP_WORKER_SECRET; else process.env.CLIP_WORKER_SECRET = old;
    if (oldKey === undefined) delete process.env.GEMINI_VIDEO_API_KEY; else process.env.GEMINI_VIDEO_API_KEY = oldKey;
  }
});

test('P6 submit: ตรวจ hostname จริง — ลิงก์ที่แค่มีคำ facebook.com ปนต้องไม่เข้าคิว', async () => {
  const post = (url) => submit.POST({ async json() { return { url, user: 'ขิง' }; } });
  const { calls } = setup([]);
  for (const bad of ['http://192.168.1.1/?facebook.com', 'http://127.0.0.1:3000/x?v=youtube.com', 'https://evil.example/tiktok.com/video/1']) {
    const res = await post(bad);
    assert.equal(res.status, 400, `ต้องปฏิเสธ ${bad}`);
    assert.equal((await res.json()).errorType, 'UNSUPPORTED_URL');
  }
  assert.equal(calls.add, 0, 'ลิงก์ปลอมต้องไม่ถูกเขียนลงคิว');
  for (const good of ['https://www.facebook.com/share/v/14vwEggt85d/', 'https://vt.tiktok.com/ZSgSW1BHu/', 'https://youtu.be/abc123', 'https://m.youtube.com/watch?v=abc']) {
    const res = await post(good);
    assert.equal(res.status, 200, `ต้องรับ ${good}`);
  }
});

test('P1 queue-list (ผู้ตรวจรอบ 2): อ่านแบบเบาพลาด = ใช้ภาพล่าสุดที่สำเร็จ ไม่ยิงฐานแบบหนักซ้ำ', async () => {
  const { db, calls } = setup(sampleQueue());
  const first = await (await queueList.GET()).json();
  db.setFailReads(true);
  const second = await (await queueList.GET()).json();
  assert.equal(second.success, true);
  assert.deepEqual(second.counts, first.counts);
  assert.equal(calls.getAll, 0, 'ต้องไม่ถอยไป getAll ทั้งคิวขณะฐานสะดุด เมื่อมีภาพล่าสุดอยู่');
});
