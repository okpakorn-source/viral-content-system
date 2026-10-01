// ============================================================
// 🧪 tests/research-agent-report.test.mjs — สคริปต์รายงานเอเจนต์รีเสิร์ช (scripts/research-agent-report.mjs)
// ★ 1 ต.ค. 69 (SPEC-v2 ส่วน 10 · เลน D ops+docs)
// ------------------------------------------------------------
// ฉีด fetch ปลอมทุกข้อ: ไม่ยิง Supabase/ไม่ยิง API จริง · ไม่อ่าน process.env · ไม่เขียนไฟล์ใน repo
// กัดจริง: mutation 12 แบบท้ายไฟล์ — โหลด "ซอร์สจริงที่ patch แล้ว" ผ่าน data: URL (ไม่เขียนไฟล์) ต้องแดง · ซอร์สเดิมต้องเขียว
// fixture: shape ตามสเปกข้อ 2.2 (store research-cards) + pipeline_logs step research-agent (สเปกข้อ 10 · metadata แบบ readCards
//   เลน B: {status, mode, cards, pass, flags, ms, waitedMs, brain} — ★ contract-check #5: เวลาท่อรอ = waitedMs ไม่ใช่ ms)
//   origin "ไม่พบ" และเพจเราเอง (IG.dara) ดัดจากผลจริงในแล็บ C:\tmp\research-agent-lab\out\result.json + out2\result.json
// await ทุกตัวครอบ settleWithin (บทเรียน node 22 — tests/helpers/fake-deadline.mjs)
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { settleWithin } from './helpers/fake-deadline.mjs';
import * as report from '../scripts/research-agent-report.mjs';

const SOURCE = readFileSync(new URL('../scripts/research-agent-report.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const NOW = Date.parse('2026-10-10T05:00:00.000Z'); // 10 ต.ค. 69 12:00 เวลาไทย
const FAKE_URL = 'https://zzfakeref9.supabase.co';
const FAKE_HOST = 'zzfakeref9.supabase.co';
const FAKE_KEY = 'test-service-key-DO-NOT-PRINT-7f3a91';
const ENV = Object.freeze({ NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_KEY: FAKE_KEY });

const FOUND_ORIGIN = { url: 'https://www.thairath.co.th/news/local/2840001', source_name: 'ไทยรัฐออนไลน์', date: '2026-10-03', confidence: 0.9 };
const NOT_FOUND_ORIGIN = { url: 'ไม่พบ', source_name: 'ไม่พบต้นทางที่ตรงกับเรื่อง', date: 'ไม่ทราบ', confidence: 0 }; // out/result.json
const OWN_PAGE_ORIGIN = { // out2/result.json — โพสต์เพจเราเอง เผยแพร่หลังเวลาส่งข่าว → ห้ามนับเป็นต้นทาง
  url: 'https://www.facebook.com/IG.dara/posts/pfbid02xtmH9UpCU2yNs9dKTV6R9ZgeQ', source_name: 'รวมไอจีดารา', date: '2026-10-01T05:51:22.000Z', confidence: 0.99,
};

/** แถว research-cards แบบที่สคริปต์ดึง (CARD_SELECT: ช่องอยู่ชั้นบน) */
function cardRow({ id, created, status = 'done', mode = 'shadow', brain = {}, origin = {}, cards = [], flags = [], raw = [], usage = {}, feedback = [] }) {
  return {
    id, created_at: created, createdAt: created, status, mode,
    brain: { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', ...brain },
    origin_post: origin, cards, flags, raw_corrections: raw, usage, feedback,
  };
}

const CARD_ROWS = [
  // ก่อนต้นเดือนเวลาไทย (30 ก.ย. 23:59) — server ต้องกรองออก · summarize ต้องไม่นับแม้หลุดมา
  cardRow({ id: 'q_sep', created: '2026-09-30T16:59:00.000Z', usage: { costUsd: 9 }, brain: { quotaPctAfter: 99 } }),
  // ต้นเดือนแต่ก่อนช่วง 7 วัน — นับเฉพาะค่าเครื่องมือเดือนนี้ + เป็นจุดตั้งต้นโควตา
  cardRow({ id: 'q_pre', created: '2026-10-02T03:00:00.000Z', origin: FOUND_ORIGIN, usage: { costUsd: 0.5, minutes: 2, tool_calls: 10 }, brain: { quotaPctAfter: 70 } }),
  // 4 ต.ค. 00:30 เวลาไทย (UTC ยังเป็น 3 ต.ค.)
  cardRow({
    id: 'q_a1', created: '2026-10-03T17:30:00.000Z', origin: FOUND_ORIGIN,
    cards: [{ id: 'R1', gate: 'pass' }, { id: 'R2', gate: 'staff_only' }],
    usage: { tool_calls: 12, minutes: 2.75, costUsd: 0.012 }, brain: { quotaPctAfter: 62 },
    feedback: [
      { userId: 'owner', cardId: 'R1', vote: 'up', at: '2026-10-04T02:00:00.000Z' },
      { userId: 'owner', cardId: 'R1', vote: 'down', at: '2026-10-04T01:00:00.000Z' }, // เก่ากว่า แม้อยู่ท้ายอาร์เรย์
      { userId: 'staff1', cardId: 'R2', vote: 'up', at: '2026-10-04T03:00:00.000Z' },
    ],
  }),
  cardRow({
    id: 'q_b2', created: '2026-10-05T06:00:00.000Z', origin: NOT_FOUND_ORIGIN, flags: ['ORIGIN_NOT_FOUND', 'STALE_NEWS', 'RAW_CONTRADICTION'],
    cards: [{ id: 'R1', gate: 'pass' }, { id: 'R2', gate: 'pass' }, { id: 'R3', gate: 'dropped' }],
    raw: [{ field: 'อายุ', raw_value: '52', source_value: '53', source_url: FOUND_ORIGIN.url, confidence: 0.8 }],
    usage: { tool_calls: 25, minutes: 4.86, costUsd: 0.03 }, brain: { effort: 'medium', quotaPctAfter: 55 },
    feedback: [{ userId: 'staff1', cardId: 'all', vote: 'down', at: '2026-10-05T07:00:00.000Z' }],
  }),
  cardRow({ id: 'q_d4', created: '2026-10-08T04:00:00.000Z', status: 'failed', flags: ['QUOTA_LOW'], usage: { tool_calls: 3, minutes: 0.5, costUsd: 0.001 }, brain: { account: 'b', quotaPctAfter: 12 } }),
  // โควตารีเซ็ต 55 → 100 (ห้ามนับเป็นการใช้)
  cardRow({ id: 'q_e5', created: '2026-10-09T01:00:00.000Z', status: 'skipped', brain: { quotaPctAfter: 100 } }),
  cardRow({ id: 'q_c3', created: '2026-10-10T02:00:00.000Z', origin: OWN_PAGE_ORIGIN, cards: [{ id: 'R1', gate: 'staff_only' }], usage: { tool_calls: 6, minutes: 1, costUsd: 0 }, brain: { kind: 'api' } }),
];
const CARD_BY_ID = Object.fromEntries(CARD_ROWS.map((r) => [r.id, r]));

const LOG_ROWS = [
  // ก่อนช่วง (3 ต.ค. 23:00 เวลาไทย) — server กรอง
  { id: 'l0', workflow_id: 'unify_q_old', status: 'success', duration_ms: 0, metadata: '{"status":"done","cards":1,"ms":0}', created_at: '2026-10-03T16:00:00.000Z' },
  // metadata เป็นสตริง JSON (pipelineLogger ใช้ JSON.stringify) · shadow: poll วิ่ง 3.2 วิขนาน Blueprint แต่ท่อไม่ได้รอ (waitedMs 0)
  { id: 'l1', workflow_id: 'unify_q_a1', status: 'success', duration_ms: 3200, metadata: '{"status":"pending","mode":"shadow","cards":0,"pass":0,"flags":[],"ms":3200,"waitedMs":0,"brain":null}', created_at: '2026-10-03T17:31:00.000Z' },
  // metadata เป็น object · waitedMs (รอเพิ่มจริง) ชนะ ms (เวลาตั้งแต่เริ่ม poll) และ duration_ms
  { id: 'l2', workflow_id: 'unify_q_b2', status: 'success', duration_ms: 5000, metadata: { status: 'done', cards: 3, flags: ['STALE_NEWS'], ms: 4200, waitedMs: 1500 }, created_at: '2026-10-05T06:01:00.000Z' },
  // ไม่มี metadata → สถานะจากคอลัมน์ · ข่าวที่ไม่มีการ์ดในฐาน
  { id: 'l3', workflow_id: 'unify_q_zz', status: 'warning', duration_ms: 0, metadata: null, created_at: '2026-10-06T03:00:00.000Z' },
  { id: 'l4', workflow_id: 'unify_q_c3', status: 'success', duration_ms: null, metadata: '{"status":"offline","ms":0}', created_at: '2026-10-10T02:01:00.000Z' },
];

// ── Supabase REST ปลอม (กรอง created_at=gte. + limit/offset แบบ PostgREST) ──
function fakeResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return text; },
    async json() { return JSON.parse(text); },
  };
}

