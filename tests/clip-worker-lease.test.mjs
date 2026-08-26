import assert from 'node:assert/strict';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROUTE_PATH = new URL('../src/app/api/clip-transcript/worker/route.js', import.meta.url);
const WORKER_PATH = new URL('../scripts/clip-worker.mjs', import.meta.url);
// Git may materialize tracked LF files as CRLF on Windows. Mutation fixtures use LF
// literals, so normalize only the in-memory test sources (production files stay untouched).
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, 'utf8').replace(/\r\n/g, '\n');
const WORKER_SOURCE = readFileSync(WORKER_PATH, 'utf8').replace(/\r\n/g, '\n');
const PROTOCOL = 'clip-lease-v1';
const WORKER_SECRET = 'clip-worker-test-secret';

const clone = value => value === undefined ? undefined : structuredClone(value);

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: ไม่พบข้อความต้นทาง`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: ข้อความต้นทางต้องมีจุดเดียว`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function makeJob(overrides = {}) {
  return {
    id: 'clip-1',
    url: 'https://example.com/video',
    kind: 'insight',
    platform: 'youtube',
    status: 'pending',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function makeRequest(body = null, version = PROTOCOL, secret = WORKER_SECRET) {
  return {
    headers: {
      get(name) {
        const normalized = String(name).toLowerCase();
        if (normalized === 'x-clip-worker-version') return version;
        if (normalized === 'x-clip-worker-secret') return secret;
        return null;
      },
    },
    async json() { return clone(body); },
  };
}

function makeReadBarrier(target) {
  let arrivals = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === target) release();
    await gate;
  };
}

function makeSupabaseHarness(initialJobs, { beforeUpdate = null, beforeGetAll = null } = {}) {
  const rows = new Map(initialJobs.map(job => [job.id, {
    id: job.id,
    store_name: 'clip-jobs',
    data: clone(job),
    created_at: job.createdAt,
    updated_at: job.createdAt,
  }]));

  function valueAt(row, column) {
    if (column.startsWith('data->>')) return row.data?.[column.slice('data->>'.length)];
    return row[column];
  }

  class Query {
    constructor() {
      this.operation = '';
      this.payload = null;
      this.filters = [];
      this.columns = 'data';
    }

    update(payload) {
      this.operation = 'update';
      this.payload = clone(payload);
      return this;
    }

    select(columns) {
      if (this.operation === 'update') return this.executeUpdate(columns);
      this.operation = 'select';
      this.columns = columns;
      return this;
    }

    eq(column, value) {
      this.filters.push({ column, operator: 'eq', value });
      return this;
    }

    filter(column, operator, value) {
      this.filters.push({ column, operator, value });
      return this;
    }

    is(column, value) {
      this.filters.push({ column, operator: 'is', value });
      return this;
    }

    matches(row) {
      return this.filters.every(({ column, operator, value }) => {
        const actual = valueAt(row, column);
        if (operator === 'is') return value === null ? actual == null : actual === value;
        if (operator === 'eq') return actual === value;
        if (operator === 'gt') return actual > value;
        throw new Error(`unsupported fake operator: ${operator}`);
      });
    }

    selected(row, columns) {
      return columns === 'id' ? { id: row.id } : { data: clone(row.data) };
    }

    async single() {
      const matched = [...rows.values()].filter(row => this.matches(row));
      if (matched.length !== 1) return { data: null, error: { message: 'not found' } };
      return { data: this.selected(matched[0], this.columns), error: null };
    }

    async executeUpdate(columns) {
      if (beforeUpdate) await beforeUpdate({ payload: clone(this.payload), filters: clone(this.filters), rows });
      const matched = [...rows.values()].filter(row => this.matches(row));
      for (const row of matched) Object.assign(row, clone(this.payload));
      return { data: matched.map(row => this.selected(row, columns)), error: null };
    }
  }

  const supabase = { from() { return new Query(); } };
  let localTail = Promise.resolve();
  const store = {
    async getAll() {
      if (beforeGetAll) await beforeGetAll();
      return [...rows.values()].map(row => clone(row.data));
    },
    async update(id, updateFn) {
      const task = localTail.then(async () => {
        const row = rows.get(id);
        if (!row) throw new Error(`ไม่พบ id: ${id}`);
        row.data = typeof updateFn === 'function'
          ? updateFn(clone(row.data))
          : { ...row.data, ...clone(updateFn) };
        return clone(row.data);
      });
      localTail = task.catch(() => {});
      return task;
    },
  };

  return {
    store,
    supabase,
    getJob(id = 'clip-1') { return clone(rows.get(id)?.data); },
    setJob(job) {
      const row = rows.get(job.id);
      if (!row) throw new Error(`missing fake row: ${job.id}`);
      row.data = clone(job);
    },
  };
}

