// ============================================================
// ⚠️ P8 (2 ส.ค. 69) — เทสพฤติกรรมจริงของด่าน "เตือนก่อนล่ารอบใหม่"
// ------------------------------------------------------------
// สาระที่ต้องพิสูจน์ (ไม่ใช่แค่มีข้อความ guard ในไฟล์):
//   ① ค้างไม่ถึงเกณฑ์ → ล่าได้ตามปกติ
//   ② ค้างเกินเกณฑ์ + ไม่ยืนยัน → 409 DESK_UNUSED_BACKLOG และ runHarvest ต้องไม่ถูกเรียก "แม้ครั้งเดียว"
//   ③ ยืนยันแล้ว (confirm:true / ?confirm=1) → ล่าได้เหมือนเดิมทุกอย่าง
//   ④ DESK_UNUSED_WARN=0 ปิดด่าน · ตั้งตัวเลขอื่น = ปรับเกณฑ์ได้จริง
//   ⑤ คลังพัง/รูปแบบเพี้ยน = ปล่อยผ่าน (fail-open) — ด่านเตือนห้ามทำให้ล่าข่าวพัง
//   ⑥ ท่อปิด (ไม่ตั้ง DESK_PIPELINE) → 503 มาก่อนด่านนี้เสมอ (ห้ามแตะคลังเลย)
//   ⑦ 🔴 กันบั๊ก "body ถูกอ่านไปแล้ว": ด่านนี้แอบอ่าน body เพื่อดู confirm → handleHarvest
//      ต้องยังอ่าน mode/keyword/lanes ได้ครบ (mock ที่ .json() ยิงได้ครั้งเดียว = พฤติกรรมสตรีมจริง
//      + Request ตัวจริงของ Node ที่ใช้เส้น clone() แบบ production)
// แพทเทิร์น register-stub เดียวกับ tests/desk-pipeline-gate-reopen.test.mjs — ห้ามมี network/LLM จริง
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (src) => 'data:text/javascript,' + encodeURIComponent(src);

const STUB_NEXT = _mod(`
export const NextResponse = { json: (body, init) => ({ _body: body, status: (init && init.status) || 200 }) };
`);

// คลังข่าว — ตัวนับ + ของปลอมคุมได้จาก globalThis.__P8
const STUB_STORE = _mod(`
export function createStore(name) {
  return {
    getAll: async () => {
      globalThis.__P8.storeNames.push(name);
      globalThis.__P8.getAll++;
      if (globalThis.__P8.storeBroken) throw new Error('คลังพัง (จำลอง)');
      if (globalThis.__P8.storeBadShape) return { rows: 'ไม่ใช่อาเรย์' };
      return globalThis.__P8.items;
    },
  };
}
`);

// ตัวเผาเงินจริง — ถ้าถูกเรียกตอนโดนกั้น = เทสแดง
const STUB_HARVESTER = _mod(`
export async function runHarvest(opts) {
  globalThis.__P8.runHarvest++;
  globalThis.__P8.lastOpts = opts;
  return { added: 3, harvested: 9, dupSkipped: 1, gated: 2 };
}
export async function pruneOldItems(days) { globalThis.__P8.prune++; globalThis.__P8.pruneDays = days; return 0; }
`);

const STUB_TAXONOMY = _mod(`
export const HARVEST_MODES = [
  { key: 'all', lanes: ['trend', 'good', 'broad'] },
  { key: 'clip', lanes: ['clip'] },
];
`);

// เส้น focus (dynamic import) — ไม่ได้เทสในไฟล์นี้ แต่ stub กันหลุดไปของจริงถ้าใครเพิ่มเคส
const STUB_SCOUT = _mod(`
export function generateFocusQueries() { return [{ q: 'x', lane: 'good', timeRange: 'qdr:y', endpoint: 'search' }]; }
`);

const hook = `
export async function resolve(specifier, ctx, next) {
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/harvester') return { url: ${JSON.stringify(STUB_HARVESTER)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/taxonomy') return { url: ${JSON.stringify(STUB_TAXONOMY)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/goodNewsScout') return { url: ${JSON.stringify(STUB_SCOUT)}, shortCircuit: true };
  if (specifier === '@/lib/deskPipelineGate') {
    // ของจริง — เป็นหน่วยที่กำลังทดสอบร่วม (ลำดับด่าน 503 ต้องมาก่อน 409)
    return next(new URL('../src/lib/deskPipelineGate.js', ${JSON.stringify(import.meta.url)}).href, ctx);
  }
  if (specifier.startsWith('@/')) {
    // ห้าม fail-open ไปโหลดโมดูลจริง — เจอ '@/' ที่ไม่รู้จัก = ระเบิดทันที ให้คนเติม stub
    throw new Error('UNSTUBBED_IMPORT_FORBIDDEN: ' + specifier);
  }
  return next(specifier, ctx);
}
`;
register(_mod(hook));

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };

