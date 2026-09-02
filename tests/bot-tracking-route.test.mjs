// ★ 2 ก.ย. 69 — /api/bot/tracking สมุดจดงานที่บอทดิสคอร์ดกำลังตามอยู่ (บอทจำงานข้ามรีสตาร์ต ข้อ 12)
//   โหลด route จริงแบบอ่านข้อความแล้วแทน import ด้วยตัวปลอม (แบบเดียวกับ tests/queue-clear-guard.test.mjs)
//   รันได้โดยไม่ต้องตั้ง env: node --test tests/bot-tracking-route.test.mjs
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนโค้ด (ยิงจริง 2 ก.ย. 69 ด้วยสคริปต์ทุบ-เทส-คืนไฟล์ byte-exact):
//   M1 ตัดบรรทัด fail-closed (ไม่ตั้ง DISCORD_API_SECRET → 403) ออก → แดง 1: 'ไม่ตั้ง DISCORD_API_SECRET → ปิดประตูทุก method'
//   M2 ให้ secretsMatch คืน true เสมอ → แดง 1: 'กุญแจผิด/ไม่ส่ง → 401' (รอบแรกไม่กัด เพราะกุญแจผิดทุกตัวยาวไม่เท่ากุญแจจริง
//      ถูกด่านความยาวปัดก่อน — เพิ่มเคส 'S3CREX' ยาวเท่ากันแล้วจึงกัด)
//   M3 ตัดการตรวจชนิดช่องบังคับ (jobId/channelId/messageId) → แดง 1: 'ข้อมูลผิดชนิด → 400'
//   M4 DELETE ไม่เรียก store.remove → แดง 2: 'DELETE แล้วหาย' + 'store พัง → 500'
//   ── รอบแก้ตามผู้ตรวจไขว้ 2 ก.ย. 69 (store ปลอมเลียนกับดักแคชค้างของ persistStore แล้ว) ──
//   M5 GET ใช้ store.getAll() ธรรมดาแทน {authoritative:true} → แดง 3: 'สมุดผี …' + 'DELETE แล้วหาย …' + 'POST ซ้ำ jobId เดิม = upsert …'
//   M6 ไม่ trim กุญแจที่บอทส่งมา → แดง 1: 'กุญแจมีช่องว่าง/ขึ้นบรรทัดท้าย …'
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app/api/bot/tracking/route.js', import.meta.url), 'utf8')
  .replace(/^import .*$/mg, '')
  .replace(/^export const .*$/mg, '')
  .replace(/^export async function (GET|POST|DELETE)/mg, 'async function $1');

// store ปลอมในหน่วยความจำ — เลียนสัญญาของ persistStore (add ชน id = โยน · remove ไม่เจอ = โยน "ไม่พบ id")
//   ★ 2 ก.ย. 69 ผู้ตรวจไขว้ (high): เลียนกับดัก "แคชค้าง" ของ persistStore ด้วย — getAll() ธรรมดาคืน staleCache
//   (แคชในหน่วยความจำของ lambda ที่เคยเห็นตอน add แต่ไม่เห็น remove/update ที่ไปตกอีก lambda) · getAll({authoritative:true})
//   เท่านั้นที่คืนความจริง (items) — route ที่อ่านแบบธรรมดาจะเห็น "งานผี" แล้วเทส DELETE/upsert/สมุดผีต้องแดง
function makeStore() {
  const items = [];
  const staleCache = [];
  const storeNames = [];
  const getAllCalls = [];
  const createStore = (name) => {
    storeNames.push(name);
    return {
      getAll: async (opts) => {
        getAllCalls.push(opts);
        return opts?.authoritative === true ? items.map((i) => ({ ...i })) : staleCache.map((i) => ({ ...i }));
      },
      findById: async (id) => items.find((i) => i.id === id) || null,
      add: async (item) => {
        if (items.some((i) => i.id === item.id)) throw new Error(`duplicate key value violates unique constraint: ${item.id}`);
        items.push({ ...item });
        staleCache.push({ ...item });
        return item;
      },
      update: async (id, patch) => {
        const idx = items.findIndex((i) => i.id === id);
        if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
        Object.assign(items[idx], patch);
        return items[idx];
      },
      remove: async (id) => {
        const idx = items.findIndex((i) => i.id === id);
        if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
        items.splice(idx, 1);
        return { removed: true };
      },
    };
  };
  return { items, staleCache, storeNames, getAllCalls, createStore };
}