async function loadRoute({
  jobs,
  source = ROUTE_SOURCE,
  beforeUpdate,
  beforeGetAll,
  supabaseReady = true,
  workerSecret = WORKER_SECRET,
}) {
  const fake = makeSupabaseHarness(jobs, { beforeUpdate, beforeGetAll });
  let tokenNumber = 0;
  const NextResponse = {
    json(body, init = {}) {
      const status = init.status ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        async json() { return clone(body); },
      };
    },
  };

  globalThis.__clipWorkerRouteHarness = {
    randomUUID: () => `lease-token-${++tokenNumber}`,
    NextResponse,
    createStore: () => fake.store,
    getSupabase: () => fake.supabase,
    isSupabaseReady: () => supabaseReady,
    createHash,
    timingSafeEqual,
    workerSecret,
    // ★ 26 ส.ค. 69: ชีพจร "เครื่องทีมยังเปิดอยู่" (workerHeartbeat.js) — harness ตัด import ทิ้ง จึงต้องฉีดเอง
    //   ของจริงยิงแบบไม่รอผลและกลืน error · ที่นี่ทำเป็นตัวนับเฉยๆ เพื่อยืนยันว่า "ไม่รบกวนตรรกะ lease"
    touchWorkerHeartbeat: () => { globalThis.__heartbeatTouches = (globalThis.__heartbeatTouches || 0) + 1; },
    isHeartbeatRow: (x) => !!x && x.id === '__clip_worker_heartbeat__',
  };

  let transformed = source.replace(/^import .*?;\r?\n/gm, '');
  transformed = transformed
    .replaceAll('export const runtime', 'const runtime')
    .replaceAll('export const dynamic', 'const dynamic')
    .replace('export async function GET', 'async function GET')
    .replace('export async function POST', 'async function POST')
    .replace(
      "process.env.CLIP_WORKER_SECRET || process.env.DISCORD_API_SECRET || ''",
      'workerSecret',
    );
  const prefix = 'const { randomUUID, NextResponse, createStore, getSupabase, isSupabaseReady, createHash, timingSafeEqual, workerSecret, touchWorkerHeartbeat, isHeartbeatRow } = globalThis.__clipWorkerRouteHarness;\n';
  transformed = `${prefix}${transformed}\nexport { GET, POST };\n// ${crypto.randomUUID()}\n`;

  try {
    const url = `data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`;
    const loaded = await import(url);
    return { ...loaded, ...fake };
  } finally {
    delete globalThis.__clipWorkerRouteHarness;
  }
}

async function responseBody(response) {
  return response.json();
}

async function assertOneConcurrentOwner(source = ROUTE_SOURCE, { supabaseReady = true } = {}) {
  const barrier = makeReadBarrier(2);
  const route = await loadRoute({ jobs: [makeJob()], source, beforeGetAll: barrier, supabaseReady });
  const [first, second] = await Promise.all([
    route.GET(makeRequest()),
    route.GET(makeRequest()),
  ]);
  const bodies = await Promise.all([responseBody(first), responseBody(second)]);
  const owners = bodies.map(body => body.job).filter(Boolean);
  assert.equal(owners.length, 1, 'สอง worker ต้องได้เจ้าของเพียงหนึ่งตัว');
  assert.equal(route.getJob().claimToken, owners[0].claimToken);
  assert.equal(route.getJob().status, 'processing');
}

async function assertHeartbeatExtends(source = ROUTE_SOURCE) {
  const originalLease = new Date(Date.now() + 5 * 60_000).toISOString();
  const route = await loadRoute({ jobs: [makeJob({
    status: 'processing',
    claimToken: 'current-token',
    startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    leaseExpiresAt: originalLease,
  })], source });
  const response = await route.POST(makeRequest({
    id: 'clip-1', status: 'heartbeat', claimToken: 'current-token',
  }));
  assert.equal(response.status, 200);
  assert.ok(new Date(route.getJob().leaseExpiresAt) > new Date(originalLease), 'heartbeat ต้องต่อ lease จริง');
}

async function assertExpiredFailsClosed(source = ROUTE_SOURCE) {
  const route = await loadRoute({ jobs: [makeJob({
    status: 'processing',
    claimToken: 'expired-token',
    startedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
  })], source });
  const response = await route.GET(makeRequest());
  assert.equal((await responseBody(response)).job, null, 'งานหมด lease ห้ามถูกส่งไปถอดใหม่');
  assert.equal(route.getJob().status, 'error');
  assert.equal(route.getJob().claimToken, null);
  assert.match(route.getJob().error, /กันเสียค่า API ซ้ำ/);
}