const { POST, GET } = await import('../src/app/api/news-desk/harvest/route.js');

// ── ตัวช่วยสร้างข่าวในคลัง ──
const untouched = (n) => Array.from({ length: n }, (_, i) => ({ id: 'N' + i, status: 'new', title: 'ข่าว ' + i }));

/**
 * mock request แบบ "สตรีมจริง": .json() ยิงได้ครั้งเดียว ครั้งที่สองพัง
 * → ถ้าด่านอ่าน body ทิ้งโดยไม่คืนของ handleHarvest จะอ่านไม่ได้ = เทสแดงทันที
 */
function mkOneShotReq(body, extra = {}) {
  let used = false;
  return {
    ...extra,
    json: async () => {
      if (used) throw new TypeError('Body is unusable: Body has already been read');
      used = true;
      return body;
    },
  };
}

/** Request ตัวจริงของ Node (undici) — เส้น clone() แบบ production */
function mkRealPostReq(body) {
  return new Request('http://localhost/api/news-desk/harvest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 🔴 ห้ามใช้ default ของ destructuring กับ pipeline — ส่ง undefined เข้ามาจะโดน default '1' ทับ
//    (เทส "ท่อปิด" จะกลายเป็นท่อเปิดเงียบๆ) → เช็คด้วย hasOwnProperty แทน
function withEnv(opts, fn) {
  const { warn = undefined, items = [], broken = false, badShape = false } = opts;
  const hasPipeline = Object.prototype.hasOwnProperty.call(opts, 'pipeline');
  const pipeline = hasPipeline ? opts.pipeline : '1';
  return async () => {
    const savedPipe = process.env.DESK_PIPELINE;
    const savedWarn = process.env.DESK_UNUSED_WARN;
    if (pipeline === undefined || pipeline === null) delete process.env.DESK_PIPELINE; else process.env.DESK_PIPELINE = pipeline;
    if (warn === undefined) delete process.env.DESK_UNUSED_WARN; else process.env.DESK_UNUSED_WARN = warn;
    globalThis.__P8 = {
      items, storeBroken: broken, storeBadShape: badShape,
      getAll: 0, storeNames: [], runHarvest: 0, prune: 0, pruneDays: null, lastOpts: null,
    };
    try { return await fn(); } finally {
      if (savedPipe === undefined) delete process.env.DESK_PIPELINE; else process.env.DESK_PIPELINE = savedPipe;
      if (savedWarn === undefined) delete process.env.DESK_UNUSED_WARN; else process.env.DESK_UNUSED_WARN = savedWarn;
      delete globalThis.__P8;
    }
  };
}

// ============================================================
// ① ต่ำกว่าเกณฑ์ → ล่าได้ตามปกติ
// ============================================================
test('ค้าง 5 ใบ (ต่ำกว่าเกณฑ์ 200) → ล่าได้ตามปกติ', withEnv({ items: untouched(5) }, async () => {
  const res = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.runHarvest, 1, 'ต้องล่าจริง 1 รอบ');
  assert.strictEqual(globalThis.__P8.prune, 1, 'ท่อเดิม (pruneOldItems) ต้องยังทำงาน');
  assert.deepStrictEqual(globalThis.__P8.lastOpts.lanes, ['trend'], 'lanes ใน body ต้องถึง runHarvest ครบ');
  assert.ok(globalThis.__P8.storeNames.includes('news-desk'), 'ต้องนับจากคลัง news-desk');
}));

// ============================================================
// ② เกินเกณฑ์ + ไม่ยืนยัน → 409 และห้ามล่าแม้ครั้งเดียว
// ============================================================
test('ค้าง 250 ใบ ไม่ยืนยัน → 409 DESK_UNUSED_BACKLOG และ runHarvest ไม่ถูกเรียกเลย', withEnv({ items: untouched(250) }, async () => {
  const res = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res._body.success, false);
  assert.strictEqual(res._body.errorType, 'DESK_UNUSED_BACKLOG');
  assert.strictEqual(res._body.unusedCount, 250);
  assert.strictEqual(res._body.threshold, 200);
  assert.strictEqual(globalThis.__P8.runHarvest, 0, '🔴 โดนกั้นแล้วห้ามล่าเด็ดขาด');
  assert.strictEqual(globalThis.__P8.prune, 0, 'โดนกั้นแล้วห้ามแตะคลังฝั่งลบของเก่า');
}));