function fakeSupabase({ cardRows = CARD_ROWS, logRows = LOG_ROWS, fail = {} } = {}) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    calls.push({ url: String(url), method: init.method, headers: { ...(init.headers || {}) }, body: init.body, signal: init.signal });
    const u = new URL(String(url));
    const table = u.pathname.replace(/^\/rest\/v1\//, '');
    if (fail[table]) return fail[table](u);
    const source = table === 'store_items' ? cardRows : table === 'pipeline_logs' ? logRows : null;
    if (!source) return fakeResponse(404, '{"message":"unknown table"}');
    const since = (u.searchParams.get('created_at') || '').replace(/^gte\./, '');
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset'));
    const rows = source.filter((r) => !since || Date.parse(r.created_at) >= Date.parse(since)).slice(offset, offset + limit);
    return fakeResponse(200, JSON.stringify(rows));
  }
  return { fetchImpl, calls };
}

const echoSecrets = () => fakeResponse(500, `{"message":"boom key=${FAKE_KEY} url=${FAKE_URL}/rest/v1 host=${FAKE_HOST}"}`);

async function runMainOf(mod, argv = [], { env = { ...ENV }, supabase = fakeSupabase(), ...rest } = {}) {
  const stdout = [];
  const stderr = [];
  const code = await settleWithin(mod.main(argv, {
    env, fetchImpl: supabase.fetchImpl, now: () => NOW, timeoutMs: 0,
    stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s),
    fileExists: () => false, loadEnvFile: () => {}, ...rest,
  }), `main(${argv.join(' ')}) ต้องจบ`, 5_000);
  return { code, out: stdout.join(''), err: stderr.join(''), calls: supabase.calls };
}
const runMain = (argv, opts) => runMainOf(report, argv, opts);

// ── อาร์กิวเมนต์ / env ─────────────────────────────────────────
test('parseArgs: ค่าเริ่มต้น · --days/--json/--env · ค่าผิดหรือ --env-file (ชนธงของ Node) = UsageError', () => {
  assert.deepEqual(report.parseArgs([]), { days: 7, json: false, envFile: null, help: false });
  assert.deepEqual(report.parseArgs(['--days', '3', '--json', '--env', 'x.env']), { days: 3, json: true, envFile: 'x.env', help: false });
  assert.equal(report.parseArgs(['--days=14']).days, 14);
  assert.equal(report.parseArgs(['--env=C:/a b/.env.local']).envFile, 'C:/a b/.env.local');
  assert.equal(report.parseArgs(['-h']).help, true);
  for (const bad of [['--days', '0'], ['--days', '91'], ['--days', '2.5'], ['--days', 'abc'], ['--days'], ['--env'], ['--env', '  '], ['--env-file', 'x'], ['--what']]) {
    assert.throws(() => report.parseArgs(bad), report.UsageError, JSON.stringify(bad));
  }
});