async function assertStaleCompletionRace(source = ROUTE_SOURCE) {
  let reachedUpdate;
  let releaseUpdate;
  const updateReached = new Promise(resolve => { reachedUpdate = resolve; });
  const updateRelease = new Promise(resolve => { releaseUpdate = resolve; });
  const route = await loadRoute({
    jobs: [makeJob({
      status: 'processing', claimToken: 'old-token',
      startedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    })],
    source,
    beforeUpdate: async ({ payload }) => {
      if (payload?.data?.status !== 'done') return;
      reachedUpdate();
      await updateRelease;
    },
  });

  const reporting = route.POST(makeRequest({
    id: 'clip-1', status: 'done', claimToken: 'old-token', result: { transcript: 'old' },
  }));
  await updateReached;
  route.setJob({
    ...route.getJob(), claimToken: 'new-token',
    leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  });
  releaseUpdate();
  const response = await reporting;
  assert.equal(response.status, 409, 'เจ้าของเก่าที่กำลังเขียนชนกับเจ้าของใหม่ต้องแพ้');
  assert.equal(route.getJob().claimToken, 'new-token');
  assert.equal(route.getJob().status, 'processing');
}

async function assertAuthorizationGate(source = ROUTE_SOURCE) {
  const route = await loadRoute({ jobs: [makeJob()], source });
  const missingGet = await route.GET(makeRequest(null, PROTOCOL, ''));
  assert.equal(missingGet.status, 401, 'GET ไม่มี secret ต้องไม่เห็นหรือ claim งาน');

  const missingPost = await route.POST(makeRequest({
    id: 'clip-1', status: 'done', claimToken: 'guessed-token', result: { transcript: 'forged' },
  }, PROTOCOL, ''));
  assert.equal(missingPost.status, 401, 'POST ไม่มี secret ต้องแก้สถานะงานไม่ได้');
  assert.equal(route.getJob().status, 'pending');
}

async function assertExpiredLeaseCannotRenew(source = ROUTE_SOURCE) {
  for (const status of ['heartbeat', 'retry']) {
    const route = await loadRoute({ jobs: [makeJob({
      status: 'processing',
      claimToken: 'expired-token',
      startedAt: new Date(Date.now() - 21 * 60_000).toISOString(),
      leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    })], source });
    const response = await route.POST(makeRequest({
      id: 'clip-1', status, claimToken: 'expired-token', error: 'late retry',
    }));
    assert.equal(response.status, 409, `${status} หลัง lease หมดต้องถูกปฏิเสธ`);
    assert.equal(route.getJob().status, 'processing');
  }
}

test('worker รุ่นเก่าไม่ได้รับงานหลังเปิด lease protocol', async () => {
  const route = await loadRoute({ jobs: [makeJob()] });
  const response = await route.GET(makeRequest(null, 'legacy-worker'));
  assert.equal(response.status, 426);
  assert.equal((await responseBody(response)).errorType, 'WORKER_UPGRADE_REQUIRED');
  assert.equal(route.getJob().status, 'pending');
});

test('worker endpoint ปิดข้อมูลคิวเมื่อ secret หาย ผิด หรือ server ยังไม่ได้ตั้งค่า', async () => {
  await assertAuthorizationGate();
  const route = await loadRoute({ jobs: [makeJob()] });

  const missing = await route.GET(makeRequest(null, PROTOCOL, ''));
  assert.equal(missing.status, 401);
  assert.equal((await responseBody(missing)).errorType, 'CLIP_WORKER_UNAUTHORIZED');

  const wrong = await route.GET(makeRequest(null, PROTOCOL, 'wrong-secret'));
  assert.equal(wrong.status, 401);
  assert.equal((await responseBody(wrong)).errorType, 'CLIP_WORKER_UNAUTHORIZED');
  assert.equal(route.getJob().status, 'pending', 'คำขอไม่มีสิทธิ์ต้องไม่ claim งาน');

  const noServerSecret = await loadRoute({ jobs: [makeJob()], workerSecret: '' });
  const unavailable = await noServerSecret.GET(makeRequest());
  assert.equal(unavailable.status, 503);
  assert.equal((await responseBody(unavailable)).errorType, 'CLIP_WORKER_SECRET_UNAVAILABLE');
  assert.equal(noServerSecret.getJob().status, 'pending');
});

test('mutation: ถอด secret gate จาก GET/POST แล้วเทสต์ต้องแดง', async () => {
  const guard = `  const authorizationError = workerAuthorizationResponse(request);
  if (authorizationError) return authorizationError;
`;
  assert.equal(ROUTE_SOURCE.split(guard).length - 1, 2, 'secret gate ต้องอยู่ทั้ง GET และ POST');
  const mutated = ROUTE_SOURCE.replaceAll(guard, '');
  await assert.rejects(() => assertAuthorizationGate(mutated), /ไม่มี secret/);
});

test('Supabase conditional claim ให้สอง worker มีเจ้าของเพียงหนึ่งตัว', async () => {
  await assertOneConcurrentOwner();
});

test('ไม่มี Supabase ต้อง fail closed และไม่หยิบงานจากไฟล์ local', async () => {
  const route = await loadRoute({ jobs: [makeJob()], supabaseReady: false });
  const response = await route.GET(makeRequest());
  assert.equal(response.status, 503);
  assert.equal((await responseBody(response)).errorType, 'CLIP_QUEUE_PRIMARY_UNAVAILABLE');
  assert.equal(route.getJob().status, 'pending');
});