function load({ secret } = {}) {
  const store = makeStore();
  const NextResponse = { json: (body, init) => ({ body, status: init?.status || 200 }) };
  const quiet = { error() {}, warn() {}, log() {} };
  const env = {};
  if (secret !== undefined) env.DISCORD_API_SECRET = secret;
  const routes = new Function('NextResponse', 'createStore', 'process', 'console', `${src}\nreturn { GET, POST, DELETE };`)(
    NextResponse, store.createStore, { env }, quiet);
  return { ...routes, ...store };
}

const BAD_JSON = Symbol('bad json');
function req({ body, botSecret, apiKey, query = '' } = {}) {
  return {
    url: `http://localhost/api/bot/tracking${query}`,
    headers: {
      get: (name) => {
        if (name === 'x-bot-secret') return botSecret || '';
        if (name === 'x-api-key') return apiKey || '';
        return '';
      },
    },
    json: async () => {
      if (body === BAD_JSON) throw new SyntaxError('Unexpected token');
      return body;
    },
  };
}

const validEntry = () => ({
  jobId: 'job-abc', channelId: 'CH1', messageId: 'MSG-bot', sourceMessageId: 'MSG-user',
  guildId: 'G1', userId: 'U1', instance: 'host_ab12c', startedAt: '2026-09-02T03:49:00.000Z',
  queueUrl: 'http://api.test/api/queue/add',
});

test('ไม่ตั้ง DISCORD_API_SECRET → ปิดประตูทุก method (fail-closed) แม้ส่ง header มา', async () => {
  const r = load({ secret: undefined });
  for (const call of [
    () => r.GET(req({ botSecret: 'anything' })),
    () => r.POST(req({ body: validEntry(), botSecret: 'anything' })),
    () => r.DELETE(req({ query: '?jobId=job-abc', botSecret: 'anything' })),
  ]) {
    const res = await call();
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.errorType, 'BOT_SECRET_NOT_CONFIGURED');
  }
  assert.equal(r.storeNames.length, 0, 'ต้องไม่แตะ store เลย');
  // env ว่างเปล่า (มีแต่ช่องว่าง) = ไม่ตั้ง
  const r2 = load({ secret: '   ' });
  assert.equal((await r2.GET(req({ botSecret: '   ' }))).status, 403);
});

test('กุญแจผิด/ไม่ส่ง → 401 และไม่แตะ store', async () => {
  const r = load({ secret: 'S3CRET' });
  assert.equal((await r.GET(req())).status, 401);
  assert.equal((await r.GET(req({ botSecret: 'wrong' }))).status, 401);
  assert.equal((await r.GET(req({ botSecret: 'S3CREX' }))).status, 401); // ยาวเท่ากันแต่ผิด 1 ตัว — ต้องเทียบตัวอักษรจริง
  assert.equal((await r.GET(req({ apiKey: 'S3CREX' }))).status, 401);
  assert.equal((await r.POST(req({ body: validEntry(), botSecret: 'S3CRE' }))).status, 401); // สั้นไป 1 ตัว
  const del = await r.DELETE(req({ query: '?jobId=job-abc', apiKey: 'nope' }));
  assert.equal(del.status, 401);
  assert.equal(del.body.errorType, 'UNAUTHORIZED');
  assert.equal(r.storeNames.length, 0);
});

test('POST แล้ว GET เห็น · เก็บใน store ชื่อ bot-tracking · x-api-key แบบเดียวกับ queue/add ก็ผ่าน', async () => {
  const r = load({ secret: 'S3CRET' });
  const created = await r.POST(req({ body: validEntry(), botSecret: 'S3CRET' }));
  assert.equal(created.status, 200);
  assert.equal(created.body.success, true);
  assert.equal(created.body.created, true);
  assert.ok(r.storeNames.includes('bot-tracking'));

  const listed = await r.GET(req({ apiKey: 'S3CRET' })); // header เดิมที่บอทใช้กับ /api/queue/add
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  const item = listed.body.items[0];
  assert.equal(item.jobId, 'job-abc');
  assert.equal(item.channelId, 'CH1');
  assert.equal(item.messageId, 'MSG-bot');
  assert.equal(item.sourceMessageId, 'MSG-user');
  assert.equal(item.instance, 'host_ab12c');
  assert.equal(item.startedAt, '2026-09-02T03:49:00.000Z');
  assert.equal(item.queueUrl, 'http://api.test/api/queue/add');
  assert.equal(item.id, 'bt_job-abc');
});