test('resolveSupabaseConfig: ลำดับชื่อ env (URL: NEXT_PUBLIC ก่อน · คีย์: SERVICE ก่อน) · ตัด / ท้าย · ค่าว่าง/ไม่ครบ = null', () => {
  assert.equal(report.resolveSupabaseConfig({}), null);
  assert.equal(report.resolveSupabaseConfig({ SUPABASE_URL: 'https://a.supabase.co' }), null);
  assert.equal(report.resolveSupabaseConfig({ SUPABASE_SERVICE_KEY: 'k' }), null);
  assert.deepEqual(report.resolveSupabaseConfig({
    SUPABASE_URL: 'https://b.supabase.co/', NEXT_PUBLIC_SUPABASE_URL: 'https://a.supabase.co//',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'role', SUPABASE_SERVICE_KEY: '   ',
  }), { baseUrl: 'https://a.supabase.co', key: 'role', urlName: 'NEXT_PUBLIC_SUPABASE_URL', keyName: 'SUPABASE_SERVICE_ROLE_KEY' });
});

test('isMainModule: data: URL (เทสกลายพันธุ์) ไม่รัน main · path เดียวกันเท่านั้นที่รัน', () => {
  assert.equal(report.isMainModule('data:text/javascript;base64,AA==', process.argv[1]), false);
  assert.equal(report.isMainModule(import.meta.url, undefined), false);
  const self = new URL('../scripts/research-agent-report.mjs', import.meta.url);
  assert.equal(report.isMainModule(self.href, fileURLToPath(self)), true); // fileURLToPath: ราก repo จริงมีชื่อโฟลเดอร์ภาษาไทย
  assert.equal(report.isMainModule(self.href, process.argv[1]), false); // ตอนเทส argv[1] = ไฟล์เทส
});

// ── หน่วยคำนวณ ─────────────────────────────────────────────────
test('เวลาไทย: วันข้ามเที่ยงคืนแบบ UTC+7 · ช่วง = N วันปฏิทินรวมวันนี้ · การ์ดดึงย้อนถึงต้นเดือนเวลาไทย', () => {
  assert.equal(report.bangkokDay(Date.parse('2026-10-03T17:30:00Z')), '2026-10-04');
  assert.equal(report.bangkokDay(Date.parse('2026-10-03T16:59:59Z')), '2026-10-03');
  const w = report.windowFor(NOW, 7);
  assert.equal(new Date(w.fromMs).toISOString(), '2026-10-03T17:00:00.000Z'); // 4 ต.ค. 00:00 เวลาไทย
  assert.equal(new Date(w.monthStartMs).toISOString(), '2026-09-30T17:00:00.000Z'); // 1 ต.ค. 00:00 เวลาไทย
  assert.equal(w.cardsFetchFromMs, w.monthStartMs);
  const nov1 = report.windowFor(Date.parse('2026-10-31T18:00:00Z'), 1); // 1 พ.ย. 01:00 เวลาไทย
  assert.equal(new Date(nov1.fromMs).toISOString(), '2026-10-31T17:00:00.000Z');
  assert.equal(nov1.monthStartMs, nov1.fromMs);
});

test('percentile: nearest-rank (ค่าจริงในชุด ไม่เฉลี่ย) · ชุดว่าง = null · ตัดค่าที่ไม่ใช่ตัวเลข', () => {
  const ten = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  assert.equal(report.percentile(ten, 50), 5);
  assert.equal(report.percentile(ten, 90), 9);
  assert.equal(report.percentile([30000, 60000, 165000, 291600], 50), 60000);
  assert.equal(report.percentile([30000, 60000, 165000, 291600], 90), 291600);
  assert.equal(report.percentile([7], 90), 7);
  assert.equal(report.percentile([], 50), null);
  assert.equal(report.percentile([NaN, 'x', 3], 50), 3);
});

test('isOriginFound: URL จริง = พบ · "ไม่พบ"/ว่าง/ไม่ใช่ http/ธง ORIGIN_NOT_FOUND/เพจเราเอง IG.dara = ไม่พบ', () => {
  const mk = (url, flags = []) => ({ flags, originPost: { url } });
  assert.equal(report.isOriginFound(mk(FOUND_ORIGIN.url)), true);
  assert.equal(report.isOriginFound(mk('ไม่พบ')), false);
  assert.equal(report.isOriginFound(mk('')), false);
  assert.equal(report.isOriginFound(mk(undefined)), false);
  assert.equal(report.isOriginFound(mk('ftp://x.example/z')), false);
  assert.equal(report.isOriginFound(mk(FOUND_ORIGIN.url, ['ORIGIN_NOT_FOUND'])), false);
  assert.equal(report.isOriginFound(mk(OWN_PAGE_ORIGIN.url)), false);
  assert.equal(report.isOriginFound(mk('https://m.facebook.com/ig.dara?ref=share')), false);
  assert.equal(report.isOriginFound(mk('https://www.facebook.com/IG.daranews/posts/1')), true); // คนละเพจ (ชื่อขึ้นต้นคล้าย)
});