test('งาน 8 นาทีที่ lease ยังมีอายุไม่ถูกกู้ไปถอดซ้ำ', async () => {
  const route = await loadRoute({ jobs: [makeJob({
    status: 'processing',
    claimToken: 'live-token',
    startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 12 * 60_000).toISOString(),
  })] });
  const response = await route.GET(makeRequest());
  assert.equal((await responseBody(response)).job, null);
  assert.equal(route.getJob().claimToken, 'live-token');
});

test('heartbeat ต่อ lease โดยไม่เปลี่ยนสถานะงาน', async () => {
  await assertHeartbeatExtends();
});

test('lease หมดแล้วหยุดเป็น error โดยไม่คืนงานไปถอดซ้ำอัตโนมัติ', async () => {
  await assertExpiredFailsClosed();
});

test('หลัง explicit retry ได้ token ใหม่; token เก่าส่ง done/error/retry ไม่ได้ แต่ token ใหม่ส่ง done ได้', async () => {
  const route = await loadRoute({ jobs: [makeJob({
    status: 'processing',
    claimToken: 'old-token',
    startedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  })] });
  const retry = await route.POST(makeRequest({
    id: 'clip-1', status: 'retry', claimToken: 'old-token', error: 'explicit 503',
  }));
  assert.equal(retry.status, 200);
  route.setJob({ ...route.getJob(), nextRetryAt: new Date(Date.now() - 1_000).toISOString() });
  const claimed = (await responseBody(await route.GET(makeRequest()))).job;
  assert.ok(claimed.claimToken);
  assert.notEqual(claimed.claimToken, 'old-token');

  for (const status of ['done', 'error', 'retry']) {
    const stale = await route.POST(makeRequest({
      id: 'clip-1', status, claimToken: 'old-token',
      result: { transcript: 'stale' }, error: 'stale',
    }));
    assert.equal(stale.status, 409, `token เก่าต้องส่ง ${status} ไม่ได้`);
    assert.equal(route.getJob().claimToken, claimed.claimToken);
    assert.equal(route.getJob().status, 'processing');
  }

  const done = await route.POST(makeRequest({
    id: 'clip-1', status: 'done', claimToken: claimed.claimToken,
    result: { transcript: 'current result' },
  }));
  assert.equal(done.status, 200);
  assert.equal(route.getJob().status, 'done');
  assert.equal(route.getJob().result.transcript, 'current result');
  assert.equal(route.getJob().claimToken, null);
});

test('สอง worker เจองานหมด lease พร้อมกันก็ไม่มีใครได้งานไปถอดใหม่', async () => {
  const barrier = makeReadBarrier(2);
  const route = await loadRoute({ jobs: [makeJob({
    status: 'processing',
    reclaims: 4,
    claimToken: 'expired-token',
    startedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
  })], beforeGetAll: barrier });
  const [first, second] = await Promise.all([route.GET(makeRequest()), route.GET(makeRequest())]);
  assert.equal((await responseBody(first)).job, null);
  assert.equal((await responseBody(second)).job, null);
  assert.equal(route.getJob().status, 'error');
  assert.equal(route.getJob().reclaims, 5);
});

test('token ปัจจุบันส่ง retry ได้ครั้งเดียวและคืนงานไปรอ 3 นาทีโดยล้าง lease', async () => {
  const route = await loadRoute({ jobs: [makeJob({
    status: 'processing',
    attempts: 2,
    claimToken: 'current-token',
    startedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  })] });
  const before = Date.now();
  const response = await route.POST(makeRequest({
    id: 'clip-1', status: 'retry', claimToken: 'current-token', error: 'temporary 503',
  }));
  assert.equal(response.status, 200);
  assert.equal(route.getJob().status, 'retry_wait');
  assert.equal(route.getJob().attempts, 3);
  assert.equal(route.getJob().claimToken, null);
  assert.ok(new Date(route.getJob().nextRetryAt).getTime() >= before + 3 * 60_000);
});

test('heartbeat และ retry ชุบ lease ที่หมดอายุไม่ได้ แต่ผล done เดิมยังเก็บได้เพื่อไม่ทิ้งงานที่จ่ายเงินแล้ว', async () => {
  await assertExpiredLeaseCannotRenew();
  const expired = () => makeJob({
    status: 'processing',
    claimToken: 'expired-token',
    startedAt: new Date(Date.now() - 21 * 60_000).toISOString(),
    leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
  });

  const lateResultRoute = await loadRoute({ jobs: [expired()] });
  const done = await lateResultRoute.POST(makeRequest({
    id: 'clip-1', status: 'done', claimToken: 'expired-token', result: { transcript: 'paid result' },
  }));
  assert.equal(done.status, 200, 'ผลสำเร็จของเจ้าของเดิมยังเก็บได้ตราบใดที่ไม่มีเจ้าของใหม่');
  assert.equal(lateResultRoute.getJob().status, 'done');
  assert.equal(lateResultRoute.getJob().result.transcript, 'paid result');
});

