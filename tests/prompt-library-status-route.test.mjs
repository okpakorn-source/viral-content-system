// ★ 3 ก.ย. 69 (F14 แบบ FINAL card-library) — /api/prompt-library สถานะการ์ด (active/archived/proposed) + ด่านลบจริง
//   โหลด route จริงแบบอ่านข้อความแล้วแทน import ด้วยตัวปลอม (แบบเดียวกับ tests/bot-tracking-route.test.mjs)
//   รันได้โดยไม่ต้องตั้ง env: node --test tests/prompt-library-status-route.test.mjs
//
//   สัญญาที่คุ้มครอง:
//   1. สวิตช์ CARD_LIBRARY_V2 default เปิด (!== '0') — ปิด ('0') = พฤติกรรมเดิมทุกเส้นทาง (พิสูจน์ stringify เท่ากัน)
//   2. PUT action archive/restore ตั้ง status · PUT whitelist รับ status เฉพาะค่า valid — ค่าเพี้ยน = เมินเงียบ
//      (viral-library spread payload จาก AI เข้า PUT ตรง — ห้ามตอบ 400 ใส่ค่าเพี้ยน เดี๋ยวท่อบันทึกเดิมพัง)
//   3. DELETE รายใบ: ยืนยันซ้ำ ?confirm=<id> + ห้ามลบใบ usageCount > 0 (เคสเก่าอ้าง promptId) · id=all คงด่าน ADMIN_API_KEY เดิม
//   4. GET ไม่กรอง status (F7: ใบพักต้องยังโผล่ให้ UI กู้คืนได้) + คืน field status ตามจริง · POST ไม่รับ status
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนไฟล์ byte-exact (ยิงจริง 3 ก.ย. 69 — ผลอยู่ท้ายรายงานสายงาน):
//   M1 archive เซ็ต 'active' แทน 'archived' → แดง (เทส archive/restore)
//   M2 ตัดด่าน usageCount ใน DELETE → แดง (เทส USAGE_PROTECTED)
//   M3 สลับสวิตช์เป็น === '1' (default กลายเป็นปิด) → แดง (เทส default เปิด + archive)
//   M4 ตัดด่าน confirm ใน DELETE → แดง (เทส CONFIRM_REQUIRED)
//   M5 whitelist status รับทุกค่า (ตัด includes) → แดง (เทสค่าเพี้ยนถูกเมิน)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app/api/prompt-library/route.js', import.meta.url), 'utf8')
  .replace(/^import .*$/mg, '')
  .replace(/^export async function (GET|POST|PUT|DELETE)/mg, 'async function $1');

// store ปลอมในหน่วยความจำ — เลียนสัญญา persistStore เฉพาะที่ route ใช้
// (update/remove ไม่เจอ id = โยน "ไม่พบ id" · update เซ็ต updatedAt เอง — ตรึงเป็น 'T' ให้เทียบไบต์ได้)
function makeStore() {
  const items = [];
  return {
    items,
    getAll: async () => items.map(i => ({ ...i })),
    findById: async (id) => items.find(i => i.id === id) || null,
    add: async (item) => { items.push(item); return item; },
    count: async () => items.length,
    update: async (id, updateFn) => {
      const idx = items.findIndex(i => i.id === id);
      if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
      items[idx] = updateFn(items[idx]);
      items[idx].updatedAt = 'T';
      return items[idx];
    },
    remove: async (id) => {
      const idx = items.findIndex(i => i.id === id);
      if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
      items.splice(idx, 1);
      return { removed: true, remaining: items.length };
    },
    removeAll: async () => { items.length = 0; return { removedAll: true, remaining: 0 }; },
  };
}

function load(env = {}) {
  const store = makeStore();
  const NextResponse = { json: (body, init) => ({ body, status: init?.status || 200 }) };
  const quiet = { error() {}, warn() {}, log() {} };
  const routes = new Function('NextResponse', 'randomUUID', 'createStore', 'process', 'console',
    `${src}\nreturn { GET, POST, PUT, DELETE };`)(
    NextResponse, () => '0123456789abcdef', () => store, { env: { ...env } }, quiet);
  return { ...routes, store };
}

