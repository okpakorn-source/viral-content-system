// P1-1 INTEGRATION tests — Stage-A end-to-end across REAL modules:
//   libraryTriage.buildTriage → stored rows → readImagesSnapshot (DI fake supabase client, RPC counter)
//   → buildImagesRouteResponse → candidateFactAuthority (real, via dynamic import inside imageStore)
// No mocks of the modules under test — DI only for IO boundaries (supabase client / legacy reader).
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// FS/DI determinism: ปิด Supabase env ก่อน import imageStore
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { buildImagesRouteResponse, readImagesSnapshot, countByPlatform } = await import('../src/lib/imageStore.js');
const { buildTriage } = await import('../src/lib/libraryTriage.js');

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}`); console.error(String((e && e.stack) || e)); }
}

const HEX = '0123456789abcdef';
const clone = (o) => JSON.parse(JSON.stringify(o));

// สร้าง record จริงตามท่อจริง: buildTriage (REAL) → แนบเข้า record → JSON clone (จำลองเก็บ/อ่าน DB)
function makeStoredRow(id, caseId, platform, itFields) {
  const triage = buildTriage(itFields, { im: { id }, brightness: 100, detail: 50, pHash64: HEX });
  return clone({ id, caseId, platform, imageUrl: 'https://x/' + id, triage });
}

function fakeSupabase(rpcImpl) {
  const calls = { rpc: 0 };
  return { calls, rpc: async (name, params) => { calls.rpc++; return rpcImpl(name, params); } };
}
function legacyCounter(images) {
  const c = { n: 0 };
  return { c, fn: async () => { c.n++; return images; } };
}

// ============ 1) libraryTriage persists candidateFacts + literal-verdict only ============
await test('INT-1a: buildTriage PERSISTS candidateFacts in returned triage (survives JSON round-trip)', () => {
  const row = makeStoredRow('C9-1', 'C9', 'web', { relevant: true, clean: true, newsScene: true });
  assert.ok(row.triage.candidateFacts, 'persisted after JSON clone');
  assert.equal(row.triage.candidateFacts.scope, 'candidate_facts_v1');
  assert.equal(row.triage.candidateFacts.version, 1);
  assert.equal(row.triage.candidateFacts.producer, 'LIBRARY_TRIAGE_CANDIDATE_FACTS_V1');
});

await test('INT-1b: relevant verdict accepted ONLY from literal boolean it.relevant (never default-positive)', () => {
  const lit = makeStoredRow('a', 'C9', 'web', { relevant: true }).triage.candidateFacts;
  assert.equal(lit.verdicts.relevant, true);
  const litF = makeStoredRow('b', 'C9', 'web', { relevant: false }).triage.candidateFacts;
  assert.equal(litF.verdicts.relevant, false);
  for (const v of [undefined, 'true', 1, null]) {
    const f = makeStoredRow('c', 'C9', 'web', { relevant: v }).triage.candidateFacts;
    assert.ok(!('relevant' in f.verdicts), 'no verdict for ' + String(v));
  }
  // legacy field เดิมยัง derive แบบเดิม (relevant !== false) — ไม่ถูกกระทบ
  assert.equal(makeStoredRow('d', 'C9', 'web', {}).triage.relevant, true);
});

// ============ 2) default route: exact legacy parity + switch matrix ============
const legacyImages = [
  { id: 'L-1', caseId: 'L', platform: 'web', imageUrl: 'u1' },
  { id: 'L-2', caseId: 'L', platform: 'youtube', imageUrl: 'u2' },
];

await test('INT-2a: default route byte-equal legacy payload, zero snapshot reads, zero authority calls', async () => {
  const legacy = legacyCounter(legacyImages);
  const snap = { n: 0, fn: async () => { snap.n++; return { complete: true }; } };
  const auth = { n: 0, buildCandidateAuthoritySnapshotV1() { auth.n++; return {}; } };
  const res = await buildImagesRouteResponse('L', null, { readImages: legacy.fn, readImagesSnapshot: snap.fn, authority: auth });
  const expected = JSON.stringify({ success: true, caseId: 'L', total: 2, byPlatform: { web: 1, youtube: 1 }, images: legacyImages });
  assert.equal(JSON.stringify(res.body), expected, 'byte-equal legacy payload');
  assert.equal(res.status, 200);
  assert.equal(snap.n, 0);
  assert.equal(auth.n, 0);
  assert.equal(legacy.c.n, 1);
});

await test('INT-2b: switch matrix — ONLY exact "1" activates; all variants stay exact legacy', async () => {
  const variants = ['1 ', ' 1', 'true', 'TRUE', '0', '', '01', '1\n', 'yes', 'on', null, undefined];
  for (const q of variants) {
    const legacy = legacyCounter(legacyImages);
    const snap = { n: 0, fn: async () => { snap.n++; return { complete: true }; } };
    const auth = { n: 0, buildCandidateAuthoritySnapshotV1() { auth.n++; return {}; } };
    const res = await buildImagesRouteResponse('L', q, { readImages: legacy.fn, readImagesSnapshot: snap.fn, authority: auth });
    assert.ok(!('candidateAuthority' in res.body), 'legacy for ' + JSON.stringify(q));
    assert.equal(JSON.stringify(res.body), JSON.stringify({ success: true, caseId: 'L', total: 2, byPlatform: { web: 1, youtube: 1 }, images: legacyImages }), 'exact legacy for ' + JSON.stringify(q));
    assert.equal(snap.n, 0, 'zero snapshot reads for ' + JSON.stringify(q));
    assert.equal(auth.n, 0, 'zero authority calls for ' + JSON.stringify(q));
    assert.equal(legacy.c.n, 1);
  }
  // exact '1' really does activate (sanity leg of the matrix)
  const legacy = legacyCounter(legacyImages);
  const snapObj = { scope: 'case_image_store_snapshot_v1', caseId: 'L', complete: true, truncated: false, count: 0, rows: [] };
  const snap = { n: 0, fn: async () => { snap.n++; return snapObj; } };
  const res = await buildImagesRouteResponse('L', '1', { readImages: legacy.fn, readImagesSnapshot: snap.fn });
  assert.ok('candidateAuthority' in res.body, 'exact 1 activates');
  assert.equal(snap.n, 1);
});

// ============ 3) opt-in SUCCESS: ONE RPC, ZERO legacy reads, same rows drive payload+authority ============
await test('INT-3: full pipe buildTriage→rows→ONE RPC→payload+REAL authority from SAME rows', async () => {
  const rows = [
    makeStoredRow('P-1', 'P', 'web', { relevant: true, clean: true, newsScene: true }),
    makeStoredRow('P-2', 'P', 'ig', { relevant: false, clean: true, newsScene: true }),
    makeStoredRow('P-3', 'P', 'web', { relevant: true, clean: false, newsScene: true }),
  ];
  const sb = fakeSupabase(() => ({ data: { count: 3, rows }, error: null }));
  const legacy = legacyCounter(legacyImages);
  const res = await buildImagesRouteResponse('P', '1', {
    readImages: legacy.fn,
    readImagesSnapshot: (caseId) => readImagesSnapshot(caseId, { client: sb }), // REAL snapshot logic + RPC counter
    // no authority DI — REAL module via dynamic import inside imageStore
  });
  assert.equal(sb.calls.rpc, 1, 'exactly ONE snapshot RPC');
  assert.equal(legacy.c.n, 0, 'ZERO legacy reads');
  // payload มาจาก rows ชุดเดียวกัน
  assert.equal(res.body.total, 3);
  assert.deepEqual(res.body.images, rows);
  assert.deepEqual(res.body.byPlatform, countByPlatform(rows));
  // authority จาก rows ชุดเดียวกัน (real validator)
  const ca = res.body.candidateAuthority;
  assert.equal(ca.available, true);
  assert.equal(ca.universeComplete, true);
  assert.equal(ca.storeProof.observedCount, 3);
  assert.deepEqual(ca.candidates.map((c) => c.imageId), ['P-1', 'P-3']);
  assert.equal(ca.vettedProof.scope, 'case_image_store_full_vetted_v1');
  assert.equal(ca.vettedProof.observedCount, 2);
});

// ============ 4) RPC FAILURE: exactly ONE legacy read fallback, incomplete marker, no proof ============
await test('INT-4: RPC failure → ONE RPC attempt + exactly ONE legacy read + legacy payload + incomplete/no proof', async () => {
  const sb = fakeSupabase(() => ({ data: null, error: { message: 'connection reset' } }));
  const legacy = legacyCounter(legacyImages);
  const res = await buildImagesRouteResponse('L', '1', {
    readImages: legacy.fn,
    readImagesSnapshot: (caseId) => readImagesSnapshot(caseId, { client: sb }),
  });
  assert.equal(sb.calls.rpc, 1);
  assert.equal(legacy.c.n, 1, 'exactly one legacy read, no second');
  // legacy payload intact
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.images, legacyImages);
  assert.deepEqual(res.body.byPlatform, { web: 1, youtube: 1 });
  // incomplete marker — no fabricated authority
  const ca = res.body.candidateAuthority;
  assert.equal(ca.available, false);
  assert.equal(ca.incomplete, true);
  assert.equal(ca.reason, 'SNAPSHOT_READ_FAILED');
  assert.ok(!('vettedProof' in ca), 'no vetted proof on failure');
  assert.ok(!('storeProof' in ca), 'no store proof on failure');
  assert.ok(!('candidates' in ca), 'no candidates on failure');
});

// ============ 5) FS path: always unproven; corruption never complete-empty ============
await test('INT-5a: FS snapshot (no client) through route → FS_UNPROVEN marker + one legacy fallback read', async () => {
  const legacy = legacyCounter(legacyImages);
  const res = await buildImagesRouteResponse('__int_no_case__', '1', {
    readImages: legacy.fn,
    readImagesSnapshot: (caseId) => readImagesSnapshot(caseId), // REAL fs path (env cleared)
  });
  assert.equal(legacy.c.n, 1);
  assert.equal(res.body.candidateAuthority.available, false);
  assert.equal(res.body.candidateAuthority.incomplete, true);
  assert.equal(res.body.candidateAuthority.reason, 'FS_UNPROVEN');
});

await test('INT-5b: FS corruption → complete:false FS_UNPROVEN, never complete-empty', async () => {
  const dir = path.join(process.cwd(), 'data', 'case-images');
  const caseId = '__int_corrupt__';
  const file = path.join(dir, caseId + '.json');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, '<<<not json>>>', 'utf8');
  try {
    const snap = await readImagesSnapshot(caseId);
    assert.equal(snap.complete, false);
    assert.equal(snap.reason, 'FS_UNPROVEN');
    assert.deepEqual(snap.rows, []);
    assert.equal(snap.truncated, false);
  } finally {
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(dir).catch(() => {});
  }
});

// ============ 6) SQL text: pre-bounded aggregate, one statement ============
await test('INT-6: migration bounds <=2000 INSIDE the aggregate statement and stays ONE statement', () => {
  const sql = readFileSync(new URL('../supabase/migrations/004_case_image_snapshot.sql', import.meta.url), 'utf8');
  // one CREATE FUNCTION, LANGUAGE sql
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.ok(/LANGUAGE sql/i.test(sql));
  // body = between $$ ... $$
  const m = sql.match(/\$\$([\s\S]*)\$\$/);
  assert.ok(m, 'dollar-quoted body found');
  const body = m[1];
  // ONE statement in the body (single WITH..SELECT, single terminating semicolon)
  assert.equal((body.match(/;/g) || []).length, 1, 'exactly one statement in body');
  assert.ok(/^\s*WITH\s/i.test(body.replace(/--[^\n]*\n/g, '').trimStart()), 'single WITH..SELECT statement');
  // bounded CTE with LIMIT 2000 declared BEFORE jsonb_agg consumes it
  const boundedIdx = body.search(/bounded AS \(/i);
  const limitIdx = body.search(/LIMIT 2000/i);
  const aggIdx = body.search(/jsonb_agg/i);
  assert.ok(boundedIdx >= 0 && limitIdx >= 0 && aggIdx >= 0, 'bounded/LIMIT/jsonb_agg all present');
  assert.ok(boundedIdx < limitIdx && limitIdx < aggIdx, 'LIMIT 2000 inside bounded CTE precedes jsonb_agg');
  assert.ok(/jsonb_agg\([\s\S]*?FROM bounded/i.test(body), 'jsonb_agg reads FROM bounded (pre-limited)');
  // count(*) over the full matched set (not the bounded one)
  assert.ok(/count\(\*\)[\s\S]{0,40}FROM matched/i.test(body), 'count(*) FROM matched');
});

console.log(`\n# stage-a-integration: ${n} tests, ${failed} failed`);
if (failed) process.exit(1);