test('mutation: ถอด active-lease gate แล้ว heartbeat/retry ที่หมดอายุต้องถูกเทสต์จับ', async () => {
  const option = ', { requireActiveLease: true });';
  assert.equal(ROUTE_SOURCE.split(option).length - 1, 2, 'active lease option ต้องอยู่ทั้ง heartbeat และ retry');
  const mutated = ROUTE_SOURCE.replaceAll(option, ');');
  await assert.rejects(() => assertExpiredLeaseCannotRenew(mutated), /lease หมดต้องถูกปฏิเสธ/);
});

test('CAS token ปิด race ที่เจ้าของเปลี่ยนระหว่างอ่านกับบันทึกผล', async () => {
  await assertStaleCompletionRace();
});

test('mutation: ถอด status CAS แล้วเทสต์ concurrent claim ต้องแดง', async () => {
  const mutated = replaceOnce(
    ROUTE_SOURCE,
    "let filtered = query.filter('data->>status', 'eq', candidate.status);",
    'let filtered = query;',
    'remove claim status CAS',
  );
  await assert.rejects(() => assertOneConcurrentOwner(mutated), /เจ้าของเพียงหนึ่งตัว/);
});

test('mutation: ถอด token CAS แล้ว stale completion race ต้องแดง', async () => {
  const mutated = replaceOnce(
    ROUTE_SOURCE,
    ".filter('data->>claimToken', 'eq', claimToken);",
    ';',
    'remove terminal token CAS',
  );
  await assert.rejects(() => assertStaleCompletionRace(mutated), /ต้องแพ้/);
});

test('mutation: heartbeat ไม่ต่อ lease แล้วเทสต์ต้องแดง', async () => {
  const mutated = replaceOnce(
    ROUTE_SOURCE,
    'leaseExpiresAt: new Date(new Date(nowIso).getTime() + LEASE_MS).toISOString(),\n        lastHeartbeatAt: nowIso,',
    'leaseExpiresAt: current.leaseExpiresAt,\n        lastHeartbeatAt: nowIso,',
    'disable heartbeat lease extension',
  );
  await assert.rejects(() => assertHeartbeatExtends(mutated), /ต่อ lease จริง/);
});

test('mutation: เปิด auto-reclaim งานหมด lease แล้วเทสต์ต้องแดง', async () => {
  const mutated = replaceOnce(
    ROUTE_SOURCE,
    'if (reclaimed) {',
    'if (reclaimed && reclaims >= 5) {',
    'restore automatic expired-lease reclaim',
  );
  await assert.rejects(() => assertExpiredFailsClosed(mutated), /ห้ามถูกส่งไปถอดใหม่/);
});

async function loadWorker(source = WORKER_SOURCE, { heartbeatMs = 60_000, workerSecret = WORKER_SECRET } = {}) {
  const dispatcherStart = source.indexOf('let longDispatcher = null;');
  const dispatcherEnd = source.indexOf('const log =', dispatcherStart);
  assert.ok(dispatcherStart >= 0 && dispatcherEnd > dispatcherStart, 'หา undici bootstrap ของ worker ไม่พบ');
  let transformed = `${source.slice(0, dispatcherStart)}let longDispatcher = null;\n\n${source.slice(dispatcherEnd)}`;
  transformed = replaceOnce(
    transformed,
    "loop().catch((e) => { console.error('clip-worker crashed:', e); process.exit(1); });",
    '',
    'remove top-level worker loop for test',
  );
  transformed += '\nexport { pullJob, processJob, report, postWorkerState, startHeartbeat, isTransient, reportStatusForFailure, reportStatusForProcessResult };\n';
  transformed += `// ${crypto.randomUUID()}\n`;

  const oldBase = process.env.CLIP_WORKER_BASE;
  const oldHeartbeat = process.env.CLIP_WORKER_HEARTBEAT_MS;
  const oldSecret = process.env.CLIP_WORKER_SECRET;
  const oldDiscordSecret = process.env.DISCORD_API_SECRET;
  process.env.CLIP_WORKER_BASE = 'http://clip-worker.test';
  process.env.CLIP_WORKER_HEARTBEAT_MS = String(heartbeatMs);
  process.env.CLIP_WORKER_SECRET = workerSecret;
  process.env.DISCORD_API_SECRET = '';
  try {
    const url = `data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`;
    return await import(url);
  } finally {
    if (oldBase === undefined) delete process.env.CLIP_WORKER_BASE;
    else process.env.CLIP_WORKER_BASE = oldBase;
    if (oldHeartbeat === undefined) delete process.env.CLIP_WORKER_HEARTBEAT_MS;
    else process.env.CLIP_WORKER_HEARTBEAT_MS = oldHeartbeat;
    if (oldSecret === undefined) delete process.env.CLIP_WORKER_SECRET;
    else process.env.CLIP_WORKER_SECRET = oldSecret;
    if (oldDiscordSecret === undefined) delete process.env.DISCORD_API_SECRET;
    else process.env.DISCORD_API_SECRET = oldDiscordSecret;
  }
}