// ============================================================
// ③ ยืนยันแล้ว → ล่าได้เหมือนเดิม (POST / GET)
// ============================================================
test('confirm:true (POST) → ล่าได้แม้ค้าง 250 ใบ + ไม่เสียเวลานับคลัง', withEnv({ items: untouched(250) }, async () => {
  const res = await POST(mkOneShotReq({ confirm: true, lanes: ['good'] }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
  assert.deepStrictEqual(globalThis.__P8.lastOpts.lanes, ['good'], 'ยืนยันแล้ว body ต้องถึงปลายทางครบ');
  assert.strictEqual(globalThis.__P8.getAll, 0, 'ยืนยันแล้วไม่ต้องนับคลัง (ตัดงานเปล่า)');
}));

test('?confirm=1 (GET ผ่าน nextUrl) → ล่าได้แม้ค้าง 250 ใบ', withEnv({ items: untouched(250) }, async () => {
  const req = mkOneShotReq({}, { nextUrl: { searchParams: new URLSearchParams('confirm=1') } });
  const res = await GET(req);
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
}));

test('?confirm=1 (GET ด้วย Request ตัวจริง ไม่มี nextUrl) → ล่าได้', withEnv({ items: untouched(250) }, async () => {
  const res = await GET(new Request('http://localhost/api/news-desk/harvest?confirm=1'));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
}));

test('GET (cron) ไม่ยืนยัน ค้าง 250 ใบ → 409 ไม่ล่า', withEnv({ items: untouched(250) }, async () => {
  const res = await GET(new Request('http://localhost/api/news-desk/harvest'));
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res._body.errorType, 'DESK_UNUSED_BACKLOG');
  assert.strictEqual(globalThis.__P8.runHarvest, 0);
}));

// ============================================================
// ④ env — ปิดด่าน / ปรับเกณฑ์
// ============================================================
test('DESK_UNUSED_WARN=0 → ปิดด่านทั้งหมด: ล่าได้ + ไม่แตะคลังเลย', withEnv({ warn: '0', items: untouched(9999) }, async () => {
  const res = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
  assert.strictEqual(globalThis.__P8.getAll, 0, 'ปิดด่านแล้วต้องไม่เสียเวลาอ่านคลัง');
}));

test('DESK_UNUSED_WARN=10 → ปรับเกณฑ์ได้จริง (12 ใบกั้น · 10 ใบเท่าเกณฑ์ยังผ่าน)', withEnv({ warn: '10', items: untouched(12) }, async () => {
  const blocked = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(blocked.status, 409);
  assert.strictEqual(blocked._body.threshold, 10);
  assert.strictEqual(blocked._body.unusedCount, 12);

  // "เกิน" เท่านั้นถึงกั้น — เท่าเกณฑ์พอดีต้องผ่าน
  globalThis.__P8.items = untouched(10);
  const passed = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(passed._body.success, true, 'เท่าเกณฑ์พอดี (ไม่เกิน) ต้องล่าได้');
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
}));

// ============================================================
// ⑤ fail-open — คลังพัง/รูปแบบเพี้ยน ห้ามทำให้ล่าข่าวพัง
// ============================================================
test('คลังพัง (getAll ระเบิด) → ปล่อยผ่าน ล่าได้ (fail-open)', withEnv({ broken: true, items: untouched(250) }, async () => {
  const res = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(res._body.success, true, 'ด่านเตือนพังห้ามทำให้ล่าข่าวพัง');
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
}));

test('คลังคืนค่าผิดรูป (ไม่ใช่อาเรย์) → ปล่อยผ่าน ล่าได้ (fail-open)', withEnv({ badShape: true }, async () => {
  const res = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
}));

// ============================================================
// นับเฉพาะ "ยังไม่มีใครแตะ" — ของที่ถูกหยิบไปแล้วห้ามนับ
// ============================================================
test('ค้าง 250 ใบแต่ถูกแตะแล้วทุกใบ (claimed/sent/used/shortlisted/สถานะอื่น) → ไม่นับ ล่าได้', withEnv({}, async () => {
  const touched = [
    ...Array.from({ length: 60 }, (_, i) => ({ id: 'A' + i, status: 'new', claimedBy: 'ken' })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: 'B' + i, status: 'new', sentAt: '2026-08-01' })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: 'C' + i, status: 'new', used: true })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: 'D' + i, status: 'new', shortlisted: true })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: 'E' + i, status: 'sent' })),
    null, undefined,
  ];
  globalThis.__P8.items = touched;
  const res = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(res._body.success, true, 'ของที่มีคนแตะแล้วห้ามนับเป็นงานค้าง');
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
}));

