// Focused tests — src/lib/imageStore.js readImagesSnapshot (+ SQL bound / no-globals static scans)
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ปิด Supabase env ก่อนเรียกใด ๆ — FS path เทสต้องแน่นอน (ไม่มี client = fsRead)
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { readImagesSnapshot } = await import('../src/lib/imageStore.js');

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}`); console.error(String((e && e.stack) || e)); }
}

// fake supabase client — นับจำนวน rpc call (dependency injection แทน global counter)
function fakeClient(rpcImpl) {
  const calls = { rpc: 0, args: [] };
  return {
    calls,
    rpc: async (name, params) => { calls.rpc++; calls.args.push({ name, params }); return rpcImpl(name, params); },
  };
}
const rows = (caseId, count) => { const a = []; for (let i = 0; i < count; i++) a.push({ id: `${caseId}-${i}`, caseId, imageUrl: 'u' + i, platform: 'web' }); return a; };

await test('snapshot: >1000-row complete snapshot (single rpc call)', async () => {
  const r = rows('C1', 1500);
  const client = fakeClient(() => ({ data: { count: 1500, rows: r }, error: null }));
  const snap = await readImagesSnapshot('C1', { client });
  assert.equal(snap.scope, 'case_image_store_snapshot_v1');
  assert.equal(snap.complete, true);
  assert.equal(snap.truncated, false);
  assert.equal(snap.count, 1500);
  assert.equal(snap.rows.length, 1500);
  assert.equal(client.calls.rpc, 1);
});

await test('snapshot: performs EXACTLY ONE rpc call, correct name/params, no second read', async () => {
  const r = rows('C1', 1);
  const client = fakeClient(() => ({ data: { count: 1, rows: r }, error: null }));
  await readImagesSnapshot('C1', { client });
  assert.equal(client.calls.rpc, 1);
  assert.equal(client.calls.args[0].name, 'read_case_image_snapshot');
  assert.deepEqual(client.calls.args[0].params, { p_case_id: 'C1' });
});

await test('snapshot: count < rows => COUNT_MISMATCH (not truncated)', async () => {
  const client = fakeClient(() => ({ data: { count: 0, rows: [{ id: 'C1-1', caseId: 'C1' }] }, error: null }));
  const snap = await readImagesSnapshot('C1', { client });
  assert.equal(snap.complete, false);
  assert.equal(snap.truncated, false);
  assert.equal(snap.reason, 'COUNT_MISMATCH');
});

await test('snapshot: count > rows => TRUNCATED', async () => {
  const client = fakeClient(() => ({ data: { count: 9, rows: [{ id: 'C1-1', caseId: 'C1' }] }, error: null }));
  const snap = await readImagesSnapshot('C1', { client });
  assert.equal(snap.complete, false);
  assert.equal(snap.truncated, true);
  assert.equal(snap.reason, 'TRUNCATED');
});

await test('snapshot: >2000 rows => OVERSIZE truncated (defense-in-depth)', async () => {
  const r = rows('C1', 2001);
  const client = fakeClient(() => ({ data: { count: 2001, rows: r }, error: null }));
  const snap = await readImagesSnapshot('C1', { client });
  assert.equal(snap.complete, false);
  assert.equal(snap.truncated, true);
  assert.equal(snap.reason, 'OVERSIZE');
});

await test('snapshot: row caseId mismatch / missing / non-string => CASE_MISMATCH complete:false', async () => {
  for (const bad of [{ id: 'x', caseId: 'OTHER' }, { id: 'x' }, { id: 'x', caseId: 123 }]) {
    const client = fakeClient(() => ({ data: { count: 1, rows: [bad] }, error: null }));
    const snap = await readImagesSnapshot('C1', { client });
    assert.equal(snap.complete, false, JSON.stringify(bad));
    assert.equal(snap.reason, 'CASE_MISMATCH', JSON.stringify(bad));
  }
});

await test('snapshot: null / non-array data => RPC_MALFORMED complete:false', async () => {
  const c1 = fakeClient(() => ({ data: null, error: null }));
  assert.equal((await readImagesSnapshot('C1', { client: c1 })).reason, 'RPC_MALFORMED');
  const c2 = fakeClient(() => ({ data: { count: 2, rows: 'x' }, error: null }));
  assert.equal((await readImagesSnapshot('C1', { client: c2 })).reason, 'RPC_MALFORMED');
});

await test('snapshot: rpc error throws (never silent complete)', async () => {
  const client = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
  await assert.rejects(() => readImagesSnapshot('C1', { client }), /boom/);
});

await test('snapshot: empty complete case (count 0) — legit empty, complete:true', async () => {
  const client = fakeClient(() => ({ data: { count: 0, rows: [] }, error: null }));
  const snap = await readImagesSnapshot('C1', { client });
  assert.equal(snap.complete, true);
  assert.deepEqual(snap.rows, []);
});

await test('snapshot: FS path (no client) => complete:false FS_UNPROVEN, never complete-empty', async () => {
  const snap = await readImagesSnapshot('__nonexistent_case_xyz__');
  assert.equal(snap.complete, false);
  assert.equal(snap.reason, 'FS_UNPROVEN');
  assert.deepEqual(snap.rows, []);
});

await test('snapshot: FS corruption => complete:false, never complete-empty', async () => {
  const dir = path.join(process.cwd(), 'data', 'case-images');
  const caseId = '__snaptest_corrupt__';
  const file = path.join(dir, caseId + '.json');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, '{ not valid json ][', 'utf8');
  try {
    const snap = await readImagesSnapshot(caseId);
    assert.equal(snap.complete, false);
    assert.equal(snap.reason, 'FS_UNPROVEN');
    assert.deepEqual(snap.rows, []);
  } finally {
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(dir).catch(() => {}); // ลบ dir ถ้าว่าง (git ไม่เห็น empty dir); ไม่ว่าง = ข้าม
  }
});

// ---------- static scans ----------
await test('scan: imageStore.js has NO Stage-A side-effect globals (__IMG_SNAPSHOT_CALLS / __IMG_AUTHORITY)', () => {
  const src = readFileSync(new URL('../src/lib/imageStore.js', import.meta.url), 'utf8');
  assert.ok(!/__IMG_SNAPSHOT_CALLS/.test(src), 'no __IMG_SNAPSHOT_CALLS global');
  assert.ok(!/__IMG_AUTHORITY/.test(src), 'no __IMG_AUTHORITY global');
});

await test('scan: SQL bounds rows <=2000 inside/before the aggregate', () => {
  const sql = readFileSync(new URL('../supabase/migrations/004_case_image_snapshot.sql', import.meta.url), 'utf8');
  assert.ok(/bounded AS \([\s\S]*?LIMIT 2000/i.test(sql), 'bounded CTE carries LIMIT 2000');
  assert.ok(/jsonb_agg\([\s\S]*?FROM bounded/i.test(sql), 'jsonb_agg reads from bounded (already limited)');
  assert.ok(/count\(\*\)[\s\S]*?FROM matched/i.test(sql), 'count(*) over full matched set');
});

console.log(`\n# image-store-snapshot: ${n} tests, ${failed} failed`);
if (failed) process.exit(1);