function fakeFetchResponse(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return clone(body); },
  };
}

async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); }
  finally { globalThis.fetch = original; }
}

async function assertWorkerRejectsFalseHttpSuccess(source = WORKER_SOURCE) {
  const worker = await loadWorker(source);
  await withFetch(async () => fakeFetchResponse(500, { success: true, data: { transcript: 'must not pass' } }), async () => {
    await assert.rejects(
      () => worker.processJob({ kind: 'insight', url: 'https://example.com/video' }),
      error => error?.code === 'AMBIGUOUS_RESPONSE_BODY',
      'HTTP 500 + success:true ต้องหยุดแบบ ambiguous ไม่คืนผลให้เข้า retry',
    );
  });
}

async function assertUnreadableProcessBodyStops(source = WORKER_SOURCE) {
  const worker = await loadWorker(source);
  await withFetch(async () => ({
    ok: true,
    status: 200,
    async json() { throw new Error('truncated body'); },
  }), async () => {
    await assert.rejects(
      () => worker.processJob({ kind: 'insight', url: 'https://example.com/video' }),
      error => error?.code === 'AMBIGUOUS_RESPONSE_BODY',
      'HTTP 200 ที่อ่าน body ไม่ครบต้องหยุดแบบ ambiguous ไม่คืนผลให้เข้า retry',
    );
  });

  await withFetch(async () => fakeFetchResponse(200, {}), async () => {
    await assert.rejects(
      () => worker.processJob({ kind: 'insight', url: 'https://example.com/video' }),
      error => error?.code === 'AMBIGUOUS_RESPONSE_BODY',
      'HTTP 200 ที่ไม่มี success:true/false ต้องหยุด ไม่ retry งานที่อาจเสียเงินแล้ว',
    );
  });
}

async function assertWorkerForwardsToken(source = WORKER_SOURCE) {
  const worker = await loadWorker(source);
  let sentBody;
  let sentHeaders;
  await withFetch(async (_url, options) => {
    sentBody = JSON.parse(options.body);
    sentHeaders = options.headers;
    return fakeFetchResponse(200, { success: true });
  }, () => worker.report('clip-1', 'done', { transcript: 'ok' }, 'owner-token', { maxAttempts: 1 }));
  assert.equal(sentBody.claimToken, 'owner-token', 'worker ต้องส่ง claimToken ทุกครั้ง');
  assert.equal(sentHeaders['X-Clip-Worker-Secret'], WORKER_SECRET, 'worker ต้องส่ง secret โดยไม่ใส่ใน body');
  assert.equal(JSON.stringify(sentBody).includes(WORKER_SECRET), false, 'ห้ามวาง secret ใน payload/loggable body');
}

async function assertWorkerHeartbeatStarts(source = WORKER_SOURCE) {
  const worker = await loadWorker(source, { heartbeatMs: 5 });
  const bodies = [];
  await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return fakeFetchResponse(200, {
      success: true,
      leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    });
  }, async () => {
    const controller = new AbortController();
    const heartbeat = worker.startHeartbeat({
      id: 'clip-1', claimToken: 'owner-token',
      leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    }, controller);
    await new Promise(resolve => setTimeout(resolve, 24));
    await heartbeat.stop();
  });
  assert.ok(bodies.length >= 1, 'worker ต้องยิง heartbeat ระหว่างงานยาว');
  assert.ok(bodies.every(body => body.status === 'heartbeat' && body.claimToken === 'owner-token'));
}

async function assertAmbiguousFailureStops(source = WORKER_SOURCE) {
  const worker = await loadWorker(source);
  assert.equal(
    worker.reportStatusForFailure('fetch failed', '', { serverResponded: false }),
    'error',
    'fetch/timeout ที่ไม่รู้ว่าเซิร์ฟเวอร์ยังทำ AI อยู่หรือไม่ ต้องไม่ retry',
  );
}