const getReq = (query = '') => ({ url: `http://localhost/api/prompt-library${query}` });
const jsonReq = (body) => ({ url: 'http://localhost/api/prompt-library', json: async () => body });
const delReq = (query = '', headers = {}) => ({
  url: `http://localhost/api/prompt-library${query}`,
  headers: { get: (n) => headers[n] || '' },
});

// ใบตัวอย่าง — ใบเดิมของคลังไม่มี field status (= active)
const seed = (store) => {
  store.items.push(
    { id: 'a1', promptName: 'การ์ดหลัก', category: 'ข่าวอบอุ่น', viralScore: 90, usageCount: 0, successCount: 0 },
    { id: 'b2', promptName: 'ใบพัก', category: 'ข่าวดราม่า', viralScore: 80, usageCount: 3, status: 'archived' },
    { id: 'c3', promptName: 'ใบเสนอ', category: 'ข่าวดราม่า', viralScore: 70, usageCount: 0, status: 'proposed' },
  );
};

test('GET คืน status ตามจริง (pass-through) และ "ไม่กรอง" — ใบพัก/เสนอยังโผล่ให้ UI เห็น · เปิด/ปิดสวิตช์ตอบไบต์เดียวกัน', async () => {
  const on = load();
  const off = load({ CARD_LIBRARY_V2: '0' });
  seed(on.store); seed(off.store);
  const rOn = await on.GET(getReq());
  const rOff = await off.GET(getReq());
  assert.equal(rOn.status, 200);
  assert.equal(rOn.body.stats.total, 3);
  const byId = Object.fromEntries(rOn.body.prompts.map(p => [p.id, p]));
  assert.ok(!('status' in byId.a1), 'ใบเดิมไม่มี field status — ห้ามแต่งเติม');
  assert.equal(byId.b2.status, 'archived');
  assert.equal(byId.c3.status, 'proposed');
  assert.equal(rOn.body.prompts.length, 3, 'GET ต้องไม่กรองใบพัก/เสนอออก (F7: route ไม่กรอง)');
  assert.equal(JSON.stringify(rOn.body), JSON.stringify(rOff.body), 'GET เปิด/ปิดสวิตช์ = ไบต์เดียวกัน');
});

test('default เปิด: PUT action archive → archived · restore → active · ตอบ prompt ที่อัปเดตแล้ว', async () => {
  const r = load(); // env ว่าง = default เปิด
  seed(r.store);
  const res1 = await r.PUT(jsonReq({ id: 'a1', action: 'archive' }));
  assert.equal(res1.status, 200);
  assert.equal(res1.body.success, true);
  assert.equal(res1.body.prompt.status, 'archived');
  assert.equal(r.store.items.find(i => i.id === 'a1').status, 'archived');

  const res2 = await r.PUT(jsonReq({ id: 'a1', action: 'restore' }));
  assert.equal(res2.body.prompt.status, 'active');
  assert.equal(r.store.items.find(i => i.id === 'a1').status, 'active');

  // ค่าสวิตช์อื่นที่ไม่ใช่ '0' ก็ยังเปิด (สัญญา !== '0')
  const r2 = load({ CARD_LIBRARY_V2: '1' });
  seed(r2.store);
  assert.equal((await r2.PUT(jsonReq({ id: 'c3', action: 'archive' }))).body.prompt.status, 'archived');

  // id ไม่มีจริง → เส้นทาง error เดิม (store โยน → 500)
  const res3 = await r.PUT(jsonReq({ id: 'none', action: 'archive' }));
  assert.equal(res3.status, 500);
  assert.equal(res3.body.success, false);
});