test('tallyFeedback: คนเดิม+การ์ดเดิม เอาโหวตที่ at ล่าสุด · ไม่มี at = ตัวท้ายชนะ · โหวตแปลก/null ไม่นับ', () => {
  const t = report.tallyFeedback(CARD_BY_ID.q_a1.feedback);
  assert.deepEqual({ up: t.up, down: t.down, voters: [...t.voters].sort() }, { up: 2, down: 0, voters: ['owner', 'staff1'] });
  const noAt = report.tallyFeedback([
    { userId: 'u', cardId: 'R1', vote: 'up' }, { userId: 'u', cardId: 'R1', vote: 'down' },
    { userId: 'u', cardId: 'R2', vote: 'meh' }, null,
  ]);
  assert.deepEqual([noAt.up, noAt.down], [0, 1]);
});

test('normalizeCardRow: แถวแบบดึงเฉพาะช่อง = แถวแบบ data เต็ม (สัญญา 2.2) · ไม่มีเวลา = null · ธงซ้ำนับครั้งเดียว', () => {
  const { id, created_at: createdAt, ...data } = CARD_BY_ID.q_b2;
  const full = report.normalizeCardRow({ id, created_at: createdAt, data: { id, ...data, tool_log: [{ tool: 'serper', ok: true }], plan: [] } });
  assert.deepEqual(full, report.normalizeCardRow(CARD_BY_ID.q_b2));
  assert.equal(report.normalizeCardRow({ id: 'x' }), null);
  assert.equal(report.normalizeCardRow(null), null);
  const fromStrings = report.normalizeCardRow({ id: 'y', created_at: '2026-10-05T00:00:00Z', flags: '["STALE_NEWS","STALE_NEWS"]', brain: '{"quotaPctAfter":"40"}' });
  assert.deepEqual(fromStrings.flags, ['STALE_NEWS']);
  assert.equal(fromStrings.brain.account, 'unknown');
});