async function assertProcessFailureNeedsExplicitRetryProof(source = WORKER_SOURCE) {
  const worker = await loadWorker(source);
  for (const [status, body] of [
    [422, { success: false, error: 'insight failed after provider', errorType: 'INSIGHT_ERROR' }],
    [500, { success: false, error: 'internal processing error', errorType: 'INTERNAL_ERROR' }],
    [503, { success: false, error: 'Gemini 503', errorType: '503' }],
  ]) {
    await withFetch(async () => fakeFetchResponse(status, body), async () => {
      const result = await worker.processJob({ kind: 'insight', url: 'https://example.com/video' });
      assert.equal(result.retrySafe, false);
      assert.equal(
        worker.reportStatusForProcessResult(result),
        'error',
        `HTTP ${status} ที่ไม่ยืนยัน retrySafe ต้องไม่ยิง AI ซ้ำ`,
      );
    });
  }

  await withFetch(async () => fakeFetchResponse(503, {
    success: false,
    error: 'capacity full before provider',
    errorType: 'PRE_PROVIDER_CAPACITY',
    retrySafe: true,
  }), async () => {
    const result = await worker.processJob({ kind: 'insight', url: 'https://example.com/video' });
    assert.equal(worker.reportStatusForProcessResult(result), 'retry');
  });
}

test('worker ตรวจ HTTP status และส่ง claimToken ในรายงานผล', async () => {
  await assertWorkerRejectsFalseHttpSuccess();
  await assertWorkerForwardsToken();
});

test('worker ไม่เริ่มดึงคิวเมื่อไม่มี secret', async () => {
  const worker = await loadWorker(WORKER_SOURCE, { workerSecret: '' });
  let fetchCalls = 0;
  await withFetch(async () => {
    fetchCalls += 1;
    return fakeFetchResponse(200, { success: true, job: null });
  }, async () => {
    await assert.rejects(
      () => worker.pullJob(),
      error => error?.code === 'CLIP_WORKER_SECRET_MISSING',
    );
  });
  assert.equal(fetchCalls, 0, 'secret หายต้องหยุดก่อนแตะ endpoint');
});

test('worker หยุดเมื่อ HTTP 200 ตอบ body ขาดหรือไม่มี success ชัดเจน', async () => {
  await assertUnreadableProcessBodyStops();
});

test('worker retry การรายงานแบบมีเพดานและรับ 204 เป็น success', async () => {
  const worker = await loadWorker();
  const statuses = [503, 503, 204];
  let calls = 0;
  await withFetch(async () => {
    const status = statuses[calls++] ?? 500;
    return fakeFetchResponse(status, status === 204 ? {} : { success: false, error: 'temporary' });
  }, () => worker.report('clip-1', 'done', { transcript: 'ok' }, 'owner-token'));
  assert.equal(calls, 3);

  calls = 0;
  await withFetch(async () => {
    calls += 1;
    return fakeFetchResponse(503, { success: false, error: 'still down' });
  }, async () => {
    await assert.rejects(
      () => worker.report('clip-1', 'done', { transcript: 'ok' }, 'owner-token'),
      /still down/,
    );
  });
  assert.equal(calls, 3, 'รายงานล้มต้องหยุดที่ 3 ครั้ง ไม่วนไม่จบ');
});

test('worker ส่ง heartbeat พร้อม token ระหว่างประมวลผล', async () => {
  await assertWorkerHeartbeatStarts();
});

test('worker retry เฉพาะผลที่ยืนยัน retrySafe; failure อื่นและ network ambiguity ต้องหยุด', async () => {
  const worker = await loadWorker();
  assert.equal(worker.reportStatusForFailure('Gemini 503', '503', { serverResponded: true }), 'retry');
  await assertAmbiguousFailureStops();
  assert.equal(worker.reportStatusForFailure('processJob timeout 16 นาที', 'PROCESS_TIMEOUT', { serverResponded: false }), 'error');
  assert.equal(worker.reportStatusForProcessResult({ ok: true, result: {} }), 'done');
  assert.equal(worker.reportStatusForProcessResult({ ok: false, error: 'Gemini 503', errorType: '503' }), 'error');
  assert.equal(worker.reportStatusForProcessResult({ ok: false, error: 'Gemini 503', errorType: '503', retrySafe: true }), 'retry');
  assert.equal(worker.reportStatusForProcessResult({ ok: false, error: 'คลิปส่วนตัว', errorType: 'CANT_WATCH' }), 'error');
  await assertProcessFailureNeedsExplicitRetryProof();
});

test('mutation: กลับไป retry process failure จากข้อความเองแล้วเทสต์ต้องแดง', async () => {
  const mutated = replaceOnce(
    WORKER_SOURCE,
    'if (result?.retrySafe === true) {',
    'if (true) {',
    'restore heuristic paid-work retry',
  );
  await assert.rejects(
    () => assertProcessFailureNeedsExplicitRetryProof(mutated),
    /ต้องไม่ยิง AI ซ้ำ/,
  );
});