test('PUT whitelist status: รับเฉพาะ active/archived/proposed — ค่าเพี้ยนเมินเงียบ (กัน payload AI พังท่อเดิม) · ส่งคู่ field อื่นได้', async () => {
  const r = load();
  seed(r.store);
  // ค่า valid → ติด
  await r.PUT(jsonReq({ id: 'a1', status: 'proposed' }));
  assert.equal(r.store.items.find(i => i.id === 'a1').status, 'proposed');
  // คู่กับ field whitelist เดิม → ติดทั้งคู่
  await r.PUT(jsonReq({ id: 'a1', status: 'archived', tone: 'อบอุ่น' }));
  const a1 = r.store.items.find(i => i.id === 'a1');
  assert.equal(a1.status, 'archived');
  assert.equal(a1.tone, 'อบอุ่น');
  // ค่าเพี้ยน → เมินเงียบ ไม่ล้ม ไม่เปลี่ยน status เดิม
  for (const bad of ['ปลอม', 'ACTIVE', 'active ', '', 1, null, { x: 1 }]) {
    const res = await r.PUT(jsonReq({ id: 'a1', status: bad, tone: 'คงเดิม' }));
    assert.equal(res.status, 200, `ค่าเพี้ยน ${JSON.stringify(bad)} ต้องไม่ทำให้ล้ม`);
    assert.equal(r.store.items.find(i => i.id === 'a1').status, 'archived', `ค่าเพี้ยน ${JSON.stringify(bad)} ต้องถูกเมิน`);
  }
  // ใบที่ไม่เคยมี status + ส่งค่าเพี้ยน → ยังไม่มี field status
  await r.PUT(jsonReq({ id: 'c3', status: 'garbage' }));
  // c3 มี status proposed เดิมอยู่แล้ว — ใช้ใบใหม่แทน
  r.store.items.push({ id: 'd4', promptName: 'ใบสด', usageCount: 0 });
  await r.PUT(jsonReq({ id: 'd4', status: 'garbage' }));
  assert.ok(!('status' in r.store.items.find(i => i.id === 'd4')), 'ค่าเพี้ยนต้องไม่สร้าง field status');
});

test('ไบต์เดิมเมื่อไม่ส่ง status: PUT แก้ field ปกติ — เปิด/ปิดสวิตช์ตอบเท่ากันทุกไบต์ + สภาพ store เท่ากัน', async () => {
  const body = { id: 'a1', tone: 'ใหม่', viralScore: 88, promptText: 'ข้อความ' };
  const on = load();
  const off = load({ CARD_LIBRARY_V2: '0' });
  seed(on.store); seed(off.store);
  const rOn = await on.PUT(jsonReq(body));
  const rOff = await off.PUT(jsonReq(body));
  assert.equal(rOn.status, 200);
  assert.equal(JSON.stringify(rOn.body), JSON.stringify(rOff.body), 'response ต้องไบต์เดียวกัน');
  assert.equal(JSON.stringify(on.store.items), JSON.stringify(off.store.items), 'store ต้องไบต์เดียวกัน');
  assert.ok(!('status' in on.store.items.find(i => i.id === 'a1')), 'ไม่ส่ง status = ไม่มี field เพิ่ม');
  // action เดิม (use) ยังเดินเหมือนเดิมตอนสวิตช์เปิด
  await on.PUT(jsonReq({ id: 'a1', action: 'use' }));
  assert.equal(on.store.items.find(i => i.id === 'a1').usageCount, 1);
});

test('สวิตช์ปิด (=0): action archive/restore ตกลง else เดิม (ไม่แตะ status) · status ใน body ถูกเมิน · DELETE ตรงแบบเดิม', async () => {
  const r = load({ CARD_LIBRARY_V2: '0' });
  seed(r.store);
  const before = JSON.stringify(r.store.items.find(i => i.id === 'a1'));
  const res = await r.PUT(jsonReq({ id: 'a1', action: 'archive' }));
  assert.equal(res.status, 200, 'พฤติกรรมเดิม: action แปลกหน้า = update เปล่า ไม่ error');
  const after = r.store.items.find(i => i.id === 'a1');
  assert.ok(!('status' in after), 'ปิดสวิตช์ archive ห้ามแตะ status');
  assert.equal(JSON.stringify({ ...after, updatedAt: undefined }), JSON.stringify({ ...JSON.parse(before), updatedAt: undefined }));
  await r.PUT(jsonReq({ id: 'a1', status: 'archived' }));
  assert.ok(!('status' in r.store.items.find(i => i.id === 'a1')), 'ปิดสวิตช์ whitelist status ต้องเมิน');
  // ลบตรงไม่ต้อง confirm (พฤติกรรมเดิมที่ page.js เส้นเก่าเรียก)
  const del = await r.DELETE(delReq('?id=a1'));
  assert.equal(del.status, 200);
  assert.equal(del.body.removed, true);
  assert.ok(!r.store.items.some(i => i.id === 'a1'));
});