test('summarize: ตัวเลขครบตามนิยาม — งาน/วัน · ต้นทาง · การ์ด · 👍👎 · p50/p90 · ค่าเครื่องมือ · โควตา · ท่อ', () => {
  const s = report.summarize({ cardRows: CARD_ROWS, logRows: LOG_ROWS, days: 7, nowMs: NOW });
  assert.deepEqual(s.window, {
    days: 7, from: '2026-10-04', to: '2026-10-10', timezone: 'Asia/Bangkok',
    fromIso: '2026-10-03T17:00:00.000Z', toIso: '2026-10-10T05:00:00.000Z', monthStartIso: '2026-09-30T17:00:00.000Z',
  });
  assert.deepEqual(s.jobs, { total: 5, byStatus: { done: 3, failed: 1, skipped: 1, other: 0 }, perDayAvg: 0.7 });
  assert.deepEqual(s.origin, { found: 1, of: 3, pct: 33.3 });
  assert.deepEqual(s.cards, { total: 6, perJob: 2, byGate: { pass: 3, staff_only: 2, dropped: 1, other: 0 } });
  assert.deepEqual(s.feedback, { up: 2, down: 1, approvalPct: 66.7, jobsRated: 2, voters: 2 });
  assert.deepEqual(s.timing, { agentMs: { n: 4, p50: 60000, p90: 291600 }, pipelineWaitMs: { n: 4, p50: 0, p90: 1500 } });
  assert.deepEqual(s.toolCalls, { n: 4, avg: 11.5, p90: 25 });
  assert.deepEqual(s.cost, { windowUsd: 0.043, monthToDateUsd: 0.543, budgetUsdMonth: 10, budgetPct: 5.4, budgetReached: false, jobsWithCost: 4 });
  assert.deepEqual(s.quota.accounts, {
    main: { jobs: 3, latestPct: 100, latestAt: '2026-10-09T01:00:00.000Z', minPct: 55, usedPctEstimate: 15, belowAlert: false },
    b: { jobs: 1, latestPct: 12, latestAt: '2026-10-08T04:00:00.000Z', minPct: 12, usedPctEstimate: 0, belowAlert: true },
  });
  assert.deepEqual([s.quota.alertPct, s.quota.lowFlags, s.quota.belowAlert], [15, 1, ['b']]);
  assert.deepEqual(s.flags, { ORIGIN_NOT_FOUND: 1, STALE_NEWS: 1, RAW_CONTRADICTION: 1, QUOTA_LOW: 1 });
  assert.deepEqual(s.brain, {
    byKind: { codex: 4, api: 1 }, byEffort: { low: 4, medium: 1 }, byAccount: { main: 4, b: 1 }, byMode: { shadow: 5 }, mediumEffort: 1,
  });
  assert.deepEqual(s.rawCorrections, { jobs: 1, total: 1 });
  assert.deepEqual(s.pipeline, {
    rows: 4, byStatus: { pending: 1, done: 1, warning: 1, offline: 1 }, readyAtGenerate: 1, readyPct: 25, withCards: 3, coveragePct: 75,
  });
  assert.deepEqual(s.skippedRows, { cards: 0, logs: 0 });
  assert.deepEqual(s.daily.map((d) => d.day), ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  const day = Object.fromEntries(s.daily.map((d) => [d.day, d]));
  assert.deepEqual(day['2026-10-04'], {
    day: '2026-10-04', jobs: 1, done: 1, failed: 0, skipped: 0, originFound: 1, cards: 2, up: 2, down: 0,
    costUsd: 0.012, quotaUsedPct: 8, pipelineRows: 1, readyAtGenerate: 0, cardsPerJob: 2,
  });
  assert.deepEqual(day['2026-10-05'], {
    day: '2026-10-05', jobs: 1, done: 1, failed: 0, skipped: 0, originFound: 0, cards: 3, up: 0, down: 1,
    costUsd: 0.03, quotaUsedPct: 7, pipelineRows: 1, readyAtGenerate: 1, cardsPerJob: 3,
  });
  assert.deepEqual([day['2026-10-06'].pipelineRows, day['2026-10-06'].jobs, day['2026-10-06'].cardsPerJob], [1, 0, null]);
  assert.deepEqual([day['2026-10-08'].failed, day['2026-10-08'].costUsd, day['2026-10-09'].skipped], [1, 0.001, 1]);
  assert.deepEqual([day['2026-10-10'].done, day['2026-10-10'].originFound, day['2026-10-10'].cards], [1, 0, 1]);
});

/** เวลาท่อรอของแถว pipeline_logs หนึ่งแถว (ตัวช่วยของข้อสอบ waitedMs และ mutation) */
const waitOf = (mod, metadata, durationMs = 9000) => mod.normalizeLogRow({
  id: 'lw', workflow_id: 'unify_q_w', status: 'success', duration_ms: durationMs, metadata, created_at: '2026-10-05T06:01:00.000Z',
}).waitMs;

function assertWaitedMs(mod) {
  assert.equal(waitOf(mod, { status: 'pending', ms: 3200, waitedMs: 0 }), 0, 'shadow: poll วิ่ง 3.2 วิขนาน Blueprint แต่ท่อไม่ได้รอ = 0');
  assert.equal(waitOf(mod, '{"status":"done","ms":95000,"waitedMs":41000}'), 41000, 'assist: รอเพิ่มจริง 41 วิ (metadata สตริง JSON)');
  assert.equal(waitOf(mod, { status: 'done', waitedMs: '1500' }), 1500, 'ตัวเลขเป็นสตริงก็อ่านได้');
  assert.equal(waitOf(mod, { status: 'done', ms: 4200 }), 4200, 'แถวที่ไม่มี waitedMs ใช้ ms');
  assert.equal(waitOf(mod, { status: 'done', ms: 4200, waitedMs: null }), 4200);
  assert.equal(waitOf(mod, null, 5000), 5000, 'ไม่มี metadata ใช้ duration_ms');
  assert.equal(waitOf(mod, { status: 'done' }, null), null);
}

test('normalizeLogRow (contract-check #5): เวลาท่อรอ = metadata.waitedMs (0 = ไม่ได้รอ ใช้ได้) → แถวไม่มี waitedMs ใช้ ms → ไม่มี metadata ใช้ duration_ms', () => {
  assertWaitedMs(report);
});

test('summarize: ไม่มีข้อมูล = ตัวเลขว่างไม่ล้ม · เพดาน 0 = ไม่คิด % · แถวไม่มีเวลา = นับข้าม', () => {
  const s = report.summarize({ cardRows: [{ id: 'bad' }], logRows: [{ id: 'bad' }], days: 1, nowMs: NOW, budgetUsdMonth: 0 });
  assert.deepEqual(s.jobs.total, 0);
  assert.deepEqual([s.origin.pct, s.cards.perJob, s.feedback.approvalPct, s.timing.agentMs.p50], [null, null, null, null]);
  assert.deepEqual([s.cost.budgetPct, s.cost.budgetReached], [null, false]);
  assert.deepEqual(s.skippedRows, { cards: 1, logs: 1 });
  assert.deepEqual(s.daily.map((d) => d.day), ['2026-10-10']);
});

test('formatReport: บรรทัดหลักครบ + เตือนเพดานค่าเครื่องมือ · บัญชีโควตาต่ำ · คีย์ anon · ไม่มีข้อมูล', () => {
  const text = report.formatReport(report.summarize({ cardRows: CARD_ROWS, logRows: LOG_ROWS, days: 7, nowMs: NOW }));
  assert.match(text, /รายงานเอเจนต์รีเสิร์ช — 7 วัน \(2026-10-04 → 2026-10-10 เวลาไทย\)/);
  assert.match(text, /งาน: 5 \(done 3 · failed 1 · skipped 1\) · เฉลี่ย 0\.7 งาน\/วัน · โหมด shadow 5/);
  assert.match(text, /พบต้นทาง: 1\/3 งาน = 33\.3%/);
  assert.match(text, /การ์ด: 6 ใบ = 2 ใบ\/งาน \(pass 3 · staff_only 2 · dropped 1\)/);
  assert.match(text, /👍 2 · 👎 1 = ชอบ 66\.7%/);
  assert.match(text, /เวลาเอเจนต์: p50 1\.0 นาที · p90 4\.9 นาที \(n=4\)/);
  assert.match(text, /ท่อรอการ์ด p50 0 วิ · p90 2 วิ/);
  assert.match(text, /ค่าเครื่องมือ: ช่วงนี้ \$0\.043 · เดือนนี้ \$0\.543 \/ เพดาน \$10\.00 \(5\.4%\)/);
  assert.match(text, /⚠️ บัญชี b เหลือ 12%/);
  assert.match(text, / {2}2026-10-04 {2}งาน 1 \(done 1\) · ต้นทาง 1 · การ์ด\/งาน 2 · 👍2 👎0 · ท่อ 1 \(ทัน 0\) · \$0\.012 · โควตาใช้ 8%/);
  assert.doesNotMatch(text, /ถึงเพดานแล้ว/);

  const over = report.formatReport(report.summarize({
    cardRows: CARD_ROWS, logRows: LOG_ROWS, days: 7, nowMs: NOW, budgetUsdMonth: 0.5, keyName: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  }));
  assert.match(over, /ค่าเครื่องมือเดือนนี้ถึงเพดานแล้ว/);
  assert.match(over, /ใช้คีย์ anon/);
  assert.match(report.formatReport(report.summarize({ days: 1, nowMs: NOW })), /ยังไม่มีข้อมูลในช่วงนี้/);
});

// ── main (end-to-end ด้วย fetch ปลอม) ─────────────────────────
test('main: อ่านอย่างเดียว — GET ล้วน ไม่มี body · 2 ตาราง · ตัวกรอง/ลำดับถูก · คีย์อยู่ใน header เท่านั้น', async () => {
  const r = await runMain(['--days', '7']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  assert.equal(r.calls.length, 2);
  for (const c of r.calls) {
    assert.equal(c.method, 'GET');
    assert.equal(c.body, undefined);
    assert.equal(c.headers.apikey, FAKE_KEY);
    assert.equal(c.headers.Authorization, `Bearer ${FAKE_KEY}`);
    assert.ok(!c.url.includes(FAKE_KEY), 'คีย์ห้ามอยู่ใน URL');
    assert.ok(c.url.startsWith(`${FAKE_URL}/rest/v1/`));
    assert.equal(c.signal, undefined, 'timeoutMs: 0 = ไม่แนบ signal');
  }
  const params = Object.fromEntries(r.calls.map((c) => { const u = new URL(c.url); return [u.pathname, u.searchParams]; }));
  const cards = params['/rest/v1/store_items'];
  assert.equal(cards.get('store_name'), 'eq.research-cards');
  assert.equal(cards.get('created_at'), 'gte.2026-09-30T17:00:00.000Z'); // ต้นเดือนเวลาไทย (ค่าเครื่องมือเดือนนี้)
  assert.equal(cards.get('order'), 'created_at.asc,id.asc');
  assert.deepEqual([cards.get('limit'), cards.get('offset')], [String(report.PAGE_SIZE), '0']);
  for (const field of ['status:data->>status', 'usage:data->usage', 'feedback:data->feedback', 'brain:data->brain', 'origin_post:data->origin_post']) {
    assert.ok(cards.get('select').split(',').includes(field), `select ต้องมี ${field}`);
  }
  const logs = params['/rest/v1/pipeline_logs'];
  assert.equal(logs.get('step'), 'eq.research-agent');
  assert.equal(logs.get('created_at'), 'gte.2026-10-03T17:00:00.000Z');
  assert.match(r.out, /งาน: 5 \(done 3 · failed 1 · skipped 1\)/);
  assert.match(r.out, /พบต้นทาง: 1\/3 งาน = 33\.3%/);
});

test('main --json: JSON parse ได้ · ตัวเลขตรง summarize · เพดาน/เกณฑ์โควตาอ่านจาก env (ค่าผิด = ค่าเริ่มต้น)', async () => {
  const r = await runMain(['--json']);
  assert.equal(r.code, 0, r.err);
  const s = JSON.parse(r.out);
  assert.deepEqual([s.jobs.total, s.cost.monthToDateUsd, s.source.keyName, s.errors], [5, 0.543, 'SUPABASE_SERVICE_KEY', []]);
  assert.deepEqual(s.quota.belowAlert, ['b']);

  const tuned = JSON.parse((await runMain(['--json'], {
    env: { ...ENV, RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH: '0.5', RESEARCH_AGENT_QUOTA_ALERT_PCT: '10' },
  })).out);
  assert.deepEqual([tuned.cost.budgetUsdMonth, tuned.cost.budgetReached, tuned.quota.alertPct, tuned.quota.belowAlert], [0.5, true, 10, []]);
  const junk = JSON.parse((await runMain(['--json'], {
    env: { ...ENV, RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH: 'abc', RESEARCH_AGENT_QUOTA_ALERT_PCT: '-3' },
  })).out);
  assert.deepEqual([junk.cost.budgetUsdMonth, junk.quota.alertPct], [10, 15]);
});

test('main: ฐานข้อมูลตอบ error ที่สะท้อนคีย์/URL กลับมา → exit 1 · ยังพิมพ์ส่วนที่อ่านได้ · ไม่หลุดคีย์/URL/host', async () => {
  const http = await runMain([], { supabase: fakeSupabase({ fail: { pipeline_logs: echoSecrets } }) });
  assert.equal(http.code, 1);
  assert.match(http.err, /อ่าน pipeline_logs \(research-agent\) ไม่สำเร็จ: HTTP 500/);
  assert.match(http.out, /⚠️ อ่าน pipeline_logs/);
  assert.match(http.out, /งาน: 5 \(done 3/); // การ์ดอ่านได้ ยังสรุปให้
  const net = await runMain(['--json'], {
    supabase: fakeSupabase({ fail: { store_items: () => { throw new Error(`connect ECONNREFUSED ${FAKE_HOST}:443 via ${FAKE_URL}`); } } }),
  });
  assert.equal(net.code, 1);
  assert.match(JSON.parse(net.out).errors[0], /อ่าน store_items \(research-cards\) ไม่สำเร็จ: Error: connect ECONNREFUSED \*\*\*:443/);
  for (const r of [http, net]) {
    for (const secret of [FAKE_KEY, FAKE_URL, FAKE_HOST]) assert.ok(!(r.out + r.err).includes(secret), `ห้ามพิมพ์ค่าลับ (${secret.slice(0, 8)}…)`);
  }
});

test('main: env ไม่ครบ/ปิด Supabase/URL ผิดรูป = exit 2 บอกชื่อตัวแปร (ไม่ใช่ค่า) และไม่ยิงฐานข้อมูล', async () => {
  const none = await runMain([], { env: {} });
  assert.equal(none.code, 2);
  assert.equal(none.calls.length, 0);
  assert.match(none.err, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(none.err, /SUPABASE_SERVICE_KEY/);
  const disabled = await runMain([], { env: { ...ENV, SUPABASE_DISABLED: '1' } });
  assert.deepEqual([disabled.code, disabled.calls.length], [2, 0]);
  const badUrl = await runMain([], { env: { SUPABASE_URL: FAKE_HOST, SUPABASE_SERVICE_KEY: FAKE_KEY } });
  assert.deepEqual([badUrl.code, badUrl.calls.length], [2, 0]);
  assert.match(badUrl.err, /SUPABASE_URL ต้องขึ้นต้นด้วย http/);
  assert.ok(!badUrl.err.includes(FAKE_HOST) && !badUrl.err.includes(FAKE_KEY));
  const usage = await runMain(['--days', 'x']);
  assert.deepEqual([usage.code, usage.calls.length], [2, 0]);
});

test('main: ไฟล์ env — --env ที่มีอยู่ = โหลดก่อนอ่าน env · --env ที่ไม่มี = exit 2 · ค่าเริ่มต้นไม่มีไฟล์ = ใช้ env ที่มี', async () => {
  const env = {};
  const loaded = [];
  const withFile = await runMain([], {
    env, fileExists: (p) => p === 'C:/x/.env.local', loadEnvFile: (p) => { loaded.push(p); Object.assign(env, ENV); },
  });
  assert.equal(withFile.code, 2, 'ไม่ส่ง --env + ไฟล์ค่าเริ่มต้นไม่มี = ไม่มี env');
  const ok = await runMain(['--env', 'C:/x/.env.local'], {
    env, fileExists: (p) => p === 'C:/x/.env.local', loadEnvFile: (p) => { loaded.push(p); Object.assign(env, ENV); },
  });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(loaded, ['C:/x/.env.local']);
  const missing = await runMain(['--env', 'C:/nope/.env.local']);
  assert.deepEqual([missing.code, missing.calls.length], [2, 0]);
  assert.match(missing.err, /ไม่พบไฟล์ env ที่ระบุ/);
  const broken = await runMain([], { fileExists: () => true, loadEnvFile: () => { throw Object.assign(new Error('bad line'), { code: 'ERR_INVALID_ARG' }); } });
  assert.equal(broken.code, 0, 'โหลดไฟล์ล้ม = เตือนแล้วใช้ env ที่มี');
  assert.match(broken.err, /โหลดไฟล์ env ไม่สำเร็จ \(ERR_INVALID_ARG\)/);
});

test('fetchAllRows: แบ่งหน้าจนเจอหน้าไม่เต็ม · ครบเพดานหน้า = truncated · HTTP error = RestError · ค่าเริ่มต้นแนบ AbortSignal', async () => {
  const rows = [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, created_at: `2026-10-0${i}T00:00:00.000Z` }));
  const base = { baseUrl: FAKE_URL, key: FAKE_KEY, table: 'pipeline_logs', select: '*', timeoutMs: 0, pageSize: 2 };
  const fake = fakeSupabase({ logRows: rows });
  const all = await settleWithin(report.fetchAllRows({ ...base, fetchImpl: fake.fetchImpl, maxPages: 10 }), 'fetchAllRows ทุกหน้า');
  assert.deepEqual([all.rows.map((r) => r.id), all.truncated], [['r1', 'r2', 'r3', 'r4', 'r5'], false]);
  assert.deepEqual(fake.calls.map((c) => new URL(c.url).searchParams.get('offset')), ['0', '2', '4']);
  const exact = fakeSupabase({ logRows: rows.slice(0, 4) });
  const four = await settleWithin(report.fetchAllRows({ ...base, fetchImpl: exact.fetchImpl, maxPages: 10 }), 'fetchAllRows หน้าพอดี');
  assert.deepEqual([four.rows.length, four.truncated, exact.calls.length], [4, false, 3]);
  const capped = await settleWithin(report.fetchAllRows({ ...base, fetchImpl: fakeSupabase({ logRows: rows }).fetchImpl, maxPages: 2 }), 'fetchAllRows ชนเพดาน');
  assert.deepEqual([capped.rows.length, capped.truncated], [4, true]);
  const failing = fakeSupabase({ fail: { pipeline_logs: () => fakeResponse(400, '{"code":"PGRST100"}') } });
  await assert.rejects(
    settleWithin(report.fetchAllRows({ ...base, fetchImpl: failing.fetchImpl }), 'fetchAllRows error'),
    (e) => e instanceof report.RestError && e.status === 400 && e.table === 'pipeline_logs' && e.body.includes('PGRST100'),
  );
  const withSignal = fakeSupabase({ logRows: [] });
  await settleWithin(report.fetchAllRows({ ...base, timeoutMs: undefined, fetchImpl: withSignal.fetchImpl }), 'fetchAllRows signal');
  assert.ok(withSignal.calls[0].signal instanceof AbortSignal, 'ค่าเริ่มต้นต้องมีเพดานเวลาต่อหน้า');
});

// ── mutation: ซอร์สจริงที่ patch แล้วต้องแดง (กันข้อสอบเขียวลอยๆ) ──────────
async function loadVariant(source) {
  return settleWithin(import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`), 'โหลดโมดูลจาก data: URL', 5_000);
}

const MUTATIONS = [
  {
    name: 'วันเวลาไทยกลายเป็น UTC',
    find: 'export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;',
    replace: 'export const BANGKOK_OFFSET_MS = 0;',
    check: (m) => assert.equal(m.bangkokDay(Date.parse('2026-10-03T17:30:00Z')), '2026-10-04'),
  },
  {
    name: 'origin "ไม่พบ" (ไม่ใช่ URL) ถูกนับว่าพบต้นทาง',
    find: String.raw`if (!/^https?:\/\/\S+$/i.test(url)) return false;`,
    replace: 'if (!url) return false;',
    check: (m) => assert.equal(m.isOriginFound({ flags: [], originPost: { ...NOT_FOUND_ORIGIN } }), false),
  },
  {
    name: 'เพจเราเอง (IG.dara) ถูกนับเป็นต้นทาง',
    find: 'return !OWN_PAGE_RE.test(url);',
    replace: 'return true;',
    check: (m) => assert.equal(m.isOriginFound({ flags: [], originPost: { ...OWN_PAGE_ORIGIN } }), false),
  },
  {
    name: 'percentile เลื่อนอันดับ (off-by-one)',
    find: 'const rank = Math.ceil((p * sorted.length) / 100 - 1e-9);',
    replace: 'const rank = Math.floor((p * sorted.length) / 100) + 1;',
    check: (m) => assert.deepEqual([m.percentile([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 50), m.percentile([30000, 60000, 165000, 291600], 50)], [5, 60000]),
  },
  {
    name: 'ยิงฐานข้อมูลด้วย method เขียน (ไม่ read-only)',
    find: "const init = { method: 'GET', headers:",
    replace: "const init = { method: 'POST', headers:",
    check: async (m) => {
      const r = await runMainOf(m, []);
      assert.equal(r.code, 0);
      assert.ok(r.calls.length > 0);
      for (const c of r.calls) assert.equal(c.method, 'GET');
    },
  },
  {
    name: 'ไม่ลบคีย์/URL ออกจากข้อความ error',
    find: "out = out.split(secret).join('***');",
    replace: 'out = out.split(secret).join(secret);',
    check: async (m) => {
      const r = await runMainOf(m, [], { supabase: fakeSupabase({ fail: { store_items: echoSecrets } }) });
      assert.equal(r.code, 1);
      for (const secret of [FAKE_KEY, FAKE_URL, FAKE_HOST]) assert.ok(!(r.out + r.err).includes(secret), 'ค่าลับหลุด');
    },
  },
  {
    name: 'ตัดซ้ำโหวตเอาตัวเก่าแทนตัวล่าสุด',
    find: 'if (!prev || at > prev.at || (at === prev.at && index > prev.index))',
    replace: 'if (!prev || at < prev.at || (at === prev.at && index > prev.index))',
    check: (m) => {
      const t = m.tallyFeedback(CARD_BY_ID.q_a1.feedback);
      assert.deepEqual([t.up, t.down], [2, 0]);
    },
  },
  {
    name: 'ค่าเครื่องมือเดือนนี้นับแค่ช่วงรายงาน (ไม่ใช่ตั้งแต่วันที่ 1)',
    find: 'if (c.createdMs >= win.monthStartMs) monthToDate += cost;',
    replace: 'if (c.createdMs >= win.fromMs) monthToDate += cost;',
    check: (m) => assert.equal(m.summarize({ cardRows: CARD_ROWS, logRows: [], days: 7, nowMs: NOW }).cost.monthToDateUsd, 0.543),
  },
  {
    name: 'โควตารีเซ็ต (ค่าเพิ่มขึ้น) ถูกนับเป็นการใช้',
    find: 'if (prev !== null && prev > o.pct) {',
    replace: 'if (prev !== null && prev !== o.pct) {',
    check: (m) => assert.equal(m.summarize({ cardRows: CARD_ROWS, logRows: [], days: 7, nowMs: NOW }).quota.accounts.main.usedPctEstimate, 15),
  },
  {
    name: 'เวลาท่อรอใช้ metadata.ms (เวลาตั้งแต่เริ่ม poll ขนาน Blueprint) แทน waitedMs (contract-check #5)',
    find: 'waitMs: finite(meta.waitedMs) ?? finite(meta.ms) ?? finite(row.duration_ms)',
    replace: 'waitMs: finite(meta.ms) ?? finite(row.duration_ms)',
    check: (m) => {
      assertWaitedMs(m);
      assert.equal(m.summarize({ cardRows: CARD_ROWS, logRows: LOG_ROWS, days: 7, nowMs: NOW }).timing.pipelineWaitMs.p90, 1500);
    },
  },
  {
    name: 'waitedMs = 0 (ไม่ได้รอ) ถูกมองเป็นไม่มีค่าแล้วตกไปใช้ ms (|| แทน ??)',
    find: 'waitMs: finite(meta.waitedMs) ?? finite(meta.ms) ?? finite(row.duration_ms)',
    replace: 'waitMs: finite(meta.waitedMs) || finite(meta.ms) || finite(row.duration_ms)',
    check: (m) => assertWaitedMs(m),
  },
  {
    name: 'แบ่งหน้าหยุดเร็ว (หน้าเต็มถือว่าหน้าสุดท้าย)',
    find: 'if (batch.length < pageSize) return { rows, truncated: false };',
    replace: 'if (batch.length <= pageSize) return { rows, truncated: false };',
    check: async (m) => {
      const rows = [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, created_at: `2026-10-0${i}T00:00:00.000Z` }));
      const res = await m.fetchAllRows({
        baseUrl: FAKE_URL, key: FAKE_KEY, table: 'pipeline_logs', select: '*', timeoutMs: 0, pageSize: 2, maxPages: 10,
        fetchImpl: fakeSupabase({ logRows: rows }).fetchImpl,
      });
      assert.equal(res.rows.length, 5);
    },
  },
];

for (const mutation of MUTATIONS) {
  test(`mutation: ${mutation.name} → ข้อสอบต้องแดง (ซอร์สเดิมเขียว)`, async () => {
    assert.equal(SOURCE.split(mutation.find).length - 1, 1, `โค้ดเป้าหมายของ mutation ต้องเจอ 1 ที่พอดี (โค้ดเปลี่ยน = อัปเดตเทสนี้): ${mutation.find}`);
    const baseline = await loadVariant(SOURCE);
    await settleWithin(Promise.resolve().then(() => mutation.check(baseline)), `ซอร์สเดิมต้องผ่าน: ${mutation.name}`, 5_000);
    const mutant = await loadVariant(SOURCE.replace(mutation.find, mutation.replace));
    await assert.rejects(
      settleWithin(Promise.resolve().then(() => mutation.check(mutant)), `mutant: ${mutation.name}`, 5_000),
      (error) => error instanceof assert.AssertionError,
      `mutation "${mutation.name}" ต้องทำให้ข้อสอบแดง`,
    );
  });
}