test('mutation: HTTP 500 + success:true กลับไป retry แล้วเทสต์ต้องแดง', async () => {
  const mutated = replaceOnce(
    WORKER_SOURCE,
    `  if (!r.ok && d?.success === true) {
    // HTTP บอกว่าล้ม แต่ body บอกว่างานสำเร็จ: อาจจ่าย AI และได้ผลแล้ว ห้ามทิ้งผลแล้ววนถอดใหม่
    const error = new Error(\`HTTP \${r.status} ขัดกับผล success:true จึงหยุดไว้เพื่อกันถอดซ้ำ\`);
    error.code = 'AMBIGUOUS_RESPONSE_BODY';
    throw error;
  }
`,
    '',
    'remove contradictory response guard',
  );
  await assert.rejects(
    () => assertWorkerRejectsFalseHttpSuccess(mutated),
    /ต้องหยุดแบบ ambiguous/,
  );
});

test('mutation: worker ไม่ส่ง claimToken แล้วเทสต์ต้องแดง', async () => {
  const mutated = replaceOnce(
    WORKER_SOURCE,
    '? { id, status, claimToken, result: payload }',
    '? { id, status, result: payload }',
    'remove report claim token',
  );
  await assert.rejects(() => assertWorkerForwardsToken(mutated), /ต้องส่ง claimToken/);
});

test('mutation: worker ไม่เริ่ม heartbeat แล้วเทสต์ต้องแดง', async () => {
  const mutated = replaceOnce(
    WORKER_SOURCE,
    '  schedule();\n  return {',
    '  return {',
    'remove initial heartbeat schedule',
  );
  await assert.rejects(() => assertWorkerHeartbeatStarts(mutated), /ต้องยิง heartbeat/);
});

test('mutation: network ambiguity กลับไป retry อัตโนมัติแล้วเทสต์ต้องแดง', async () => {
  const mutated = replaceOnce(
    WORKER_SOURCE,
    "if (!serverResponded) return 'error';",
    "if (!serverResponded) return 'retry';",
    'restore ambiguous automatic retry',
  );
  await assert.rejects(() => assertAmbiguousFailureStops(mutated), /ต้องไม่ retry/);
});

test('mutation: กลืน JSON body ที่ขาดแล้วเทสต์ต้องแดง', async () => {
  let mutated = replaceOnce(
    WORKER_SOURCE,
    `  let d;
  try {
    d = await r.json();
  } catch (cause) {
    // HTTP response มาถึงแล้วแต่ body ขาด อาจเป็นงานที่ AI ทำเสร็จแล้ว ห้ามตีเป็น transient แล้วเสียเงินซ้ำ
    const error = new Error(\`อ่านผลถอดคลิปจาก HTTP \${r.status} ไม่ครบ: \${cause.message}\`);
    error.code = 'AMBIGUOUS_RESPONSE_BODY';
    throw error;
  }`,
    '  const d = await r.json().catch(() => ({}));',
    'restore swallowed process response body',
  );
  mutated = replaceOnce(
    mutated,
    `  if (r.ok && typeof d?.success !== 'boolean') {
    // 2xx แต่ไม่มีผลสำเร็จ/ล้มเหลวชัดเจน ก็ไม่รู้ว่า AI ถูกคิดเงินไปแล้วหรือไม่
    const error = new Error(\`ผลถอดคลิปจาก HTTP \${r.status} ไม่มีสถานะ success ที่ชัดเจน\`);
    error.code = 'AMBIGUOUS_RESPONSE_BODY';
    throw error;
  }
`,
    '',
    'restore missing response envelope gate',
  );
  await assert.rejects(
    () => assertUnreadableProcessBodyStops(mutated),
    /ต้องหยุดแบบ ambiguous|ต้องหยุด/,
  );
});

// ── 💓 ชีพจรเครื่องทีม (26 ส.ค. 69) — ต้องไม่รบกวนคิวเลยแม้แต่นิดเดียว ──

test('แถวชีพจรเครื่องทีมต้องไม่ถูกหยิบไปเป็นงานถอด', async () => {
  // แถวชีพจรไม่มี status/url — ถ้าโค้ดไม่กรองออก อาจหลุดเข้า candidates แล้วพังตอน claim
  const heartbeatRow = { id: '__clip_worker_heartbeat__', lastSeenAt: new Date().toISOString() };
  const route = await loadRoute({ jobs: [heartbeatRow] });
  const res = await route.GET(makeRequest());
  const body = await responseBody(res);
  assert.equal(body.success, true);
  assert.equal(body.job, null, 'มีแต่แถวชีพจร = ต้องไม่มีงานให้ทำ ไม่ใช่หยิบแถวชีพจรไปถอด');
});

test('มีแถวชีพจรปนอยู่ ต้องยังหยิบงานจริงได้ตามปกติ', async () => {
  const heartbeatRow = { id: '__clip_worker_heartbeat__', lastSeenAt: new Date().toISOString() };
  const route = await loadRoute({ jobs: [heartbeatRow, makeJob()] });
  const res = await route.GET(makeRequest());
  const body = await responseBody(res);
  assert.ok(body.job, 'ต้องหยิบงานจริงได้ ไม่ถูกแถวชีพจรบัง');
  assert.notEqual(body.job.id, '__clip_worker_heartbeat__');
});