test('สวิตช์เปิด DELETE รายใบ: ต้อง confirm=<id> ตรงเป๊ะ + ใบ usageCount > 0 ลบไม่ได้ (409) + ไม่เจอ = 404', async () => {
  const r = load();
  seed(r.store);
  // ไม่มี confirm → 400 + ของยังอยู่
  const d1 = await r.DELETE(delReq('?id=a1'));
  assert.equal(d1.status, 400);
  assert.equal(d1.body.errorType, 'CONFIRM_REQUIRED');
  assert.ok(r.store.items.some(i => i.id === 'a1'), 'ห้ามลบก่อนยืนยัน');
  // confirm ไม่ตรง → 400
  assert.equal((await r.DELETE(delReq('?id=a1&confirm=a2'))).status, 400);
  // ไม่ส่ง id เลย → 400 (กันหลุมเดิม id=null)
  assert.equal((await r.DELETE(delReq(''))).body.errorType, 'CONFIRM_REQUIRED');
  // ใบเคยถูกใช้ (b2 usageCount 3) → 409 + ของยังอยู่
  const d2 = await r.DELETE(delReq('?id=b2&confirm=b2'));
  assert.equal(d2.status, 409);
  assert.equal(d2.body.errorType, 'USAGE_PROTECTED');
  assert.ok(r.store.items.some(i => i.id === 'b2'), 'ใบที่เคสเก่าอ้างถึงห้ามหาย');
  // ไม่เจอ id → 404
  const d3 = await r.DELETE(delReq('?id=zz&confirm=zz'));
  assert.equal(d3.status, 404);
  assert.equal(d3.body.errorType, 'NOT_FOUND');
  // ครบเงื่อนไข (confirm ตรง + usage 0) → ลบได้จริง
  const d4 = await r.DELETE(delReq('?id=c3&confirm=c3'));
  assert.equal(d4.status, 200);
  assert.equal(d4.body.removed, true);
  assert.ok(!r.store.items.some(i => i.id === 'c3'));
});

test('DELETE id=all: ด่าน ADMIN_API_KEY เดิมยังทำงาน — ด่านใหม่ต้องไม่แทรกเส้นทางนี้', async () => {
  // ไม่ตั้ง key → 403 เสมอ (fail-closed เดิม) แม้สวิตช์เปิด
  const r1 = load();
  seed(r1.store);
  const res1 = await r1.DELETE(delReq('?id=all'));
  assert.equal(res1.status, 403);
  assert.equal(res1.body.errorType, 'ADMIN_KEY_REQUIRED');
  assert.equal(r1.store.items.length, 3);
  // มี key ถูก → ล้างได้ (ไม่ติดด่าน confirm ใหม่)
  const r2 = load({ ADMIN_API_KEY: 'K' });
  seed(r2.store);
  const res2 = await r2.DELETE(delReq('?id=all', { 'x-admin-key': 'K' }));
  assert.equal(res2.status, 200);
  assert.equal(res2.body.removedAll, true);
});

test('POST ไม่รับ status (ช่องเข้าใบใหม่จริงคือสคริปต์ F13/migration — ใบจาก POST เป็น active โดยไม่มี field)', async () => {
  for (const env of [{}, { CARD_LIBRARY_V2: '0' }]) {
    const r = load(env);
    const res = await r.POST(jsonReq({ id: 'p9', promptName: 'ใบใหม่', status: 'archived' }));
    assert.equal(res.status, 200);
    assert.ok(!('status' in res.body.prompt), 'POST ต้องไม่หยิบ status จาก body');
    assert.ok(!('status' in r.store.items.find(i => i.id === 'p9')));
  }
});

test('action เดิมยังชนะ action ใหม่ไม่ได้ปน: use/success/feedback เดินเส้นเดิมแม้สวิตช์เปิด', async () => {
  const r = load();
  seed(r.store);
  await r.PUT(jsonReq({ id: 'b2', action: 'success' }));
  assert.equal(r.store.items.find(i => i.id === 'b2').successCount, 1);
  await r.PUT(jsonReq({ id: 'b2', action: 'feedback', feedback: { likes: 5 } }));
  const b2 = r.store.items.find(i => i.id === 'b2');
  assert.equal(b2.engagementHistory.length, 1);
  assert.equal(b2.status, 'archived', 'action เดิมห้ามแตะ status');
});