test('POST ซ้ำ jobId เดิม = upsert (ทับ ไม่เพิ่มแถว) · GET ?jobId= กรองเฉพาะงานนั้น', async () => {
  const r = load({ secret: 'S3CRET' });
  await r.POST(req({ body: validEntry(), botSecret: 'S3CRET' }));
  await r.POST(req({ body: { ...validEntry(), jobId: 'job-other', messageId: 'MSG-2' }, botSecret: 'S3CRET' }));
  const again = await r.POST(req({ body: { ...validEntry(), instance: 'newhost_zz', messageId: 'MSG-bot-2' }, botSecret: 'S3CRET' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);

  const all = await r.GET(req({ botSecret: 'S3CRET' }));
  assert.equal(all.body.count, 2);
  const abc = all.body.items.find((i) => i.jobId === 'job-abc');
  assert.equal(abc.instance, 'newhost_zz', 'ต้องเป็นค่าที่ทับล่าสุด');
  assert.equal(abc.messageId, 'MSG-bot-2');

  const one = await r.GET(req({ botSecret: 'S3CRET', query: '?jobId=job-other' }));
  assert.equal(one.body.count, 1);
  assert.equal(one.body.items[0].jobId, 'job-other');
  const none = await r.GET(req({ botSecret: 'S3CRET', query: '?jobId=job-nope' }));
  assert.equal(none.body.count, 0);
});

test('DELETE แล้วหาย · ลบซ้ำไม่พัง (idempotent) · ไม่ส่ง jobId → 400', async () => {
  const r = load({ secret: 'S3CRET' });
  await r.POST(req({ body: validEntry(), botSecret: 'S3CRET' }));
  const del = await r.DELETE(req({ query: '?jobId=job-abc', botSecret: 'S3CRET' }));
  assert.equal(del.status, 200);
  assert.equal(del.body.removed, true);
  assert.equal((await r.GET(req({ botSecret: 'S3CRET' }))).body.count, 0);
  assert.equal(r.items.length, 0);

  const again = await r.DELETE(req({ query: '?jobId=job-abc', botSecret: 'S3CRET' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.removed, false);

  const missing = await r.DELETE(req({ botSecret: 'S3CRET' }));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.errorType, 'VALIDATION_ERROR');
});

test('สมุดผี: lambda อื่นลบงานไปแล้วแต่แคชเครื่องนี้ยังถือ → GET ต้องอ่านฐานหลักจริง (authoritative) ไม่คืนงานผี', async () => {
  const r = load({ secret: 'S3CRET' });
  await r.POST(req({ body: validEntry(), botSecret: 'S3CRET' }));
  assert.equal(r.staleCache.length, 1, 'แคชของ lambda นี้เห็นงานตอน add');
  // จำลอง: DELETE ไปตกอีก lambda — ฐานหลักไม่มีแล้ว แต่แคชในหน่วยความจำของ lambda นี้ยังถือ [J] อยู่
  r.items.splice(0, r.items.length);
  const all = await r.GET(req({ botSecret: 'S3CRET' }));
  assert.equal(all.status, 200);
  assert.equal(all.body.count, 0, 'ห้ามเห็นงานผี — บอทตัวใหม่จะกู้งานที่โพสต์ผลไปแล้วแล้วโพสต์ซ้ำ');
  const one = await r.GET(req({ botSecret: 'S3CRET', query: '?jobId=job-abc' }));
  assert.equal(one.body.count, 0);
  assert.ok(r.getAllCalls.length >= 2);
  for (const opts of r.getAllCalls) assert.equal(opts?.authoritative, true, 'GET ทุกครั้งต้องอ่านแบบ authoritative');
});

test('กุญแจมีช่องว่าง/ขึ้นบรรทัดท้าย (env บน Vercel/Railway) → ยังผ่านเหมือน /api/queue/add', async () => {
  const r = load({ secret: 'S3CRET' });
  assert.equal((await r.GET(req({ botSecret: 'S3CRET\n' }))).status, 200);
  assert.equal((await r.GET(req({ apiKey: ' S3CRET ' }))).status, 200);
  assert.equal((await r.POST(req({ body: validEntry(), botSecret: '\tS3CRET\r\n' }))).status, 200);
  // ฝั่งเซิร์ฟเวอร์เองก็มีช่องว่างท้าย + บอทส่งมาพร้อมช่องว่าง → ตรงกัน
  const r2 = load({ secret: ' S3CRET\n' });
  assert.equal((await r2.GET(req({ botSecret: 'S3CRET\n' }))).status, 200);
  assert.equal((await r2.GET(req({ botSecret: 'S3CRET' }))).status, 200);
  assert.equal((await r2.GET(req({ botSecret: 'S3CREX\n' }))).status, 401, 'ตัดช่องว่างแล้วยังต้องเทียบตัวอักษรจริง');
});

test('ข้อมูลผิดชนิด → 400 และไม่เขียนลง store', async () => {
  const r = load({ secret: 'S3CRET' });
  const bad = [
    { ...validEntry(), jobId: 12345 },
    { ...validEntry(), jobId: '   ' },
    { ...validEntry(), channelId: undefined },
    { ...validEntry(), messageId: null },
    { ...validEntry(), startedAt: 'not-a-date' },
    { ...validEntry(), startedAt: -5 },
    { ...validEntry(), guildId: 99 },
    { ...validEntry(), instance: ['x'] },
    { ...validEntry(), queueUrl: 42 },
    ['not', 'an', 'object'],
    null,
  ];
  for (const body of bad) {
    const res = await r.POST(req({ body, botSecret: 'S3CRET' }));
    assert.equal(res.status, 400, `ควร 400 สำหรับ ${JSON.stringify(body)}`);
    assert.equal(res.body.success, false);
    assert.equal(res.body.errorType, 'VALIDATION_ERROR');
  }
  const broken = await r.POST(req({ body: BAD_JSON, botSecret: 'S3CRET' }));
  assert.equal(broken.status, 400);
  assert.equal(broken.body.errorType, 'INVALID_JSON');
  assert.equal(r.items.length, 0);
});

test('startedAt เป็นเลข ms → เก็บเป็น ISO · ช่องเลือกไม่ส่ง → null · ไม่ส่ง startedAt → ใส่เวลาปัจจุบัน', async () => {
  const r = load({ secret: 'S3CRET' });
  const ms = Date.parse('2026-09-02T03:49:00.000Z');
  await r.POST(req({ body: { jobId: 'j1', channelId: 'c', messageId: 'm', startedAt: ms }, botSecret: 'S3CRET' }));
  const before = Date.now();
  await r.POST(req({ body: { jobId: 'j2', channelId: 'c', messageId: 'm' }, botSecret: 'S3CRET' }));
  const items = (await r.GET(req({ botSecret: 'S3CRET' }))).body.items;
  const j1 = items.find((i) => i.jobId === 'j1');
  assert.equal(j1.startedAt, '2026-09-02T03:49:00.000Z');
  assert.equal(j1.guildId, null);
  assert.equal(j1.userId, null);
  assert.equal(j1.sourceMessageId, null);
  assert.equal(j1.instance, null);
  assert.equal(j1.queueUrl, null);
  const j2 = items.find((i) => i.jobId === 'j2');
  assert.ok(Date.parse(j2.startedAt) >= before - 1000 && Date.parse(j2.startedAt) <= Date.now() + 1000);
});

test('store พัง → 500 พร้อม errorType (ไม่โยน error ดิบ)', async () => {
  const r = load({ secret: 'S3CRET' });
  const broken = new Function('NextResponse', 'createStore', 'process', 'console', `${src}\nreturn { GET, POST, DELETE };`)(
    { json: (body, init) => ({ body, status: init?.status || 200 }) },
    () => ({ getAll: async () => { throw new Error('db down'); }, findById: async () => { throw new Error('db down'); }, remove: async () => { throw new Error('db down'); } }),
    { env: { DISCORD_API_SECRET: 'S3CRET' } }, { error() {}, warn() {}, log() {} });
  const g = await broken.GET(req({ botSecret: 'S3CRET' }));
  assert.equal(g.status, 500);
  assert.equal(g.body.errorType, 'BOT_TRACKING_READ_ERROR');
  const p = await broken.POST(req({ body: validEntry(), botSecret: 'S3CRET' }));
  assert.equal(p.status, 500);
  assert.equal(p.body.errorType, 'BOT_TRACKING_WRITE_ERROR');
  const d = await broken.DELETE(req({ query: '?jobId=x', botSecret: 'S3CRET' }));
  assert.equal(d.status, 500);
  assert.equal(d.body.errorType, 'BOT_TRACKING_DELETE_ERROR');
  assert.equal(r.items.length, 0);
});