// ============================================================
// ⑥ ลำดับด่าน — ท่อปิดต้องมาก่อนเสมอ
// ============================================================
test('ท่อปิด (ไม่ตั้ง DESK_PIPELINE): POST → 503 มาก่อนด่านค้างคลัง + ไม่แตะคลัง/ไม่ล่า', withEnv({ pipeline: undefined, items: untouched(250) }, async () => {
  const res = await POST(mkOneShotReq({ lanes: ['trend'] }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res._body.errorType, 'DESK_PIPELINE_DISABLED');
  assert.strictEqual(globalThis.__P8.getAll, 0, 'ท่อปิดแล้วห้ามยิงคลังแม้แต่นับ');
  assert.strictEqual(globalThis.__P8.runHarvest, 0);
}));

test('ท่อปิด: GET → 503 เหมือนกัน (ด่านค้างคลังห้ามแซงหน้า)', withEnv({ pipeline: undefined, items: untouched(250) }, async () => {
  const res = await GET(new Request('http://localhost/api/news-desk/harvest'));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res._body.errorType, 'DESK_PIPELINE_DISABLED');
  assert.strictEqual(globalThis.__P8.getAll, 0);
  assert.strictEqual(globalThis.__P8.runHarvest, 0);
}));

// ============================================================
// ⑦ 🔴 กันบั๊ก "body ถูกอ่านไปแล้ว" — ด่านแอบอ่าน confirm แล้วปลายทางต้องยังอ่านได้ครบ
// ============================================================
test('POST {mode} ผ่านด่าน → handleHarvest ยังอ่าน mode ได้ (json() ยิงได้ครั้งเดียว)', withEnv({ items: untouched(5) }, async () => {
  const res = await POST(mkOneShotReq({ mode: 'clip' }));
  assert.strictEqual(res._body.success, true, '🔴 body ต้องไม่หายหลังด่านแอบอ่าน');
  assert.strictEqual(globalThis.__P8.runHarvest, 1);
  assert.deepStrictEqual(globalThis.__P8.lastOpts.lanes, ['clip'], 'mode ต้องแปลงเป็น lanes ของโหมดนั้นจริง');
}));

test('POST {mode} + confirm ตอนค้างเกินเกณฑ์ → ยังอ่าน mode ได้ครบ', withEnv({ items: untouched(250) }, async () => {
  const res = await POST(mkOneShotReq({ mode: 'all', confirm: true }));
  assert.strictEqual(res._body.success, true);
  assert.deepStrictEqual(globalThis.__P8.lastOpts.lanes, ['trend', 'good', 'broad']);
}));

test('POST {keyword} ผ่านด่าน → handleHarvest ยังอ่าน keyword ได้ (extraQueries ครบ 4)', withEnv({ items: untouched(5) }, async () => {
  const res = await POST(mkOneShotReq({ keyword: 'ลิซ่า' }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.lastOpts.extraQueries.length, 4, 'คีย์เวิร์ดต้องถึงปลายทางจริง');
  assert.ok(globalThis.__P8.lastOpts.extraQueries[0].q.includes('ลิซ่า'));
}));

test('POST ด้วย Request ตัวจริง (เส้น clone แบบ production) → handleHarvest ยังอ่าน mode ได้', withEnv({ items: untouched(5) }, async () => {
  const res = await POST(mkRealPostReq({ mode: 'all' }));
  assert.strictEqual(res._body.success, true);
  assert.deepStrictEqual(globalThis.__P8.lastOpts.lanes, ['trend', 'good', 'broad'], '🔴 เส้น clone() ห้ามกิน body ของปลายทาง');
}));

test('POST ด้วย Request ตัวจริง + confirm:true ตอนค้างเกินเกณฑ์ → ล่าได้ + body ครบ', withEnv({ items: untouched(250) }, async () => {
  const res = await POST(mkRealPostReq({ mode: 'clip', confirm: true }));
  assert.strictEqual(res._body.success, true);
  assert.deepStrictEqual(globalThis.__P8.lastOpts.lanes, ['clip']);
}));

test('POST body ว่าง/ไม่ใช่ JSON → ไม่ล้ม ใช้เลนเริ่มต้นเดิม (11 เลนหนัก)', withEnv({ items: untouched(5) }, async () => {
  const req = new Request('http://localhost/api/news-desk/harvest', { method: 'POST', body: 'ไม่ใช่ JSON' });
  const res = await POST(req);
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__P8.lastOpts.lanes.length, 11, 'body พังต้องตกเป็นรอบหนักเต็มเลนตามเดิม');
}));
