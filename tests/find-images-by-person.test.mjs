// Focused tests — src/lib/imageStore.js findImagesByPerson (ยืมรูปข้ามเคส)
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// ปิด Supabase env ก่อนเรียกใด ๆ — path "ไม่มี client" ต้องแน่นอนว่าเป็น FS fallback
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { findImagesByPerson } = await import('../src/lib/imageStore.js');

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}`); console.error(String((e && e.stack) || e)); }
}

// fake supabase client — chainable .from().select().eq().ilike() แล้ว await ได้ (thenable)
// ไม่กรองที่ query เอง (คืนทุกแถวที่ inject มา) — ปล่อยให้โค้ดจริงใน findImagesByPerson ทำ JS-filter (isEligible) เป็นด่านตัดสินจริง
function fakeClient(rows, { throwOnQuery = false, errorOnQuery = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const builder = {
        select(cols) { calls.push(['select', cols]); return builder; },
        eq(col, val) { calls.push(['eq', col, val]); return builder; },
        ilike(col, pattern) { calls.push(['ilike', col, pattern]); return builder; },
        then(resolve, reject) {
          if (throwOnQuery) { reject(new Error('boom-query')); return; }
          if (errorOnQuery) { resolve({ data: null, error: errorOnQuery }); return; }
          resolve({ data: rows.map((r) => ({ data: r })), error: null });
        },
      };
      return builder;
    },
  };
}

const img = (over = {}) => ({
  id: over.id || 'img-1',
  caseId: over.caseId || 'CASE-A',
  imageUrl: over.imageUrl || 'https://x/img.jpg',
  platform: 'web',
  triage: { person: 'สมชาย ใจดี', clean: true, relevant: true, ...(over.triage || {}) },
  realWidth: over.realWidth,
  realHeight: over.realHeight,
  ...over,
});

await test('match person ถูก (เทียบชื่อ 2 ทาง includes) — คนอื่นไม่ติด', async () => {
  const rows = [
    img({ id: 'a', triage: { person: 'สมชาย ใจดี' } }),
    img({ id: 'b', triage: { person: 'สมหญิง รักดี' } }),
  ];
  const client = fakeClient(rows);
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', client });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a');
});

await test('ตัด clean=false / relevant=false ออก', async () => {
  const rows = [
    img({ id: 'clean-ok' }),
    img({ id: 'dirty', triage: { person: 'สมชาย ใจดี', clean: false, relevant: true } }),
    img({ id: 'irrelevant', triage: { person: 'สมชาย ใจดี', clean: true, relevant: false } }),
  ];
  const client = fakeClient(rows);
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', client });
  const ids = out.map((x) => x.id);
  assert.ok(ids.includes('clean-ok'));
  assert.ok(!ids.includes('dirty'));
  assert.ok(!ids.includes('irrelevant'));
});

await test('ตัด excludeCaseId ออก', async () => {
  const rows = [
    img({ id: 'keep', caseId: 'CASE-B' }),
    img({ id: 'excluded', caseId: 'CASE-CURRENT' }),
  ];
  const client = fakeClient(rows);
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', excludeCaseId: 'CASE-CURRENT', client });
  const ids = out.map((x) => x.id);
  assert.ok(ids.includes('keep'));
  assert.ok(!ids.includes('excluded'));
});

await test('เรียงภาพใหญ่ก่อน (realShortSide/realWidth มากก่อน)', async () => {
  const rows = [
    img({ id: 'small', realWidth: 400, realHeight: 500 }),
    img({ id: 'big', realWidth: 1600, realHeight: 2000 }),
    img({ id: 'mid', realWidth: 800, realHeight: 1000 }),
  ];
  const client = fakeClient(rows);
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', client });
  assert.deepEqual(out.map((x) => x.id), ['big', 'mid', 'small']);
});

await test('minShortSide กรองภาพเล็กออก (วัดได้แล้วเล็กกว่าเกณฑ์)', async () => {
  const rows = [
    img({ id: 'small', realWidth: 300, realHeight: 400 }),
    img({ id: 'big', realWidth: 1600, realHeight: 2000 }),
  ];
  const client = fakeClient(rows);
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', minShortSide: 700, client });
  assert.deepEqual(out.map((x) => x.id), ['big']);
});

await test('limit ตัดจำนวนใบตามที่ขอ', async () => {
  const rows = [1, 2, 3, 4, 5].map((i) => img({ id: `p${i}`, realWidth: 1000 + i, realHeight: 1200 }));
  const client = fakeClient(rows);
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', limit: 2, client });
  assert.equal(out.length, 2);
});

await test('personName ว่าง/สั้นเกินไป → [] (กัน match มั่ว) — ไม่แตะ client เลย', async () => {
  const client = fakeClient([img()]);
  assert.deepEqual(await findImagesByPerson({ personName: '', client }), []);
  assert.deepEqual(await findImagesByPerson({ personName: '   ', client }), []);
  assert.deepEqual(await findImagesByPerson({ personName: 'a', client }), []);
  assert.deepEqual(await findImagesByPerson({ client }), []); // ไม่ส่ง personName เลย
  assert.equal(client.calls.length, 0, 'personName สั้นเกินไปต้องคืนก่อนแตะ client');
});

await test('client query error → คืน [] (ห้าม throw)', async () => {
  const client = fakeClient([], { errorOnQuery: { message: 'db down' } });
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', client });
  assert.deepEqual(out, []);
});

await test('client query throw → คืน [] (ห้าม throw ออกนอกฟังก์ชัน)', async () => {
  const client = fakeClient([], { throwOnQuery: true });
  const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', client });
  assert.deepEqual(out, []);
});

await test('ไม่มี client + ไม่มี Supabase env → fallback อ่านไฟล์ data/case-images/*.json', async () => {
  const dir = path.join(process.cwd(), 'data', 'case-images');
  const caseOther = '__fibp_other_case__';
  const caseCurrent = '__fibp_current_case__';
  await fs.mkdir(dir, { recursive: true });
  const fileOther = path.join(dir, `${caseOther}.json`);
  const fileCurrent = path.join(dir, `${caseCurrent}.json`);
  await fs.writeFile(fileOther, JSON.stringify([
    img({ id: 'fs-match', caseId: caseOther, realWidth: 1200, realHeight: 1500 }),
    img({ id: 'fs-dirty', caseId: caseOther, triage: { person: 'สมชาย ใจดี', clean: false, relevant: true } }),
  ]), 'utf8');
  await fs.writeFile(fileCurrent, JSON.stringify([
    img({ id: 'fs-excluded', caseId: caseCurrent }),
  ]), 'utf8');
  try {
    const out = await findImagesByPerson({ personName: 'สมชาย ใจดี', excludeCaseId: caseCurrent });
    const ids = out.map((x) => x.id);
    assert.ok(ids.includes('fs-match'), 'fallback ต้องเจอ match จากเคสอื่น');
    assert.ok(!ids.includes('fs-dirty'), 'fallback ต้องตัด clean=false');
    assert.ok(!ids.includes('fs-excluded'), 'fallback ต้องตัด excludeCaseId');
  } finally {
    await fs.unlink(fileOther).catch(() => {});
    await fs.unlink(fileCurrent).catch(() => {});
  }
});

await test('ไม่มี client + ไม่มีไฟล์ตรงเลย → []', async () => {
  const out = await findImagesByPerson({ personName: '__ไม่มีตัวตนแน่นอน999__' });
  assert.deepEqual(out, []);
});

await test('token-match: ชื่อสั้น 2 ตัวไม่ over-match ข้ามคำ ("เอ" ไม่ติด "เอกชัย") — parity กับ s6', async () => {
  const rows = [
    img({ id: 'exact', triage: { person: 'เอ สมบูรณ์' } }),      // token "เอ" ตรงเป๊ะ → ติด
    img({ id: 'overmatch', triage: { person: 'เอกชัย สุขใจ' } }), // raw เดิม includes "เอ" → ติดผิด; token (len<3) = ไม่ติด
  ];
  const out = await findImagesByPerson({ personName: 'เอ', client: fakeClient(rows) });
  assert.equal(out.length, 1, 'ต้องได้เฉพาะ token ตรงเป๊ะ ไม่ over-match ชื่อยาวคนละคน');
  assert.equal(out[0].id, 'exact');
});

await test('token-match: ชื่อเต็มยังจับคำได้ ("สมชาย" ติด "สมชาย ใจดี" ไม่ติด "ประสม ชัยดี")', async () => {
  const rows = [
    img({ id: 'hit', triage: { person: 'สมชาย ใจดี' } }),      // token "สมชาย" ตรง
    img({ id: 'miss', triage: { person: 'ประสม ชัยดี' } }),    // ไม่มี token "สมชาย"
  ];
  const out = await findImagesByPerson({ personName: 'สมชาย', client: fakeClient(rows) });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'hit');
});

console.log(`\n# find-images-by-person: ${n} tests, ${failed} failed`);
if (failed) process.exit(1);
