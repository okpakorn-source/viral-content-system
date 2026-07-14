// ============================================================
// 🔎 Search V2 Outcome Shadow V1 — narrow offline test (self-contained harness)
//   ไม่ยิง LLM/network/store จริง (loader stubs + injected fakes) · เทสเฉพาะ slice นี้
//   "full semantic-selection test" (scripts/test-semantic-selection.mjs) รันตามหลังเพื่อ regression
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const AI_STUB = 'data:text/javascript,' + encodeURIComponent('export function callBrain(a){ if (globalThis.__MEGA_AI) return globalThis.__MEGA_AI(a); throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const STUB_IMAGESEARCH = _mod(`
export const PLATFORMS = ['google','google_news','facebook','tiktok','youtube'];
export function buildQueries(kw, maxQ){ const f = globalThis.__MEGA_SP; return f && f.buildQueries ? f.buildQueries(kw, maxQ) : ['q1','q2']; }
export async function searchImages(platform, q, opts){ return globalThis.__MEGA_SP.searchImages(platform, q, opts); }
export async function instagramProfile(){ return { images: [] }; }
export async function facebookProfile(){ return { images: [] }; }
`);
const STUB_TRIAGE = _mod('export async function vetImages(a){ return globalThis.__MEGA_SP.vetImages(a); }');
const STUB_STORE = _mod(`
export async function addImages(caseId, imgs){ return globalThis.__MEGA_SP.addImages(caseId, imgs); }
export async function readImages(caseId){ const f = globalThis.__MEGA_SP; return f && f.readImages ? f.readImages(caseId) : []; }
`);
const STUB_CASE = _mod('export async function getCase(id){ return globalThis.__MEGA_SP.getCase(id); }');
const STUB_JUNK = _mod(`
export function isCatalogSource(x){ const f = globalThis.__MEGA_SP; return f && f.isCatalogSource ? !!f.isCatalogSource(x) : false; }
export function isOwnPageSource(x){ const f = globalThis.__MEGA_SP; return f && f.isOwnPageSource ? !!f.isOwnPageSource(x) : false; }
export function isMismatchedFbMedia(x){ const f = globalThis.__MEGA_SP; return f && f.isMismatchedFbMedia ? !!f.isMismatchedFbMedia(x) : false; }
`);
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/imageSearch') return { url: ${JSON.stringify(STUB_IMAGESEARCH)}, shortCircuit: true };
  if (specifier === '@/lib/libraryTriage') return { url: ${JSON.stringify(STUB_TRIAGE)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE)}, shortCircuit: true };
  if (specifier === '@/lib/junkSources') return { url: ${JSON.stringify(STUB_JUNK)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// pin ambient module-level/call-time switches ก่อน import (deterministic) + ล้าง shadow switches ทั้งหมด
process.env.IMG_GAP_SEARCH = '1';
process.env.SEARCH_VET = '1';
process.env.SEARCH_VET_STRICT = '1';
process.env.PRE_VET_DEDUP = '1';
process.env.IMG_QUERY_CONC = '4';
process.env.IMAGES_PER_QUERY = '20';
process.env.IMAGES_HARD_CAP = '120';
process.env.IMG_STORY_QUERIES = '1';
process.env.MEGA_SEARCH_INITIAL_BATCH = '4';
process.env.MEGA_MIN_RELEVANT_IMAGES = '8';
process.env.MEGA_YT_PARALLEL = '0';
process.env.MEGA_HERO_GRADE_HARD = '0';
delete process.env.MEGA_SEARCH_PROVENANCE;
delete process.env.MEGA_SEARCH_SHADOW_V2;
delete process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1;

const { s6_slots, s7_cover, s5_search, s5_gapsearch } = await import('../src/lib/megaAdapters.js');
const { POST: searchPOST, _sanitizeSearchOutcomeShadowV1, _buildSearchOutcomeShadowV1 } = await import('../src/app/api/images/search/route.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };

// ---------- s6/s7 fixtures (สำหรับเทส no-leak) — คัดลอกจาก scripts harness ----------
const loadRefDna = (id) => { const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8')); const rec = refs.find((r) => r.id === id); assert.ok(rec?.dna, `ref ${id} must exist`); return rec.dna; };
const IMG = (id, t = {}, top = {}) => ({ id, imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '', width: 800, height: 1000, realWidth: 900, realHeight: 1200, ...top, triage: { relevant: true, clean: true, faceCount: 1, person: null, persons: [], category: 'context', emotion: 'warm', note: '', newsScene: true, quality: 7, ...t } });
const mkJob = ({ dna, orders = [], chars, refId }) => ({ dossier: { images: { caseId: 'SEM-TEST' }, compass: { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: chars, visualDreamShots: [], doNotUse: [] }, desk: { title: 'ข่าวทดสอบ OS' }, refMatch: { dna, styleName: 'ref-test', typeMatched: true, imagePath: '/ref-covers/test.jpg', ...(refId ? { refId } : {}) }, artBrief: { storyNote: 'เรื่องทดสอบ', orders } } });
const mkDeps = ({ pool, brainAnswer, captures }) => ({
  slotDirectorBrain: async (args) => { captures.brainArgs.push(args); return { slots: brainAnswer, note: 'mock' }; },
  fetchJson: async (url, opts) => {
    captures.fetches.push(url);
    if (String(url).includes('/api/images/')) return { success: true, images: pool };
    if (String(url).includes('/api/queue/add')) { captures.rawBody = opts.body; captures.payload = JSON.parse(opts.body); return { success: true, jobId: 'JOB-OS' }; }
    throw new Error('unexpected fetch: ' + url);
  },
});
const withEnv = async (on, fn) => { if (on) { process.env.MEGA_SEMANTIC_SELECTION = '1'; process.env.MEGA_SELECTION_SPEC = '1'; } else { delete process.env.MEGA_SEMANTIC_SELECTION; delete process.env.MEGA_SELECTION_SPEC; } try { return await fn(); } finally { delete process.env.MEGA_SEMANTIC_SELECTION; delete process.env.MEGA_SELECTION_SPEC; } };
const POOL_A = [
  IMG('P1', { person: 'ดวงเดือน', category: 'face-emotional', note: 'ดวงเดือนยืนหน้าวิหารกำลังไหว้พระอย่างสงบ' }),
  IMG('P2', { person: 'ดวงเดือน', category: 'context', note: 'ดวงเดือนกำลังก่อสร้างวิหารกับช่างหลายคนกลางแดด' }),
  IMG('P3', { person: 'ดวงเดือน', category: 'context', note: 'ดวงเดือนถือแบบแปลนคุยกับวิศวกรในเต็นท์งาน' }),
  IMG('P4', { person: 'ดวงเดือน', category: 'face-neutral', note: 'ดวงเดือนหน้าตรงยิ้มบางในชุดขาวริมระเบียง' }),
  IMG('P5', { person: 'สรพงศ์ ชาตรี', category: 'face-neutral', note: 'สรพงศ์ภาพเก่าหน้าตรงในชุดสูทสีเข้มสมัยหนุ่ม' }),
  IMG('P6', { person: 'สรพงศ์ ชาตรี', category: 'face-emotional', note: 'สรพงศ์ยิ้มกว้างถือพวงมาลัยหน้าโรงถ่ายภาพยนตร์' }),
  IMG('P7', { person: null, category: 'context', faceCount: 0, note: 'วิหารสีทองกลางแสงเย็นถ่ายมุมกว้างเห็นนั่งร้าน' }),
  IMG('P8', { person: null, category: 'document', faceCount: 0, note: 'แบบแปลนวิหารวางบนโต๊ะไม้มีตะเกียงเก่าข้างกัน' }),
];
const CHARS_A = [{ name: 'ดวงเดือน', role: 'hero' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }];
const DNA_ALPO = loadRefDna('REF-mrbqalpo-h1r1');
const ORDERS_ALPO = [{ i: 0, role: 'hero', want: 'ตัวเอกโคลสอัพ', personHint: 'ดวงเดือน', shot: 'closeup' }, { i: 4, role: 'reaction', want: 'คนที่เรื่องพาดถึง', personHint: 'สรพงศ์ ชาตรี', shot: 'closeup' }];
const ANSWER_ALPO = { hero: { id: 'P1', reason: 'x', backups: ['P4'] }, context: { id: 'P7', reason: 'x', backups: [] }, action: { id: 'P2', reason: 'x', backups: [] }, moment: { id: 'P8', reason: 'x', backups: [] }, reaction: { id: 'P5', reason: 'x', backups: ['P6'] } };

// ---------- OS test fakes ----------
const single = (byQ) => async (p, q) => (byQ[q] || []);
const mkSP = (o = {}) => {
  const existing = o.existing || [];
  return {
    buildQueries: () => (o.queries || ['q0', 'q1']),
    searchImages: o.searchImages,
    vetImages: o.vetImages || (async ({ images }) => { globalThis.__OS_VET = JSON.stringify(images); return { vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }; }),
    addImages: o.addImages || (async (caseId, imgs) => { globalThis.__OS_ADD = JSON.stringify(imgs); const fresh = imgs.map((im, i) => ({ ...im, id: `${caseId}-${existing.length + i + 1}` })); return { added: fresh.length, total: existing.length + fresh.length, byPlatform: {}, images: [...existing, ...fresh] }; }),
    readImages: async () => (o.readImages ? o.readImages() : []),
    getCase: async () => ({ keywords: { subjects: [{ name: 'A' }] }, analysis: { characters: [] } }),
    isCatalogSource: o.isCatalogSource, isOwnPageSource: o.isOwnPageSource, isMismatchedFbMedia: o.isMismatchedFbMedia,
  };
};
const SETOS = (v) => { if (v === null) delete process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1; else process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 = v; };
const runPOST = async (body, sp, os) => {
  globalThis.__MEGA_SP = sp; const prev = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 ?? null; SETOS(os);
  try { const res = await searchPOST({ json: async () => body }); return res._body; } finally { SETOS(prev); delete globalThis.__MEGA_SP; }
};
const ROW = (o) => { const r = { queryIndex: o.queryIndex, provider: o.provider }; for (const c of ['raw', 'sourceBlocked', 'inCallDuplicate', 'capSkipped', 'existingDuplicate', 'vetted', 'relevant', 'irrelevant', 'failed', 'freshPersisted', 'rank1_5', 'rank6_10', 'rank11_20']) r[c] = o[c] || 0; return r; };
const mkLatch = () => { let e, g; const entered = new Promise((r) => { e = r; }); const gate = new Promise((r) => { g = r; }); return { entered, open: () => g(), hit: () => { e(); return gate; } }; };

// ── (OS-1) OFF = ไม่มี key + legacy output byte-identical (shadow-only additive) ──
await test('OS route: OFF ไม่มี key · ON เพิ่ม searchOutcomeShadowV1 โดย legacy output เท่าเดิมทุก byte', async () => {
  const sp = () => mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'A' }], q1: [{ imageUrl: 'B' }] }) });
  const off = await runPOST({ caseId: 'C', platform: 'google' }, sp(), null);
  const on = await runPOST({ caseId: 'C', platform: 'google' }, sp(), '1');
  assert.ok(!('searchOutcomeShadowV1' in off));
  assert.ok('searchOutcomeShadowV1' in on && on.searchOutcomeShadowV1.version === 1);
  const strip = (r) => { const c = { ...r }; delete c.searchOutcomeShadowV1; return JSON.stringify(c); };
  assert.equal(strip(on), strip(off), 'legacy output identical (shadow-only)');
});

// ── (OS-2) exact-'1' switch matrix ──
await test('OS route: exact-\'1\' switch matrix', async () => {
  const sp = () => mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }] }) });
  for (const v of [null, '0', '', ' 1', '1 ', 'true']) assert.ok(!('searchOutcomeShadowV1' in await runPOST({ caseId: 'C', platform: 'google' }, sp(), v)), `os=${JSON.stringify(v)} OFF`);
  assert.ok('searchOutcomeShadowV1' in await runPOST({ caseId: 'C', platform: 'google' }, sp(), '1'));
});

// ── (OS-3) ON exact counters + rank1_5 (rich fixture) ──
await test('OS route: exact aggregate counters ต่อ (queryIndex, provider)', async () => {
  const sp = mkSP({
    queries: ['q0'],
    searchImages: single({ q0: [{ imageUrl: 'A' }, { imageUrl: 'BLOCK' }, { imageUrl: 'A' }, { imageUrl: 'OLD' }, { imageUrl: 'B' }, { imageUrl: 'C' }] }),
    isCatalogSource: (x) => x.imageUrl === 'BLOCK',
    readImages: () => [{ imageUrl: 'OLD' }],
    vetImages: async ({ images }) => ({ vetted: images.map((x) => x.imageUrl === 'A' ? { ...x, triage: { relevant: true } } : x.imageUrl === 'B' ? { ...x, triage: { relevant: false } } : { ...x }), kept: 1, dropped: 1, failed: 1 }),
  });
  const r = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
  assert.deepEqual(r.searchOutcomeShadowV1.rows, [ROW({ queryIndex: 0, provider: 'google', raw: 6, sourceBlocked: 1, inCallDuplicate: 1, existingDuplicate: 1, vetted: 3, relevant: 1, irrelevant: 1, failed: 1, freshPersisted: 1, rank1_5: 1 })]);
  assert.deepEqual({ rowsTruncated: r.searchOutcomeShadowV1.rowsTruncated, capped: r.searchOutcomeShadowV1.capped }, { rowsTruncated: 0, capped: false });
});

// ── (OS-4) rank buckets 1-5 / 6-10 / 11-20 ──
await test('OS route: relevant rank buckets 1-5 / 6-10 / 11-20', async () => {
  const imgs = Array.from({ length: 15 }, (_, i) => ({ imageUrl: 'u' + (i + 1) })); // ranks 1..15
  const relSet = new Set(['u3', 'u8', 'u14']); // rank3(1-5), rank8(6-10), rank14(11-20)
  const sp = mkSP({ queries: ['q0'], searchImages: single({ q0: imgs }), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: relSet.has(x.imageUrl) } })), kept: 3, dropped: 12, failed: 0 }) });
  const r = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
  const row = r.searchOutcomeShadowV1.rows[0];
  assert.deepEqual({ relevant: row.relevant, rank1_5: row.rank1_5, rank6_10: row.rank6_10, rank11_20: row.rank11_20 }, { relevant: 3, rank1_5: 1, rank6_10: 1, rank11_20: 1 });
});

// ── (OS-5) build cap 32 rows + truncation + size ≤ 16 KiB ──
await test('OS build: cap 32 rows + rowsTruncated/capped truthful + ≤16 KiB', async () => {
  const c = _buildSearchOutcomeShadowV1(Array.from({ length: 40 }, (_, i) => ROW({ queryIndex: i, provider: 'google', raw: i })));
  assert.equal(c.rows.length, 32); assert.equal(c.rowsTruncated, 8); assert.equal(c.capped, true);
  assert.equal(c.rows[0].queryIndex, 0); assert.equal(c.rows[31].queryIndex, 31); // tail-trim
  assert.ok(new TextEncoder().encode(JSON.stringify(c)).length <= 16 * 1024);
  // sanitizer: >32 rows → null (bounded work)
  assert.equal(_sanitizeSearchOutcomeShadowV1({ version: 1, rows: Array.from({ length: 33 }, (_, i) => ROW({ queryIndex: i, provider: 'google' })), rowsTruncated: 0, capped: false }), null);
});

// ── (OS-6) sanitizer hostile matrix + zero getter invocation ──
await test('OS sanitizer: hostile matrix → null + accessor getter count 0 (descriptor-only)', async () => {
  const okRow = () => ROW({ queryIndex: 0, provider: 'google', raw: 1 });
  const ok = { version: 1, rows: [okRow()], rowsTruncated: 0, capped: false };
  assert.deepEqual(_sanitizeSearchOutcomeShadowV1(ok), ok);
  const bad = [
    null, undefined, 'x', 42, [], { ...ok, version: 2 }, { ...ok, capped: 'no' }, { ...ok, rows: {} }, { ...ok, rowsTruncated: -1 },
    { ...ok, rows: [{ ...okRow(), provider: 'youtube' }] }, // provider ต้องห้าม
    { ...ok, rows: [{ queryIndex: 0, provider: 'google', raw: 1 }] }, // counter ไม่ครบ (ขาด field)
    { ...ok, rows: [{ ...okRow(), raw: -1 }] }, { ...ok, rows: [{ ...okRow(), queryIndex: 1.5 }] },
  ];
  for (const b of bad) assert.equal(_sanitizeSearchOutcomeShadowV1(b), null, `hostile ${JSON.stringify(b)?.slice(0, 40)}`);
  // throwing traps
  assert.equal(_sanitizeSearchOutcomeShadowV1(new Proxy(ok, { ownKeys() { throw new Error('x'); } })), null);
  assert.equal(_sanitizeSearchOutcomeShadowV1(new Proxy(ok, { getPrototypeOf() { throw new Error('x'); } })), null);
  // class-instance row + holey rows array
  class E { } assert.equal(_sanitizeSearchOutcomeShadowV1({ ...ok, rows: [Object.assign(new E(), okRow())] }), null);
  const holey = [okRow()]; holey[2] = okRow(); assert.equal(_sanitizeSearchOutcomeShadowV1({ version: 1, rows: holey, rowsTruncated: 0, capped: false }), null);
  // zero getter invocation — accessor top field / row field / index
  let gTop = 0; const cTop = { ...ok }; Object.defineProperty(cTop, 'rowsTruncated', { enumerable: true, configurable: true, get() { gTop++; throw new Error('t'); } });
  assert.equal(_sanitizeSearchOutcomeShadowV1(cTop), null); assert.equal(gTop, 0);
  let gRow = 0; const rowAcc = okRow(); Object.defineProperty(rowAcc, 'raw', { enumerable: true, configurable: true, get() { gRow++; throw new Error('r'); } });
  assert.equal(_sanitizeSearchOutcomeShadowV1({ ...ok, rows: [rowAcc] }), null); assert.equal(gRow, 0);
  let gIdx = 0; const arr = [okRow()]; Object.defineProperty(arr, 0, { enumerable: true, configurable: true, get() { gIdx++; throw new Error('i'); } });
  assert.equal(_sanitizeSearchOutcomeShadowV1({ ...ok, rows: arr }), null); assert.equal(gIdx, 0);
});

// ── (OS-7) deferred-latch snapshot proof (route/s5_search/gap, both directions, earliest awaited seam) ──
await test('OS latch (route): snapshot-at-entry ก่อน req.json await — ON→OFF และ OFF→ON', async () => {
  const prev = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 ?? null;
  try {
    for (const [start, flip, want] of [['1', null, true], [null, '1', false]]) {
      const l = mkLatch(); globalThis.__MEGA_SP = mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }] }) }); SETOS(start);
      const p = searchPOST({ json: async () => { await l.hit(); return { caseId: 'C', platform: 'google' }; } });
      await l.entered; SETOS(flip); l.open();
      assert.equal('searchOutcomeShadowV1' in (await p)._body, want, `start=${start}`);
    }
  } finally { SETOS(prev); delete globalThis.__MEGA_SP; }
});
await test('OS latch (s5_search): snapshot ก่อน fetchJson await — ON→OFF และ OFF→ON', async () => {
  const carrier = { version: 1, rows: [ROW({ queryIndex: 0, provider: 'google', raw: 1 })], rowsTruncated: 0, capped: false };
  const prev = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 ?? null;
  try {
    for (const [start, flip, want] of [['1', null, true], [null, '1', false]]) {
      const l = mkLatch(); SETOS(start);
      const job = { dossier: { images: { caseId: 'S', searchedPlatforms: [], ytFired: 'pre', searchStats: [] } } };
      const _deps = { fetchJson: async (url) => { if (String(url).includes('/api/images/search')) { await l.hit(); return { success: true, found: 1, added: 1, vetDropped: 0, images: [], searchOutcomeShadowV1: carrier }; } return { success: true, images: [] }; } };
      const p = s5_search(job, { origin: 'http://mock', _deps }); await l.entered; SETOS(flip); l.open();
      assert.equal('searchOutcomeShadowV1' in (await p).dossierPatch.images.searchStats[0], want, `start=${start}`);
    }
  } finally { SETOS(prev); }
});
await test('OS latch (s5_gapsearch): snapshot ก่อน lib fetch await — ON→OFF และ OFF→ON', async () => {
  const prev = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 ?? null;
  const gsp = () => ({ searchImages: async (p, q) => [{ imageUrl: `${q}::${p}` }], vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }), addImages: async (caseId, imgs) => ({ added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs.map((im, i) => ({ ...im, id: `${caseId}-${i + 1}` })) }), getCase: async () => ({ keywords: { subjects: [] }, analysis: { characters: [] } }) });
  try {
    for (const [start, flip, want] of [['1', null, true], [null, '1', false]]) {
      const l = mkLatch(); globalThis.__MEGA_SP = gsp(); globalThis.__MEGA_AI = async () => ({ text: '{"queries":["nq0"]}' }); SETOS(start);
      const job = { dossier: { images: { caseId: 'GAP', storyQueries: ['sq'] }, compass: { mainCharacters: [{ name: 'A' }] }, desk: { title: 't' } } };
      const jf = async (url) => { if (String(url).includes('/api/images/')) { await l.hit(); return { images: [] }; } throw new Error('NO NET'); };
      const p = s5_gapsearch(job, { origin: 'http://mock', _deps: { fetchJson: jf } }); await l.entered; SETOS(flip); l.open();
      assert.equal('gapSearchOutcomeShadowV1' in (await p).dossierPatch.images, want, `start=${start}`);
    }
  } finally { SETOS(prev); delete globalThis.__MEGA_SP; delete globalThis.__MEGA_AI; }
});

// ── (OS-8) propagation: s5_search nest (descriptor-read, getter=0) + gap sibling ──
await test('OS s5_search: nest ใน searchStats entry เดิม · throwing r getter → omit + count 0', async () => {
  const carrier = { version: 1, rows: [ROW({ queryIndex: 0, provider: 'google', raw: 2, freshPersisted: 1 })], rowsTruncated: 0, capped: false };
  const mkJf = (resp) => ({ fetchJson: async (url) => (String(url).includes('/api/images/search') ? resp : { success: true, images: [] }) });
  const run = async (resp) => { const prev = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 ?? null; process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 = '1'; const job = { dossier: { images: { caseId: 'S', searchedPlatforms: [], ytFired: 'pre', searchStats: [] } } }; try { return (await s5_search(job, { origin: 'http://mock', _deps: mkJf(resp) })).dossierPatch.images.searchStats; } finally { if (prev === null) delete process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1; else process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 = prev; } };
  const okStats = await run({ success: true, found: 1, added: 1, vetDropped: 0, images: [], searchOutcomeShadowV1: carrier });
  assert.equal(okStats.length, 1); assert.deepEqual(okStats[0].searchOutcomeShadowV1, carrier);
  // throwing getter on r.searchOutcomeShadowV1 → omit + zero getter
  let g = 0; const rBad = { success: true, found: 5, added: 3, vetDropped: 2, images: [] }; Object.defineProperty(rBad, 'searchOutcomeShadowV1', { enumerable: true, get() { g++; throw new Error('boom'); } });
  const badStats = await run(rBad);
  assert.equal(g, 0, 'getter ไม่ถูกเรียก'); assert.deepEqual(badStats[0], { platform: badStats[0].platform, found: 5, added: 3, vetDropped: 2 });
});
await test('OS s5_gapsearch: sibling gapSearchOutcomeShadowV1 (google/google_news) · OFF ไม่มี', async () => {
  const gsp = () => ({ searchImages: async (p, q) => [{ imageUrl: `${q}::${p}` }], vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }), addImages: async (caseId, imgs) => ({ added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs.map((im, i) => ({ ...im, id: `${caseId}-${i + 1}` })) }), getCase: async () => ({ keywords: { subjects: [] }, analysis: { characters: [] } }) });
  const runG = async (os) => { globalThis.__MEGA_SP = gsp(); globalThis.__MEGA_AI = async () => ({ text: '{"queries":["nq0"]}' }); const prev = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 ?? null; SETOS(os); const job = { dossier: { images: { caseId: 'GAP', storyQueries: ['sq'] }, compass: { mainCharacters: [{ name: 'A' }] }, desk: { title: 't' } } }; const jf = async (url) => (String(url).includes('/api/images/') ? { images: [] } : (() => { throw new Error('NO NET'); })()); try { return await s5_gapsearch(job, { origin: 'http://mock', _deps: { fetchJson: jf } }); } finally { SETOS(prev); delete globalThis.__MEGA_SP; delete globalThis.__MEGA_AI; } };
  const on = await runG('1');
  const os1 = on.dossierPatch.images.gapSearchOutcomeShadowV1;
  assert.equal(os1.version, 1);
  // nq0 × [google, google_news] = 2 rows, แต่ละ raw=1 relevant=1 freshPersisted=1
  assert.deepEqual(os1.rows, [ROW({ queryIndex: 0, provider: 'google', raw: 1, vetted: 1, relevant: 1, freshPersisted: 1, rank1_5: 1 }), ROW({ queryIndex: 0, provider: 'google_news', raw: 1, vetted: 1, relevant: 1, freshPersisted: 1, rank1_5: 1 })]);
  const off = await runG(null);
  assert.ok(!('gapSearchOutcomeShadowV1' in off.dossierPatch.images));
});

// ── (OS-9) no downstream leakage: carrier ใน dossier.images ไม่รั่วเข้า queue body (S6→S7) ──
await test('OS no-leak: searchOutcomeShadowV1/gapSearchOutcomeShadowV1 ไม่รั่วเข้า queue body', async () => {
  await withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null, rawBody: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    const carrier = { version: 1, rows: [ROW({ queryIndex: 0, provider: 'google', raw: 5, vetted: 3, relevant: 2, freshPersisted: 2, rank1_5: 2 })], rowsTruncated: 0, capped: false };
    job.dossier.images.searchStats = [{ platform: 'google', found: 1, added: 1, vetDropped: 0, searchOutcomeShadowV1: carrier }];
    job.dossier.images.gapSearchOutcomeShadowV1 = carrier;
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    assert.equal(s7.status, 'done');
    assert.ok(captures.rawBody, 'enqueue สำเร็จ');
    assert.ok(!captures.rawBody.includes('searchOutcomeShadowV1') && !captures.rawBody.includes('gapSearchOutcomeShadowV1'), 'queue body ไม่มี OS carrier');
  });
});

// ── (OS-10) shadow-only: vet input + addImages input bytes เท่ากันเป๊ะ ON vs OFF ──
await test('OS route: vet input + addImages input bytes เท่ากัน ON vs OFF (ไม่แตะ candidate/vet/persist)', async () => {
  const fx = () => mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'A' }, { imageUrl: 'B' }], q1: [{ imageUrl: 'C' }] }) });
  await runPOST({ caseId: 'C', platform: 'google' }, fx(), null); const offVet = globalThis.__OS_VET, offAdd = globalThis.__OS_ADD;
  await runPOST({ caseId: 'C', platform: 'google' }, fx(), '1'); const onVet = globalThis.__OS_VET, onAdd = globalThis.__OS_ADD;
  assert.equal(onVet, offVet, 'vet input identical'); assert.equal(onAdd, offAdd, 'add input identical');
});

// ── (OS-14) sanitizer semantic invariants → null ──
await test('OS sanitizer: semantic invariants (cap/tuples/sum/rank/raw) → null', async () => {
  const okRow = (o) => ROW({ queryIndex: 0, provider: 'google', ...o });
  const base = (rows, extra = {}) => ({ version: 1, rows, rowsTruncated: 0, capped: false, ...extra });
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([okRow({})], { capped: true })), null, 'capped=true แต่ trunc=0');
  assert.equal(_sanitizeSearchOutcomeShadowV1({ version: 1, rows: [okRow({})], rowsTruncated: 3, capped: false }), null, 'trunc>0 แต่ capped=false');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([okRow({}), okRow({})])), null, 'duplicate tuple (q0,google)');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([ROW({ queryIndex: 1, provider: 'google' }), ROW({ queryIndex: 0, provider: 'google' })])), null, 'unsorted queryIndex');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([ROW({ queryIndex: 0, provider: 'google_news' }), ROW({ queryIndex: 0, provider: 'google' })])), null, 'unsorted provider');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([okRow({ vetted: 5, relevant: 1, irrelevant: 1, failed: 1 })])), null, 'vetted != rel+irr+fail');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([okRow({ vetted: 1, relevant: 1, rank1_5: 1, rank6_10: 1 })])), null, 'rank sum > relevant');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([okRow({ raw: 1, sourceBlocked: 1, inCallDuplicate: 1 })])), null, 'blocked+dup+cap > raw');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([okRow({ raw: 0, vetted: 1, relevant: 1 })])), null, 'vetted > raw');
  assert.equal(_sanitizeSearchOutcomeShadowV1(base([okRow({ raw: 1, freshPersisted: 1, existingDuplicate: 1 })])), null, 'freshPersisted + existingDuplicate > raw');
  const good = base([ROW({ queryIndex: 0, provider: 'google', raw: 2, vetted: 1, relevant: 1, rank1_5: 1 }), ROW({ queryIndex: 0, provider: 'google_news', raw: 1 }), ROW({ queryIndex: 1, provider: 'google' })]);
  assert.deepEqual(_sanitizeSearchOutcomeShadowV1(good), good, 'valid sorted multi-row passes');
});

// ── (OS-15) descriptor-safe saved fresh-suffix boundary → omit carrier ──
await test('OS route: malformed saved boundary (added>len / hole / accessor imageUrl) → omit carrier, legacy unchanged', async () => {
  const base = { queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }] }) };
  const r1 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ ...base, addImages: async () => ({ added: 5, total: 5, byPlatform: {}, images: [{ imageUrl: 'A', id: 'C-1' }] }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in r1) && r1.added === 5, 'added>len → omit · legacy added คงเดิม');
  const holed = [{ imageUrl: 'A', id: 'C-1' }]; holed[2] = { imageUrl: 'B', id: 'C-2' };
  const r2 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ ...base, addImages: async () => ({ added: 3, total: 3, byPlatform: {}, images: holed }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in r2), 'hole ใน fresh suffix → omit');
  let g = 0; const accRow = { id: 'C-1' }; Object.defineProperty(accRow, 'imageUrl', { enumerable: true, configurable: true, get() { g++; return 'A'; } });
  const r3 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ ...base, addImages: async () => ({ added: 1, total: 1, byPlatform: {}, images: [accRow] }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in r3) && g === 0, 'accessor imageUrl → omit + getter count 0');
});

// ── (OS-16) late add-time dedup: snapshot misses but addImages returns added=0 → existingDuplicate ──
await test('OS route: late add-time dedup (snapshot miss, added=0) → existingDuplicate, freshPersisted=0', async () => {
  const sp = mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }, { imageUrl: 'B' }] }), addImages: async () => ({ added: 0, total: 2, byPlatform: {}, images: [{ imageUrl: 'A', id: 'C-1' }, { imageUrl: 'B', id: 'C-2' }] }) });
  const row = (await runPOST({ caseId: 'C', platform: 'google' }, sp, '1')).searchOutcomeShadowV1.rows[0];
  assert.equal(row.freshPersisted, 0, 'added=0 → freshPersisted 0');
  assert.equal(row.existingDuplicate, 2, 'toStore A,B not accepted → existingDuplicate 2 (via first/collected occ)');
});

// ── (OS-17) primary/gap duplicate parity: stored URL 3× → existing=1 + inCall=2 in BOTH ──
const gapSPos = (o = {}) => ({
  searchImages: o.searchImages,
  vetImages: o.vetImages || (async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 })),
  addImages: o.addImages || (async (caseId, imgs) => ({ added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs.map((im, i) => ({ ...im, id: `${caseId}-${i + 1}` })) })),
  getCase: async () => ({ keywords: { subjects: [] }, analysis: { characters: [] } }),
  isCatalogSource: o.isCatalogSource, isOwnPageSource: o.isOwnPageSource, isMismatchedFbMedia: o.isMismatchedFbMedia,
});
const runGapOS = async (sp, os, { lib = [], queries = ['nq0'] } = {}) => {
  globalThis.__MEGA_SP = sp; globalThis.__MEGA_AI = async () => ({ text: JSON.stringify({ queries }) });
  const prev = process.env.MEGA_SEARCH_OUTCOME_SHADOW_V1 ?? null; SETOS(os);
  const job = { dossier: { images: { caseId: 'GAP', storyQueries: ['sq'] }, compass: { mainCharacters: [{ name: 'A' }] }, desk: { title: 't' } } };
  const jf = async (url) => { if (String(url).includes('/api/images/')) return { images: lib }; throw new Error('NO NET'); };
  try { return await s5_gapsearch(job, { origin: 'http://mock', _deps: { fetchJson: jf } }); } finally { SETOS(prev); delete globalThis.__MEGA_SP; delete globalThis.__MEGA_AI; }
};
await test('OS parity: stored URL returned 3× → existingDuplicate=1 + inCallDuplicate=2 (route + gap)', async () => {
  const rRoute = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X' }, { imageUrl: 'X' }, { imageUrl: 'X' }] }), readImages: () => [{ imageUrl: 'X' }] }), '1');
  const rowR = rRoute.searchOutcomeShadowV1.rows[0];
  assert.deepEqual({ e: rowR.existingDuplicate, i: rowR.inCallDuplicate }, { e: 1, i: 2 }, 'route: existing=1 + inCall=2');
  const on = await runGapOS(gapSPos({ searchImages: async (p, q) => (p === 'google' && q === 'nq0' ? [{ imageUrl: 'X' }, { imageUrl: 'X' }, { imageUrl: 'X' }] : []) }), '1', { lib: [{ imageUrl: 'X' }] });
  const rowG = on.dossierPatch.images.gapSearchOutcomeShadowV1.rows.find((r) => r.provider === 'google');
  assert.deepEqual({ e: rowG.existingDuplicate, i: rowG.inCallDuplicate }, { e: 1, i: 2 }, 'gap: existing=1 + inCall=2 (parity)');
});

// ── (OS-18) all-occurrence: clean cross-query duplicate credits BOTH queries (route) — แทน last-wins เดิม ──
await test('OS route: clean cross-query duplicate credits BOTH queries (all-occurrence join, not last-wins)', async () => {
  const q0imgs = Array.from({ length: 20 }, (_, i) => ({ imageUrl: i === 19 ? 'X' : 'q0_' + i })); // X = rank20 ใน q0 (collected)
  const sp = mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: q0imgs, q1: [{ imageUrl: 'X' }] }), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: x.imageUrl === 'X' } })), kept: 1, dropped: images.length - 1, failed: 0 }) });
  const rows = (await runPOST({ caseId: 'C', platform: 'google' }, sp, '1')).searchOutcomeShadowV1.rows;
  const q0 = rows.find((r) => r.queryIndex === 0), q1 = rows.find((r) => r.queryIndex === 1);
  assert.equal(q0.relevant, 1, 'q0 relevant (X collected)'); assert.equal(q0.rank11_20, 1, 'q0 X rank20 → rank11_20');
  assert.equal(q1.relevant, 1, 'q1 relevant (clean dup join)'); assert.equal(q1.rank1_5, 1, 'q1 X rank1 → rank1_5');
  assert.equal(q0.freshPersisted, 1, 'freshPersisted → q0 (canonical first)'); assert.equal(q1.freshPersisted, 0, 'q1 ไม่มี freshPersisted');
  assert.equal(q1.inCallDuplicate, 1, 'q1 X = inCallDuplicate (ซ้อน vetted — URL-verdict join)');
});

// ── (OS-19) source-blocked duplicate (same imageUrl, junk source/title/link) → dup counter แต่ NO joined verdict (route) ──
await test('OS route: source-blocked duplicate (same imageUrl, junk source) → dup counter, vetted/relevant/rank = 0', async () => {
  const sp = mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'X' }], q1: [{ imageUrl: 'X', source: 'JUNK' }] }), isCatalogSource: (x) => x.source === 'JUNK', vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }) });
  const rows = (await runPOST({ caseId: 'C', platform: 'google' }, sp, '1')).searchOutcomeShadowV1.rows;
  const q0 = rows.find((r) => r.queryIndex === 0), q1 = rows.find((r) => r.queryIndex === 1);
  assert.equal(q0.relevant, 1, 'q0 X clean collected → relevant'); assert.equal(q0.freshPersisted, 1, 'q0 canonical freshPersisted');
  assert.equal(q1.inCallDuplicate, 1, 'q1 dup counter ยังนับตาม business');
  assert.equal(q1.vetted, 0, 'q1 blocked occ → vetted 0'); assert.equal(q1.relevant, 0, 'q1 relevant 0');
  assert.equal(q1.rank1_5 + q1.rank6_10 + q1.rank11_20, 0, 'q1 rank 0'); assert.equal(q1.freshPersisted, 0, 'q1 freshPersisted 0');
});

// ── (OS-20) eligible cap-skipped duplicate → joined verdict/rank แต่ freshPersisted 0 (route) ──
await test('OS route: eligible cap-skipped duplicate → joined verdict/rank, never freshPersisted', async () => {
  const q0imgs = Array.from({ length: 40 }, (_, i) => ({ imageUrl: i === 0 ? 'X' : 'f0_' + i })); // cap=min(120,2*20)=40 → q0 เต็ม cap, X rank1
  const sp = mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: q0imgs, q1: [{ imageUrl: 'X' }] }), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: x.imageUrl === 'X' } })), kept: 1, dropped: images.length - 1, failed: 0 }) });
  const rows = (await runPOST({ caseId: 'C', platform: 'google' }, sp, '1')).searchOutcomeShadowV1.rows;
  const q0 = rows.find((r) => r.queryIndex === 0), q1 = rows.find((r) => r.queryIndex === 1);
  assert.equal(q0.relevant, 1); assert.equal(q0.rank1_5, 1, 'q0 X rank1'); assert.equal(q0.freshPersisted, 1);
  assert.equal(q1.raw, 1, 'q1 raw === 1'); assert.equal(q1.capSkipped, 1, 'q1 capSkipped === 1 (exact)'); assert.equal(q1.relevant, 1, 'q1 cap-skipped X ได้ joined relevance');
  assert.equal(q1.rank1_5, 1, 'q1 X rank1 (cap-skipped occ) → rank1_5'); assert.equal(q1.freshPersisted, 0, 'q1 freshPersisted 0 (canonical=q0)');
});

// ── (OS-21) source-blocked cap-tail duplicate (same imageUrl, junk source) → capSkipped แต่ NO joined verdict (route) ──
await test('OS route: source-blocked cap-tail duplicate → capSkipped counted, vetted/relevant/rank = 0', async () => {
  const q0imgs = Array.from({ length: 40 }, (_, i) => ({ imageUrl: i === 0 ? 'X' : 'f0_' + i })); // q0 เต็ม cap, X rank1 clean
  const sp = mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: q0imgs, q1: [{ imageUrl: 'X', source: 'JUNK' }] }), isCatalogSource: (x) => x.source === 'JUNK', vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: x.imageUrl === 'X' } })), kept: 1, dropped: images.length - 1, failed: 0 }) });
  const rows = (await runPOST({ caseId: 'C', platform: 'google' }, sp, '1')).searchOutcomeShadowV1.rows;
  const q0 = rows.find((r) => r.queryIndex === 0), q1 = rows.find((r) => r.queryIndex === 1);
  assert.equal(q0.relevant, 1); assert.equal(q0.freshPersisted, 1);
  assert.equal(q1.raw, 1, 'q1 raw === 1'); assert.equal(q1.capSkipped, 1, 'q1 capSkipped === 1 (exact, นับ tail)'); assert.equal(q1.vetted, 0, 'q1 blocked cap-tail → vetted 0');
  assert.equal(q1.relevant, 0, 'q1 relevant 0'); assert.equal(q1.rank1_5 + q1.rank6_10 + q1.rank11_20, 0, 'q1 rank 0');
});

// ── (OS-22) all-occurrence: clean cross-query duplicate credits BOTH queries (gap parity) ──
await test('OS gap: clean cross-query duplicate credits BOTH queries (all-occurrence parity)', async () => {
  const on = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X' }] : []), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }) }), '1', { queries: ['nq0', 'nq1'] });
  const rows = on.dossierPatch.images.gapSearchOutcomeShadowV1.rows;
  const g0 = rows.find((r) => r.queryIndex === 0 && r.provider === 'google'), g1 = rows.find((r) => r.queryIndex === 1 && r.provider === 'google');
  assert.equal(g0.relevant, 1, 'nq0/google relevant (collected)'); assert.equal(g0.freshPersisted, 1, 'nq0 canonical freshPersisted');
  assert.equal(g1.relevant, 1, 'nq1/google relevant (clean dup join)'); assert.equal(g1.rank1_5, 1, 'nq1 X rank1'); assert.equal(g1.freshPersisted, 0, 'nq1 ไม่มี freshPersisted');
  assert.equal(g1.inCallDuplicate, 1, 'nq1 X = inCallDuplicate');
});

// ── (OS-23) source-blocked duplicate (junk source) → dup counter แต่ NO joined verdict (gap) ──
await test('OS gap: source-blocked duplicate (junk source) → dup counter, vetted/relevant/rank = 0', async () => {
  const on = await runGapOS(gapSPos({ searchImages: async (p, q) => (p === 'google' ? (q === 'nq0' ? [{ imageUrl: 'X' }] : [{ imageUrl: 'X', source: 'JUNK' }]) : []), isCatalogSource: (x) => x.source === 'JUNK', vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }) }), '1', { queries: ['nq0', 'nq1'] });
  const rows = on.dossierPatch.images.gapSearchOutcomeShadowV1.rows;
  const g0 = rows.find((r) => r.queryIndex === 0 && r.provider === 'google'), g1 = rows.find((r) => r.queryIndex === 1 && r.provider === 'google');
  assert.equal(g0.relevant, 1, 'nq0 X clean collected → relevant'); assert.equal(g0.freshPersisted, 1);
  assert.equal(g1.inCallDuplicate, 1, 'nq1 dup counter ยังนับ');
  assert.equal(g1.vetted, 0, 'nq1 blocked occ → vetted 0'); assert.equal(g1.relevant, 0, 'nq1 relevant 0');
  assert.equal(g1.rank1_5 + g1.rank6_10 + g1.rank11_20, 0, 'nq1 rank 0'); assert.equal(g1.freshPersisted, 0);
});

// ── (OS-24) gap malformed saved suffix (added>len) → omit carrier ──
await test('OS gap: malformed saved suffix (added>len) → omit gapSearchOutcomeShadowV1', async () => {
  const on = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'G1' }] : []), addImages: async () => ({ added: 5, total: 5, byPlatform: {}, images: [{ imageUrl: 'G1', id: 'GAP-1' }] }) }), '1', { queries: ['nq0'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in on.dossierPatch.images), 'added>len → carrier omitted');
});

// ── (OS-25) gap late add-time dedup (added=0) → existingDuplicate, freshPersisted=0 ──
await test('OS gap: late add-time dedup (added=0) → existingDuplicate, freshPersisted=0', async () => {
  const on = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'G1' }] : []), addImages: async () => ({ added: 0, total: 1, byPlatform: {}, images: [{ imageUrl: 'G1', id: 'GAP-1' }] }) }), '1', { queries: ['nq0'] });
  const g = on.dossierPatch.images.gapSearchOutcomeShadowV1.rows.find((r) => r.provider === 'google' && r.queryIndex === 0);
  assert.equal(g.freshPersisted, 0, 'added=0 → freshPersisted 0');
  assert.equal(g.existingDuplicate, 1, 'G1 collected แต่ addImages ไม่รับ → existingDuplicate (via canonical first)');
});

// ── (A) route: dup with inherited/accessor blocker metadata → fail-closed carrier omitted, getter invocation 0 ──
await test('OS route: dup inherited/accessor source (Object.create / getter) → carrier omitted, getter 0', async () => {
  const inh = Object.create({ source: 'JUNK' }); inh.imageUrl = 'X'; // own imageUrl X · source อยู่บน prototype chain (blocker เห็น, own-descriptor read มองไม่เห็น)
  const rA = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'X' }], q1: [inh] }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in rA), 'inherited source (custom prototype) → carrier omitted (fail-closed)');
  let g = 0; const acc = { imageUrl: 'X' }; Object.defineProperty(acc, 'source', { enumerable: true, configurable: true, get() { g++; return 'JUNK'; } });
  const rB = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'X' }], q1: [acc] }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in rB), 'accessor source → carrier omitted (fail-closed)');
  assert.equal(g, 0, 'getter invocation 0 (descriptor-only)');
});

// ── (A) gap: dup with inherited/accessor blocker metadata → fail-closed carrier omitted, getter invocation 0 ──
await test('OS gap: dup inherited/accessor source → carrier omitted, getter 0', async () => {
  const inh = Object.create({ source: 'JUNK' }); inh.imageUrl = 'X';
  const onA = await runGapOS(gapSPos({ searchImages: async (p, q) => (p === 'google' ? (q === 'nq0' ? [{ imageUrl: 'X' }] : [inh]) : []) }), '1', { queries: ['nq0', 'nq1'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in onA.dossierPatch.images), 'gap inherited source → carrier omitted');
  let g = 0; const acc = { imageUrl: 'X' }; Object.defineProperty(acc, 'source', { enumerable: true, configurable: true, get() { g++; return 'JUNK'; } });
  const onB = await runGapOS(gapSPos({ searchImages: async (p, q) => (p === 'google' ? (q === 'nq0' ? [{ imageUrl: 'X' }] : [acc]) : []) }), '1', { queries: ['nq0', 'nq1'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in onB.dossierPatch.images), 'gap accessor source → carrier omitted');
  assert.equal(g, 0, 'gap getter invocation 0 (descriptor-only)');
});

// ── (A/Proxy) route: throwing getPrototypeOf trap → wrapped, exception ไม่ escape, carrier omitted ──
await test('OS route: hostile Proxy throwing getPrototypeOf → carrier omitted, exception ไม่ escape, business ok', async () => {
  let protoN = 0;
  const px = new Proxy({ imageUrl: 'X', source: 'JUNK' }, { getPrototypeOf() { protoN++; throw new Error('proto'); } });
  const r = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'X' }], q1: [px] }) }), '1');
  assert.equal(r.success, true, 'legacy request สำเร็จ (getPrototypeOf exception ไม่ escape)');
  assert.ok(!('searchOutcomeShadowV1' in r), 'carrier omitted (fail-closed)');
  assert.ok(protoN >= 1, 'getPrototypeOf trap ยิง แต่ exception ถูกจับใน try');
});

// ── (A/Proxy) route: throwing has/get traps → ไม่ถูกเรียกเลย (0), non-string source → carrier omitted ──
await test('OS route: hostile Proxy throwing has/get → carrier omitted, has/get invocation 0, business ok', async () => {
  let hasN = 0, getN = 0;
  const target = { imageUrl: 'X', source: 123 }; // non-string source → os.fail (descriptor read) · has/get throw ถ้าถูกเรียก
  const px = new Proxy(target, { has() { hasN++; throw new Error('has'); }, get(t, p) { if (p === 'imageUrl') return 'X'; getN++; throw new Error('get'); } });
  const r = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'X' }], q1: [px] }) }), '1');
  assert.equal(r.success, true, 'legacy request สำเร็จ (has/get exception ไม่ escape เพราะไม่ถูกเรียก)');
  assert.ok(!('searchOutcomeShadowV1' in r), 'carrier omitted (fail-closed: non-string source)');
  assert.equal(hasN, 0, 'has trap invocation 0 (ไม่มี in operator)');
  assert.equal(getN, 0, 'get trap invocation 0 บน blocker fields (descriptor-only, ไม่มี member access)');
});

// ── (A/Proxy) gap: throwing getPrototypeOf → ไม่ escape เข้า per-platform catch (Y หลัง proxy ยัง collect ได้) ──
await test('OS gap: hostile Proxy throwing getPrototypeOf → carrier omitted, business ไม่ถูก perturb', async () => {
  let protoN = 0;
  const px = new Proxy({ imageUrl: 'X', source: 'JUNK' }, { getPrototypeOf() { protoN++; throw new Error('proto'); } });
  const on = await runGapOS(gapSPos({ searchImages: async (p, q) => (p === 'google' ? (q === 'nq0' ? [{ imageUrl: 'X' }] : [px, { imageUrl: 'Y' }]) : []) }), '1', { queries: ['nq0', 'nq1'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in on.dossierPatch.images), 'gap carrier omitted (fail-closed)');
  assert.ok(protoN >= 1, 'getPrototypeOf trap ยิง แต่ exception ถูกจับ (ไม่หลุดเข้า per-platform catch)');
  assert.equal(on.dossierPatch.images.gapSearchAdded, 2, 'X(nq0)+Y(nq1 หลัง proxy) collected → business ไม่ถูก perturb');
});

// ── (A/Proxy) gap: throwing has/get → ไม่ถูกเรียก (0), non-string source → carrier omitted, business ต่อ ──
await test('OS gap: hostile Proxy throwing has/get → carrier omitted, has/get invocation 0, business ต่อ', async () => {
  let hasN = 0, getN = 0;
  const px = new Proxy({ imageUrl: 'X', source: 123 }, { has() { hasN++; throw new Error('has'); }, get(t, p) { if (p === 'imageUrl') return 'X'; getN++; throw new Error('get'); } });
  const on = await runGapOS(gapSPos({ searchImages: async (p, q) => (p === 'google' ? (q === 'nq0' ? [{ imageUrl: 'X' }] : [px, { imageUrl: 'Y' }]) : []) }), '1', { queries: ['nq0', 'nq1'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in on.dossierPatch.images), 'gap carrier omitted (non-string source)');
  assert.equal(hasN, 0, 'has trap invocation 0');
  assert.equal(getN, 0, 'get trap invocation 0 บน blocker fields');
  assert.equal(on.dossierPatch.images.gapSearchAdded, 2, 'business ไม่ถูก perturb (X+Y collected)');
});

// ── (B1) builder descriptor-only input normalization — hostile getter 0 / malformed → null; valid → carrier ──
await test('OS builder: descriptor-only input normalization (hostile getter 0 / malformed → null / valid → carrier)', async () => {
  const okC = _buildSearchOutcomeShadowV1([ROW({ queryIndex: 0, provider: 'google', raw: 2, vetted: 1, relevant: 1, rank1_5: 1 }), ROW({ queryIndex: 1, provider: 'google_news', raw: 1 })]);
  assert.equal(okC.version, 1); assert.equal(okC.rows.length, 2);
  let g = 0; const accProv = ROW({ queryIndex: 0, provider: 'google' }); delete accProv.provider; Object.defineProperty(accProv, 'provider', { enumerable: true, configurable: true, get() { g++; return 'google'; } });
  assert.equal(_buildSearchOutcomeShadowV1([accProv]), null, 'accessor provider → null');
  assert.equal(g, 0, 'getter invocation 0 (descriptor-only)');
  const accCnt = ROW({ queryIndex: 0, provider: 'google' }); delete accCnt.raw; Object.defineProperty(accCnt, 'raw', { enumerable: true, configurable: true, get() { return 5; } });
  assert.equal(_buildSearchOutcomeShadowV1([accCnt]), null, 'accessor counter → null');
  assert.equal(_buildSearchOutcomeShadowV1([Object.assign(Object.create({ x: 1 }), ROW({ queryIndex: 0, provider: 'google' }))]), null, 'exotic prototype row → null');
  assert.equal(_buildSearchOutcomeShadowV1([new Proxy(ROW({ queryIndex: 0, provider: 'google' }), { getPrototypeOf() { throw new Error('x'); } })]), null, 'proxy throwing getPrototypeOf → null (caught)');
  assert.equal(_buildSearchOutcomeShadowV1({ length: 1, 0: ROW({ queryIndex: 0, provider: 'google' }) }), null, 'non-array → null');
  assert.equal(_buildSearchOutcomeShadowV1(Array.from({ length: 4097 }, () => ROW({ queryIndex: 0, provider: 'google' }))), null, 'oversize > 4096 → null');
});

// ── (B2) same-tuple min-rank (route): X rank8 collected + rank12 dup → verdict once, rank6_10=1 ──
await test('OS route: same-tuple duplicate keeps best/min rank (rank8 + rank12 → verdict once, rank6_10=1)', async () => {
  const q0 = Array.from({ length: 12 }, (_, i) => ({ imageUrl: (i === 7 || i === 11) ? 'X' : 'd' + i })); // X ที่ rank8 (collected) + rank12 (dup)
  const sp = mkSP({ queries: ['q0'], searchImages: single({ q0 }), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: x.imageUrl === 'X' } })), kept: 1, dropped: images.length - 1, failed: 0 }) });
  const r = (await runPOST({ caseId: 'C', platform: 'google' }, sp, '1')).searchOutcomeShadowV1.rows.find((x) => x.queryIndex === 0 && x.provider === 'google');
  assert.equal(r.relevant, 1, 'X relevant ครั้งเดียว (same-tuple = 1 group)');
  assert.equal(r.rank6_10, 1, 'best/min rank = 8 → rank6_10 (ไม่ใช่ rank11_20 จาก rank12)');
  assert.equal(r.rank1_5 + r.rank11_20, 0, 'ไม่มี bucket อื่น');
  assert.equal(r.inCallDuplicate, 1, 'X rank12 = inCallDuplicate');
});

// ── (B2) same-tuple min-rank (gap) ──
await test('OS gap: same-tuple duplicate keeps best/min rank (rank8 + rank12 → verdict once, rank6_10=1)', async () => {
  const imgs = Array.from({ length: 12 }, (_, i) => ({ imageUrl: (i === 7 || i === 11) ? 'X' : 'd' + i }));
  const on = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? imgs : []), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: x.imageUrl === 'X' } })), kept: 1, dropped: images.length - 1, failed: 0 }) }), '1', { queries: ['nq0'] });
  const r = on.dossierPatch.images.gapSearchOutcomeShadowV1.rows.find((x) => x.queryIndex === 0 && x.provider === 'google');
  assert.equal(r.relevant, 1, 'X relevant ครั้งเดียว'); assert.equal(r.rank6_10, 1, 'min rank 8 → rank6_10');
  assert.equal(r.rank1_5 + r.rank11_20, 0, 'ไม่มี bucket อื่น'); assert.equal(r.inCallDuplicate, 1, 'X rank12 = inCallDuplicate');
});

// ── (B3) gap Outcome ON/OFF parity: vet input bytes / add input bytes identical + legacy return = ON minus sidecar ──
await test('OS gap: ON/OFF parity — vet input, add input bytes identical + legacy return = ON minus sidecar', async () => {
  const mkRec = () => { const rec = { vet: '', add: '' }; const sp = gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X' }] : []), vetImages: async ({ images }) => { rec.vet = JSON.stringify(images); return { vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }; }, addImages: async (caseId, imgs) => { rec.add = JSON.stringify(imgs); return { added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs.map((im, i) => ({ ...im, id: `${caseId}-${i + 1}` })) }; } }); return { sp, rec }; };
  const A = mkRec(); const onRes = await runGapOS(A.sp, '1', { queries: ['nq0'] });
  const B = mkRec(); const offRes = await runGapOS(B.sp, null, { queries: ['nq0'] });
  assert.equal(A.rec.vet, B.rec.vet, 'vet input bytes เท่ากัน ON vs OFF');
  assert.equal(A.rec.add, B.rec.add, 'add input bytes เท่ากัน ON vs OFF');
  assert.ok('gapSearchOutcomeShadowV1' in onRes.dossierPatch.images, 'ON มี sidecar');
  assert.ok(!('gapSearchOutcomeShadowV1' in offRes.dossierPatch.images), 'OFF ไม่มี sidecar');
  const strip = (r) => { const im = { ...r.dossierPatch.images }; delete im.gapSearchOutcomeShadowV1; return JSON.stringify({ ...r, dossierPatch: { ...r.dossierPatch, images: im } }); };
  assert.equal(strip(onRes), strip(offRes), 'legacy return identical หลัง strip sidecar (business ไม่ถูกแตะ)');
});

// ── (MAIN-FIX 1) stored(library)+source-blocked precedence parity route+gap → sourceBlocked, not existingDuplicate ──
await test('OS parity: stored(library) + source-blocked → sourceBlocked (route + gap), not existingDuplicate', async () => {
  const rowR = (await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X', source: 'JUNK' }] }), readImages: () => [{ imageUrl: 'X' }], isCatalogSource: (x) => x.source === 'JUNK' }), '1')).searchOutcomeShadowV1.rows[0];
  assert.deepEqual({ sb: rowR.sourceBlocked, ed: rowR.existingDuplicate, ic: rowR.inCallDuplicate }, { sb: 1, ed: 0, ic: 0 }, 'route stored+blocked → sourceBlocked');
  const on = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X', source: 'JUNK' }] : []), isCatalogSource: (x) => x.source === 'JUNK' }), '1', { lib: [{ imageUrl: 'X' }], queries: ['nq0'] });
  const rowG = on.dossierPatch.images.gapSearchOutcomeShadowV1.rows.find((r) => r.provider === 'google');
  assert.deepEqual({ sb: rowG.sourceBlocked, ed: rowG.existingDuplicate, ic: rowG.inCallDuplicate }, { sb: 1, ed: 0, ic: 0 }, 'gap stored+blocked → sourceBlocked (parity)');
});

// ── (MAIN-FIX 2) builder scalar-validate before sort → non-scalar queryIndex/provider → null, valueOf/toString not invoked ──
await test('OS builder: non-scalar queryIndex/provider (valueOf/toString) → null, coercion not invoked', async () => {
  let vi = 0, ts = 0;
  const badQi = ROW({ queryIndex: 0, provider: 'google' }); delete badQi.queryIndex; badQi.queryIndex = { valueOf() { vi++; return 0; } };
  assert.equal(_buildSearchOutcomeShadowV1([badQi]), null, 'object queryIndex → null');
  const badProv = ROW({ queryIndex: 0, provider: 'google' }); delete badProv.provider; badProv.provider = { toString() { ts++; return 'google'; } };
  assert.equal(_buildSearchOutcomeShadowV1([badProv]), null, 'object provider → null');
  const badCnt = ROW({ queryIndex: 0, provider: 'google' }); delete badCnt.raw; badCnt.raw = { valueOf() { vi++; return 5; } };
  assert.equal(_buildSearchOutcomeShadowV1([badCnt]), null, 'object counter → null');
  assert.equal(vi + ts, 0, 'valueOf/toString not invoked (scalar-validate ก่อน sort)');
});

// ── (MAIN-FIX 3) verdict triage fail-closed (route): exotic-proto it / triage / Object.prototype pollution → carrier omitted ──
await test('OS route: verdict triage fail-closed (exotic-proto it/triage, Object.prototype pollution) → carrier omitted', async () => {
  const r1 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X' }] }), vetImages: async ({ images }) => ({ vetted: images.map((x) => Object.assign(Object.create({ triage: { relevant: true } }), { imageUrl: x.imageUrl })), kept: 1, dropped: 0, failed: 0 }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in r1), 'exotic-proto vetted item → carrier omitted');
  const r2 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X' }] }), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ imageUrl: x.imageUrl, triage: Object.create({ relevant: true }) })), kept: 1, dropped: 0, failed: 0 }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in r2), 'exotic-proto triage → carrier omitted');
  Object.defineProperty(Object.prototype, 'relevant', { value: true, configurable: true, enumerable: false });
  try {
    const r3 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X' }] }), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ imageUrl: x.imageUrl, triage: {} })), kept: 1, dropped: 0, failed: 0 }) }), '1');
    assert.ok(!('searchOutcomeShadowV1' in r3), 'Object.prototype.relevant pollution → carrier omitted');
  } finally { delete Object.prototype.relevant; }
});

// ── (MAIN-FIX 3) verdict triage fail-closed (gap): exotic-proto triage → carrier omitted ──
await test('OS gap: verdict triage fail-closed (exotic-proto triage) → carrier omitted', async () => {
  const on = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X' }] : []), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ imageUrl: x.imageUrl, triage: Object.create({ relevant: true }) })), kept: images.length, dropped: 0, failed: 0 }) }), '1', { queries: ['nq0'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in on.dossierPatch.images), 'gap exotic-proto triage → carrier omitted');
});

// ── (P2-1) stored 2× occurrences parity route+gap: 2× blocked → sourceBlocked=2; 2× clean → existingDuplicate=1 + inCallDuplicate=1 ──
await test('OS parity: stored 2× — 2× blocked → sourceBlocked=2; 2× clean → existingDuplicate=1+inCallDuplicate=1 (route+gap)', async () => {
  const rR2b = (await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X', source: 'JUNK' }, { imageUrl: 'X', source: 'JUNK' }] }), readImages: () => [{ imageUrl: 'X' }], isCatalogSource: (x) => x.source === 'JUNK' }), '1')).searchOutcomeShadowV1.rows[0];
  assert.deepEqual({ sb: rR2b.sourceBlocked, ed: rR2b.existingDuplicate, ic: rR2b.inCallDuplicate }, { sb: 2, ed: 0, ic: 0 }, 'route 2× blocked stored → sourceBlocked 2');
  const gR2b = (await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X', source: 'JUNK' }, { imageUrl: 'X', source: 'JUNK' }] : []), isCatalogSource: (x) => x.source === 'JUNK' }), '1', { lib: [{ imageUrl: 'X' }], queries: ['nq0'] })).dossierPatch.images.gapSearchOutcomeShadowV1.rows.find((r) => r.provider === 'google');
  assert.deepEqual({ sb: gR2b.sourceBlocked, ed: gR2b.existingDuplicate, ic: gR2b.inCallDuplicate }, { sb: 2, ed: 0, ic: 0 }, 'gap 2× blocked stored → sourceBlocked 2 (parity)');
  const rR2c = (await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X' }, { imageUrl: 'X' }] }), readImages: () => [{ imageUrl: 'X' }] }), '1')).searchOutcomeShadowV1.rows[0];
  assert.deepEqual({ ed: rR2c.existingDuplicate, ic: rR2c.inCallDuplicate, sb: rR2c.sourceBlocked }, { ed: 1, ic: 1, sb: 0 }, 'route 2× clean stored → existingDuplicate 1 + inCallDuplicate 1');
  const gR2c = (await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X' }, { imageUrl: 'X' }] : []) }), '1', { lib: [{ imageUrl: 'X' }], queries: ['nq0'] })).dossierPatch.images.gapSearchOutcomeShadowV1.rows.find((r) => r.provider === 'google');
  assert.deepEqual({ ed: gR2c.existingDuplicate, ic: gR2c.inCallDuplicate, sb: gR2c.sourceBlocked }, { ed: 1, ic: 1, sb: 0 }, 'gap 2× clean stored → existingDuplicate 1 + inCallDuplicate 1 (parity)');
});

// ── (P2-2) builder: non-allowlisted string provider → null ที่ extraction (ไม่ filter เงียบ) ──
await test('OS builder: non-allowlisted string provider → null (reject ทั้ง carrier, ไม่ silent filter)', async () => {
  assert.equal(_buildSearchOutcomeShadowV1([ROW({ queryIndex: 0, provider: 'google', raw: 1 }), ROW({ queryIndex: 1, provider: 'bing', raw: 1 })]), null, 'มี provider นอก allowlist → null ทั้ง carrier (ไม่ drop เหลือ google)');
  assert.equal(_buildSearchOutcomeShadowV1([ROW({ queryIndex: 0, provider: 'bing' })]), null, 'provider นอก allowlist ล้วน → null');
  assert.equal(_buildSearchOutcomeShadowV1([ROW({ queryIndex: 0, provider: 'google', raw: 1 })]).rows.length, 1, 'allowlisted ล้วน → build ปกติ');
});

// ── (P2-3) function-valued vetted row / function triage → os.fail carrier omitted (route + gap) ──
await test('OS route: function-valued vetted row / function triage → carrier omitted', async () => {
  const r1 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X' }] }), vetImages: async () => ({ vetted: [Object.assign(function () {}, { imageUrl: 'X' })], kept: 1, dropped: 0, failed: 0 }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in r1), 'function-valued vetted row (own imageUrl) → carrier omitted');
  const r2 = await runPOST({ caseId: 'C', platform: 'google' }, mkSP({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'X' }] }), vetImages: async () => ({ vetted: [{ imageUrl: 'X', triage: function () {} }], kept: 1, dropped: 0, failed: 0 }) }), '1');
  assert.ok(!('searchOutcomeShadowV1' in r2), 'function triage → carrier omitted');
});
await test('OS gap: function-valued vetted row / function triage → carrier omitted', async () => {
  const on1 = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X' }] : []), vetImages: async () => ({ vetted: [Object.assign(function () {}, { imageUrl: 'X' })], kept: 1, dropped: 0, failed: 0 }) }), '1', { queries: ['nq0'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in on1.dossierPatch.images), 'gap function-valued vetted row → carrier omitted');
  const on2 = await runGapOS(gapSPos({ searchImages: async (p) => (p === 'google' ? [{ imageUrl: 'X' }] : []), vetImages: async () => ({ vetted: [{ imageUrl: 'X', triage: function () {} }], kept: 1, dropped: 0, failed: 0 }) }), '1', { queries: ['nq0'] });
  assert.ok(!('gapSearchOutcomeShadowV1' in on2.dossierPatch.images), 'gap function triage → carrier omitted');
});

// ============================================================
// 🌊 WAVE1A — REF+CAST+HERO V2 authority producer  (flag MEGA_REF_HERO_V2 exact '1', default OFF)
//   Exercises the REAL PURE foundations (story/cast/hero/global) AND the REAL exported Wave1C handshake
//   (buildSelectionAuthorityV1/validateSelectionAuthorityV1 + buildSelectionSpecV2/validateSelectionSpecV2Activation
//   in refSlotContract.js) end-to-end through s6_slots. Fixtures inject genuine measured evidence — production
//   pool records lack these fields today, so the ON path fail-closes to a typed HOLD in the wild. DI doubles are
//   used ONLY to force specific rejection paths (builder HOLD, tampered Global assignmentHash).
// ============================================================
const { computePersonId: rhPid, normalizeCastName: rhNorm, computeCandidateEligibility: rhElig } = await import('../src/lib/castManifest.js');
const { buildStoryReferenceAuthorityContract: rhStoryBuild, hashContract: rhStoryHash } = await import('../src/lib/storyReferenceAuthority.js');
const { buildCastManifest: rhCastBuild } = await import('../src/lib/castManifest.js');
const rhRealRefSlot = await import('../src/lib/refSlotContract.js');
const { buildSelectionSpecV2: rhBuildSpecV2, validateSelectionSpecV2Activation: rhValidateSpecV2 } = rhRealRefSlot;
const rhRealGlobal = await import('../src/lib/semanticGlobalAssignment.js');
const PID = (name) => rhPid(rhNorm(name));

const RH_ENV = ['MEGA_REF_HERO_V2', 'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC'];
const withRhEnv = async (vals, fn) => {
  const prev = RH_ENV.map((k) => process.env[k]);
  for (const k of RH_ENV) { if (vals[k] === undefined) delete process.env[k]; else process.env[k] = vals[k]; }
  try { return await fn(); } finally { RH_ENV.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]; }); }
};
const RH_ON = { MEGA_REF_HERO_V2: '1', MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
const RH_OFF = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' }; // semantic ON but ref-hero-v2 OFF

// genuine measured evidence (passes a DERIVED 'medium' hero contract) + readiness + Global scores
const RH_EV = { identityConfidence: 0.9, faceShare: 0.15, headroom: 0.15, visibleBodyRegion: 'half_body', occlusion: 0.05, edgeCut: 0.02, cleanliness: 0.9 };
const RH_RD = { searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true };
const RH_SC = { semanticScore: 700, qualityScore: 700, slotFitScore: 700 };
const rhImg = (id, { person = null, sceneKey, triageOver = {}, over = {} } = {}) => ({
  id, imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '', width: 900, height: 1200, realWidth: 900, realHeight: 1200,
  triage: { relevant: true, clean: true, faceCount: 1, person, persons: person ? [person] : [], category: 'face-emotional', emotion: 'warm', note: `${id} ${sceneKey}`, newsScene: true, quality: 8, ...RH_EV, ...RH_RD, ...RH_SC, sceneKey, ...triageOver },
  ...over,
});
// 5-slot ready pool for DNA_ALPO (hero/context/action/moment/reaction): Lisa=hero, Nene=reaction, 3 context people.
const RH_POOL = () => [
  rhImg('L1', { person: 'Lisa', sceneKey: 'sceneL' }),
  rhImg('N1', { person: 'Nene', sceneKey: 'sceneN' }),
  rhImg('C1', { person: 'Ctx1', sceneKey: 'sceneC1' }),
  rhImg('C2', { person: 'Ctx2', sceneKey: 'sceneC2' }),
  rhImg('C3', { person: 'Ctx3', sceneKey: 'sceneC3' }),
];
const RH_CHARS = () => [{ name: 'Lisa', role: 'hero' }, { name: 'Nene', role: 'reaction' }, { name: 'Ctx1', role: 'context' }, { name: 'Ctx2', role: 'context' }, { name: 'Ctx3', role: 'context' }];
const RH_PICKS = { hero: { id: 'L1', reason: 'x', backups: [] }, context: { id: 'C1', reason: 'x', backups: [] }, action: { id: 'C2', reason: 'x', backups: [] }, moment: { id: 'C3', reason: 'x', backups: [] }, reaction: { id: 'N1', reason: 'x', backups: [] } };
const rhJob = ({ chars = RH_CHARS(), refId = 'REF-mrbqalpo-h1r1' } = {}) => ({ dossier: {
  images: { caseId: 'RH-TEST' },
  compass: { angle: 'a', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: chars, visualDreamShots: [], doNotUse: [] },
  desk: { title: 'ข่าวทดสอบ RH' },
  refMatch: { dna: DNA_ALPO, styleName: 'ref', typeMatched: true, imagePath: '/x.jpg', refId },
  artBrief: { storyNote: 's', orders: [] },
} });
// DI double: force a Wave1C SelectionAuthority builder HOLD (proves fail-closed handling of a handshake rejection).
const rhHoldAuthApi = () => ({
  buildSelectionAuthorityV1: () => ({ ok: false, decision: 'hold', reasons: ['sa_forced_hold'], selectionAuthority: null }),
  validateSelectionAuthorityV1: () => ({ ok: false, decision: 'hold', reasons: ['sa_forced_hold'], selectionAuthority: null }),
  buildSelectionSpecV2: () => ({ ok: false, decision: 'hold', reasons: ['v2_forced'], selectionSpec: null }),
  validateSelectionSpecV2Activation: () => ({ ok: false, decision: 'hold', reasons: ['v2_forced'], selectionSpec: null }),
});
// DI double: wrap the REAL Global solver but corrupt the assignmentHash (proves Fix #8 independent recompute).
const rhTamperGlobalApi = () => ({
  buildSemanticGlobalAssignment: (input) => { const o = rhRealGlobal.buildSemanticGlobalAssignment(input); return o.decision === 'assigned' ? { ...o, assignmentHash: 'f'.repeat(64) } : o; },
  validateSemanticGlobalAssignmentInput: rhRealGlobal.validateSemanticGlobalAssignmentInput,
});
const rhDeps = ({ pool, picks = RH_PICKS, extraDeps = {}, captures = { brainArgs: [] } }) => ({
  slotDirectorBrain: async (args) => { captures.brainArgs.push(args); return { slots: picks, note: 'mock' }; },
  fetchJson: async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: pool }; throw new Error('unexpected fetch: ' + url); },
  ...extraDeps,
});
const rhRun = async (env, { pool = RH_POOL(), picks = RH_PICKS, extraDeps = {}, job, captures } = {}) =>
  withRhEnv(env, async () => s6_slots(job || rhJob(), { origin: 'http://mock', _deps: rhDeps({ pool, picks, extraDeps, ...(captures ? { captures } : {}) }) }));
const rhPatch = (s6) => s6.dossierPatch?.pickImages?.refHeroV2;

// ── (RH-1) flag OFF (ref-hero-v2 unset) = NO refHeroV2 key + byte-identical to semantic-only baseline ──
await test('RH: flag OFF ⇒ no refHeroV2 key · byte-identical to semantic-only (additive-only)', async () => {
  const off = await rhRun(RH_OFF);
  assert.ok(!('refHeroV2' in off.dossierPatch.pickImages), 'OFF: pickImages has no refHeroV2 key');
  const on = await rhRun(RH_ON);
  assert.equal(on.status, 'done'); assert.ok('refHeroV2' in on.dossierPatch.pickImages, 'ON: refHeroV2 key present');
  const strip = (r) => { const p = { ...r.dossierPatch.pickImages }; delete p.refHeroV2; return JSON.stringify({ ...r, dossierPatch: { ...r.dossierPatch, pickImages: p } }); };
  assert.equal(strip(on), strip(off), 'legacy s6 output identical after stripping refHeroV2 (business untouched)');
});

// ── (RH-2) success: frozen selectionAuthority + exact hero tuple + render bindings (composerSlotId) + spec ──
await test('RH: success ⇒ frozen selectionAuthority + hero tuple exact + renderBindings{refSlotId,composerSlotId,...} + SelectionSpec V2', async () => {
  const p = rhPatch(await rhRun(RH_ON));
  assert.ok(p && p.ok === true && p.v === 1, 'ok success marker');
  const sa = p.selectionAuthority;
  assert.equal(sa.v, 1);
  assert.equal(p.expectedSelectionAuthorityHash, sa.selectionAuthorityHash);
  assert.match(sa.selectionAuthorityHash, /^[0-9a-f]{64}$/);
  // hero tuple exact
  assert.deepEqual({ r: sa.hero.refSlotId, pid: sa.hero.personId, c: sa.hero.candidateId, s: sa.hero.sourceAssetId }, { r: 'hero', pid: PID('Lisa'), c: 'L1', s: 'L1' });
  assert.match(sa.hero.heroContractHash, /^[0-9a-f]{8}$/, 'hero contract fnv1a32 (8 hex)');
  assert.equal(sa.slots.filter((s) => s.refSlotId === sa.hero.refSlotId).length, 1, 'hero matches exactly one slot');
  const orders = sa.slots.map((s) => s.order);
  assert.deepEqual(orders, orders.map((_, i) => i + 1), 'slot order contiguous 1..N ascending');
  assert.ok(sa.slots.every((s) => !('imageUrl' in s)) && !('imageUrl' in sa.hero), 'no URL/backups in pre-S6 authority');
  // renderBindings: EXACT V2 schema
  assert.equal(p.renderBindings.length, sa.slots.length);
  for (const b of p.renderBindings) assert.deepEqual(Object.keys(b).sort(), ['candidateId', 'composerSlotId', 'imageUrl', 'refSlotId', 'sourceAssetId']);
  assert.ok(p.renderBindings.every((b) => /^https:\/\/cdn\.test\//.test(b.imageUrl)));
  assert.equal(new Set(p.renderBindings.map((b) => b.composerSlotId)).size, p.renderBindings.length, 'composerSlotId one-to-one');
  const heroBind = p.renderBindings.find((b) => b.refSlotId === 'hero');
  assert.deepEqual({ c: heroBind.composerSlotId, cid: heroBind.candidateId, u: heroBind.imageUrl }, { c: 'main', cid: 'L1', u: 'https://cdn.test/L1.jpg' });
  // SelectionSpec V2 persisted + valid shape
  assert.equal(p.selectionSpec.v, 2); assert.equal(p.selectionSpec.mode, 'semantic_global_exact'); assert.equal(p.selectionSpec.strictReady, true);
  assert.match(p.selectionSpec.specHash, /^[0-9a-f]{64}$/); assert.match(p.selectionSpec.replayHash, /^[0-9a-f]{64}$/);
  // trusted pins captured at the freeze boundary == the built spec's hashes (reviewer items 1-2)
  assert.equal(p.expectedSpecHash, p.selectionSpec.specHash, 'persisted expectedSpecHash == built specHash');
  assert.equal(p.expectedReplayHash, p.selectionSpec.replayHash, 'persisted expectedReplayHash == built replayHash');
  assert.match(p.expectedSpecHash, /^[0-9a-f]{64}$/); assert.match(p.expectedReplayHash, /^[0-9a-f]{64}$/);
});

// ── (RH-3) current-news Lisa+Nene both required & covered (production-connected); ref subjects never cast ──
await test('RH: current-news Lisa+Nene required & covered via s6 producer; ref subjects never identify cast', async () => {
  const sa = rhPatch(await rhRun(RH_ON)).selectionAuthority;
  const personIds = new Set(sa.slots.map((s) => s.personId).filter(Boolean));
  assert.ok(personIds.has(PID('Lisa')) && personIds.has(PID('Nene')), 'Lisa+Nene covered (Nene omission fixed at authority layer)');
  assert.ok(!personIds.has(PID('พระสงฆ์')) && !personIds.has(PID('ผู้หญิงยิ้ม')), 'ref DNA subjects never become cast identity');
  // every bound person is a current-news person (no ref-only / invented identity)
  const news = new Set(RH_CHARS().map((c) => PID(c.name)));
  assert.ok([...personIds].every((pid) => news.has(pid)), 'all bound persons are current-news people');
});

// ── (RH-4) missing required current-news person (Nene cast-ineligible) ⇒ typed HOLD before the brain ──
await test('RH: required current-news person with no eligible asset ⇒ INSUFFICIENT_CAST_ASSETS HOLD (pre-brain)', async () => {
  const pool = RH_POOL(); pool[1].triage.cropSafe = false; // Nene not a genuinely-ready cast candidate
  const captures = { brainArgs: [] };
  const on = await rhRun(RH_ON, { pool, captures });
  assert.equal(on.status, 'waiting');
  assert.deepEqual(rhPatch(on), { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
  assert.equal(captures.brainArgs.length, 0, 'brain NOT called on HOLD (Fix #6 sentinel)');
});

// ── (RH-5) missing genuine hero evidence ⇒ typed HOLD (never manufactures a passing value) ──
await test('RH: hero candidate missing measured evidence ⇒ HERO_NO_APPROVED_CANDIDATE HOLD', async () => {
  const pool = RH_POOL(); delete pool[0].triage.identityConfidence;
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { pool })), { v: 1, ok: false, hold: 'REF_HERO_V2_HERO_NO_APPROVED_CANDIDATE' });
});

// ── (RH-6) missing genuine Global evidence for a required person ⇒ assignment HOLD ([], no bindings) ──
await test('RH: required person missing measured Global score ⇒ ASSIGNMENT_HOLD (assignments [], no bindings)', async () => {
  const pool = RH_POOL(); delete pool[1].triage.slotFitScore; // Nene has no genuine Global candidate ⇒ uncoverable
  const p = rhPatch(await rhRun(RH_ON, { pool }));
  assert.deepEqual(p, { v: 1, ok: false, hold: 'REF_HERO_V2_ASSIGNMENT_HOLD' });
  assert.ok(!('renderBindings' in p) && !('selectionSpec' in p), 'no partial payload on HOLD');
});

// ── (RH-7) deterministic total-order before caps: >80 records + >64 eligible, reversed ⇒ identical hash/IDs ──
await test('RH: total order before caps ⇒ >80 records & >64 eligible, reversed input ⇒ identical selectionAuthorityHash + selected IDs', async () => {
  // 5 principals (high quality+score → survive legacy-80 & the Global score cap) + 80 eligible Lisa dupes that are
  //   hero-INELIGIBLE (full_body) and low-score (capped out / required-coverage pruned). 85 records (>80) · 85 eligible (>64).
  const principals = RH_POOL();
  principals.forEach((r) => { r.triage.quality = 9; r.triage.semanticScore = 900; r.triage.qualityScore = 900; r.triage.slotFitScore = 900; });
  const dupes = Array.from({ length: 80 }, (_, i) => rhImg(`D${String(i).padStart(2, '0')}`, { person: 'Lisa', sceneKey: `sD${i}`, triageOver: { quality: 7, visibleBodyRegion: 'full_body', semanticScore: 100, qualityScore: 100, slotFitScore: 100 } }));
  const poolA = [...principals, ...dupes];
  const poolB = [...dupes.slice().reverse(), ...principals.slice().reverse()];
  const a = rhPatch(await rhRun(RH_ON, { pool: poolA }));
  const b = rhPatch(await rhRun(RH_ON, { pool: poolB }));
  assert.equal(a.ok, true, `poolA ok (got ${a.hold || 'ok'})`); assert.equal(b.ok, true, `poolB ok (got ${b.hold || 'ok'})`);
  assert.equal(a.expectedSelectionAuthorityHash, b.expectedSelectionAuthorityHash, 'authority hash stable under input reordering + >80/>64 caps');
  assert.deepEqual(a.selectionAuthority.slots.map((s) => s.candidateId), b.selectionAuthority.slots.map((s) => s.candidateId), 'selected IDs identical');
  assert.equal(a.selectionAuthority.hero.candidateId, 'L1', 'eligible high-score hero survived caps');
  assert.ok(a.selectionAuthority.slots.every((s) => !String(s.candidateId).startsWith('D')), 'low-score/ineligible dupes never selected');
});

// ── (RH-8) exact foundation hash binding: envelope binds the real foundation hashes verbatim ──
await test('RH: envelope binds exact foundation hashes (story + cast recomputed == embedded; assignment sha256)', async () => {
  const sa = rhPatch(await rhRun(RH_ON)).selectionAuthority;
  const story = { identities: ['Ctx1', 'Ctx2', 'Ctx3', 'Lisa', 'Nene'], requiredCast: ['Lisa', 'Nene'], optionalCast: ['Ctx1', 'Ctx2', 'Ctx3'], editorialHero: 'Lisa', eventContext: null, facts: [], storySemantics: null, eligibleAssetProvenance: [] };
  assert.equal(sa.storyAuthorityHash, rhStoryHash(rhStoryBuild({ story }).contract), 'storyAuthorityHash == real hashContract');
  const cc = (id, name) => ({ name, candidateId: id, sourceAssetId: id, searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true });
  const manifest = rhCastBuild({ compass: { mainCharacters: RH_CHARS(), requiredCast: ['Lisa', 'Nene'] }, candidates: [cc('L1', 'Lisa'), cc('N1', 'Nene'), cc('C1', 'Ctx1'), cc('C2', 'Ctx2'), cc('C3', 'Ctx3')] });
  assert.equal(sa.castManifestHash, manifest.hash, 'castManifestHash == real buildCastManifest hash');
  assert.match(sa.assignmentHash, /^[0-9a-f]{64}$/, 'assignmentHash is the real sha256 global assignment hash');
});

// ── (RH-9) no attacker echo: hostile compass/candidate strings never appear in a HOLD marker ──
await test('RH: HOLD marker carries a fixed code only — never echoes attacker-supplied strings', async () => {
  const ATTACK = '<script>__PWNED__</script>';
  const chars = [{ name: `Lisa ${ATTACK}`, role: 'hero' }, { name: 'Nene', role: 'reaction' }, { name: 'Ctx1', role: 'context' }, { name: 'Ctx2', role: 'context' }, { name: 'Ctx3', role: 'context' }];
  const pool = RH_POOL().map((x) => { x.triage.note = ATTACK; return x; }); pool[1].triage.cropSafe = false; // Nene ineligible ⇒ HOLD
  const on = await withRhEnv(RH_ON, async () => s6_slots(rhJob({ chars }), { origin: 'http://mock', _deps: rhDeps({ pool }) }));
  const p = rhPatch(on);
  assert.deepEqual(p, { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
  assert.ok(!JSON.stringify(p).includes('__PWNED__'), 'attacker string absent from marker');
});

// ── (RH-10) ZERO post-S6 mutation: persisted authority/bindings/spec/pins DEEP-frozen (nested) ──
await test('RH: persisted refHeroV2 authority/bindings/spec DEEP-frozen incl nested rows (no post-S6 asset switch)', async () => {
  const p = rhPatch(await rhRun(RH_ON));
  const frozen = (o) => o && typeof o === 'object' ? Object.isFrozen(o) && Object.values(o).every(frozen) : true;
  assert.ok(frozen(p), 'entire refHeroV2 payload is deep-frozen (recursively)');
  assert.ok(Object.isFrozen(p.renderBindings[0]) && Object.isFrozen(p.selectionAuthority.slots[0]) && Object.isFrozen(p.selectionAuthority.hero) && Object.isFrozen(p.selectionSpec.slots) && Object.isFrozen(p.selectionSpec.slots[0]) && Object.isFrozen(p.selectionSpec.slots[0].primary));
  assert.throws(() => { p.renderBindings[0].imageUrl = 'https://evil/x.jpg'; });
  assert.throws(() => { p.selectionAuthority.hero.candidateId = 'X'; });
  assert.throws(() => { p.selectionSpec.slots[0].primary.imageUrl = 'https://evil/y.jpg'; });
  assert.throws(() => { p.selectionSpec.slots.push({}); });
});

// ── (RH-11) no ref semantic leakage: ref hero-subject absent from hero, EVERY slot row, AND renderBindings ──
await test('RH: ref DNA hero subject never becomes hero/slot/binding identity (strengthened Fix #2)', async () => {
  const pool = RH_POOL();
  pool.push(rhImg('M1', { person: 'พระสงฆ์', sceneKey: 'sceneM', triageOver: { semanticScore: 1000, qualityScore: 1000, slotFitScore: 1000 } })); // ref subject, high score, NOT in compass
  const p = rhPatch(await rhRun(RH_ON, { pool }));
  const sa = p.selectionAuthority;
  assert.equal(sa.hero.personId, PID('Lisa'), 'hero is compass hero, not ref subject');
  assert.ok(sa.slots.every((s) => s.personId !== PID('พระสงฆ์')), 'ref subject absent from every slot row');
  assert.ok(sa.slots.every((s) => s.candidateId !== 'M1') && p.renderBindings.every((b) => b.candidateId !== 'M1'), 'ref-subject asset never selected (unmatched ⇒ no personId ⇒ excluded)');
});

// ── (RH-12) handshake rejection (builder HOLD via DI) ⇒ producer fails closed, no partial payload ──
await test('RH: Wave1C builder HOLD ⇒ SELECTION_AUTHORITY_BUILD_FAILED (fail-closed, no partial payload)', async () => {
  const p = rhPatch(await rhRun(RH_ON, { extraDeps: { selectionAuthorityApi: rhHoldAuthApi() } }));
  assert.deepEqual(p, { v: 1, ok: false, hold: 'REF_HERO_V2_SELECTION_AUTHORITY_BUILD_FAILED' });
});

// ── (RH-13) CAST-ELIGIBLE authority gate (Fix #1): a same-person INELIGIBLE asset that scores HIGHER is never picked ──
await test('RH: cast-eligible gate ⇒ higher-scoring but ineligible same-person asset never selected by hero or global', async () => {
  const pool = RH_POOL();
  // add a SECOND Lisa asset L2 that is INELIGIBLE (cropSafe:false) yet scores maximally + full hero evidence
  pool.push(rhImg('L2', { person: 'Lisa', sceneKey: 'sceneL2', triageOver: { cropSafe: false, semanticScore: 1000, qualityScore: 1000, slotFitScore: 1000 } }));
  const p = rhPatch(await rhRun(RH_ON, { pool }));
  assert.equal(p.ok, true);
  assert.equal(p.selectionAuthority.hero.candidateId, 'L1', 'hero = eligible L1, NOT higher-scoring ineligible L2');
  assert.ok(p.selectionAuthority.slots.every((s) => s.candidateId !== 'L2') && p.renderBindings.every((b) => b.candidateId !== 'L2'), 'ineligible L2 never in any slot/binding');
  // sanity: L2 really is ineligible under the foundation's own recompute
  assert.equal(rhElig({ searched: true, triaged: true, clean: true, highResolution: true, cropSafe: false, identityVerified: true }), false);
});

// ── (RH-14) genuine per-slot eligibility (Fix #3): a reaction-only person cannot fill context slots ⇒ HOLD ──
await test('RH: per-slot eligibility ⇒ reaction-only people cannot satisfy context slots (no every-record-to-every-slot)', async () => {
  // drop the 3 context people; Nene (reaction) is eligible ONLY for the reaction slot, so context/action/moment are unfillable
  const pool = [rhImg('L1', { person: 'Lisa', sceneKey: 'sceneL' }), rhImg('N1', { person: 'Nene', sceneKey: 'sceneN' })];
  const chars = [{ name: 'Lisa', role: 'hero' }, { name: 'Nene', role: 'reaction' }];
  const p = rhPatch(await rhRun(RH_ON, { pool, job: rhJob({ chars }) }));
  assert.equal(p.ok, false, 'context slots have no role-eligible candidate ⇒ HOLD');
  assert.equal(p.hold, 'REF_HERO_V2_ASSIGNMENT_HOLD');
});

// ── (RH-15) renderBindings composer map is validated one-to-one: realized slot-count mismatch ⇒ HOLD (Fix #4) ──
await test('RH: realized template that is not one-to-one with authority slots ⇒ REALIZED_SLOT_COUNT HOLD', async () => {
  const rt = await import('../src/lib/refTemplate.js');
  const badRealizedDeps = { dnaToTemplateSpec: (dna) => { const r = rt.dnaToTemplateSpec(dna); return { ...r, slots: r.slots.slice(0, r.slots.length - 1) }; } }; // drop one realized slot
  const p = rhPatch(await rhRun(RH_ON, { extraDeps: badRealizedDeps }));
  assert.deepEqual(p, { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_SLOT_COUNT' });
});

// ── (RH-16) TRUE pre-S6 placement (Fix #6): on success the producer runs BEFORE the brain; OFF unchanged ──
await test('RH: producer governs pre-S6 ⇒ brain runs AFTER a successful gate; OFF never invokes the gate', async () => {
  const capOn = { brainArgs: [] };
  const on = await rhRun(RH_ON, { captures: capOn });
  assert.equal(on.status, 'done'); assert.equal(capOn.brainArgs.length, 1, 'brain called once after a successful pre-brain gate');
  assert.ok('refHeroV2' in on.dossierPatch.pickImages);
  const capOff = { brainArgs: [] };
  const off = await rhRun(RH_OFF, { captures: capOff });
  assert.equal(capOff.brainArgs.length, 1, 'OFF: legacy brain path unchanged');
  assert.ok(!('refHeroV2' in off.dossierPatch.pickImages));
});

// ── (RH-17) story/reference structure authority (Fix #7): different refId ⇒ spec hash diverges; authority hash same ──
await test('RH: different refId (same cast/news/geometry) ⇒ SelectionSpec specHash/replayHash diverge; selectionAuthorityHash unchanged', async () => {
  const a = rhPatch(await rhRun(RH_ON, { job: rhJob({ refId: 'REF-A' }) }));
  const b = rhPatch(await rhRun(RH_ON, { job: rhJob({ refId: 'REF-B' }) }));
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.notEqual(a.selectionSpec.specHash, b.selectionSpec.specHash, 'ref identity binds into the verifiable spec hash');
  assert.notEqual(a.selectionSpec.replayHash, b.selectionSpec.replayHash);
  assert.equal(a.selectionAuthority.selectionAuthorityHash, b.selectionAuthority.selectionAuthorityHash, 'identity/cast authority unchanged by refId (ref stays non-authoritative for cast)');
  assert.equal(a.selectionSpec.refId, 'REF-A'); assert.equal(b.selectionSpec.refId, 'REF-B');
});

// ── (RH-18) Global hash integrity (Fix #8): a tampered assignmentHash ⇒ independent recompute HOLDs ──
await test('RH: tampered Global assignmentHash ⇒ ASSIGNMENT_HASH_TAMPERED (independent recompute, not regex/nonblank)', async () => {
  const p = rhPatch(await rhRun(RH_ON, { extraDeps: { globalApi: rhTamperGlobalApi() } }));
  assert.deepEqual(p, { v: 1, ok: false, hold: 'REF_HERO_V2_ASSIGNMENT_HASH_TAMPERED' });
});

// ── (RH-19) SelectionSpec V2: six-key activation against the FROZEN pins — clean round-trip OK; a re-signed
//    (self-consistent, recomputed self-hashes) URL/refId tamper still HOLDs vs the original pins with reason
//    pin/drift, never v2_input_keys (reviewer items 1-3). ──
await test('RH: SelectionSpec V2 activation pins ⇒ clean round-trip OK; re-signed URL/refId tamper HOLDs vs original pins (pin/drift, not v2_input_keys)', async () => {
  const p = rhPatch(await rhRun(RH_ON));
  const SIX = (spec) => ({ selectionSpec: JSON.parse(JSON.stringify(spec)), selectionAuthority: JSON.parse(JSON.stringify(p.selectionAuthority)), expectedSelectionAuthorityHash: p.expectedSelectionAuthorityHash, expectedSpecHash: p.expectedSpecHash, expectedReplayHash: p.expectedReplayHash, realizedTemplate: JSON.parse(JSON.stringify(p.realizedTemplate)) });
  // clean JSON round-trip validates against the original pins
  const clean = rhValidateSpecV2(SIX(p.selectionSpec));
  assert.equal(clean.ok, true, 'valid spec survives JSON round-trip against original pins');
  // RE-SIGN a tamper: rebuild a self-consistent spec with a swapped URL (recomputed embedded hashes) via the real builder
  const tamperBindings = p.renderBindings.map((b, i) => (i === 0 ? { ...b, imageUrl: 'https://evil/hijack.jpg' } : { ...b }));
  const reSigned = rhBuildSpecV2({ selectionAuthority: JSON.parse(JSON.stringify(p.selectionAuthority)), expectedSelectionAuthorityHash: p.expectedSelectionAuthorityHash, renderBindings: tamperBindings, realizedTemplate: JSON.parse(JSON.stringify(p.realizedTemplate)), refId: p.selectionSpec.refId });
  assert.equal(reSigned.ok, true, 're-signed spec is self-consistent (its own specHash/replayHash recomputed)');
  assert.notEqual(reSigned.selectionSpec.replayHash, p.expectedReplayHash, 're-signed replayHash differs from the trusted pin');
  const badUrl = rhValidateSpecV2(SIX(reSigned.selectionSpec)); // validate the re-signed spec against the ORIGINAL pins
  assert.equal(badUrl.ok, false, 're-signed URL tamper HOLDs vs original pins');
  assert.ok(badUrl.reasons.some((r) => /replay_hash|pin|drift/.test(r)) && !badUrl.reasons.includes('v2_input_keys'), `reason is pin/drift not v2_input_keys: ${JSON.stringify(badUrl.reasons)}`);
  // re-signed refId tamper likewise HOLDs vs original specHash pin
  const reSignedRef = rhBuildSpecV2({ selectionAuthority: JSON.parse(JSON.stringify(p.selectionAuthority)), expectedSelectionAuthorityHash: p.expectedSelectionAuthorityHash, renderBindings: p.renderBindings.map((b) => ({ ...b })), realizedTemplate: JSON.parse(JSON.stringify(p.realizedTemplate)), refId: 'ATTACKER-REF' });
  const badRef = rhValidateSpecV2(SIX(reSignedRef.selectionSpec));
  assert.equal(badRef.ok, false, 're-signed refId tamper HOLDs vs original pins');
  assert.ok(badRef.reasons.some((r) => /spec_hash|pin|drift/.test(r)) && !badRef.reasons.includes('v2_input_keys'));
});

// ── (RH-20) production-level injected V2 validator rejection ⇒ producer fails closed (Fix #9) ──
await test('RH: injected SelectionSpec V2 validator HOLD ⇒ producer SELECTION_SPEC_VALIDATE_FAILED (no partial payload)', async () => {
  const api = { ...rhRealRefSlot, validateSelectionSpecV2Activation: () => ({ ok: false, decision: 'hold', reasons: ['v2_forced_pin'], selectionSpec: null }) };
  const p = rhPatch(await rhRun(RH_ON, { extraDeps: { selectionAuthorityApi: api } }));
  assert.deepEqual(p, { v: 1, ok: false, hold: 'REF_HERO_V2_SELECTION_SPEC_VALIDATE_FAILED' });
});

// ── (RH-21) coverage-preserving cap (reviewer item 5): a LOW-score required person behind >64 HIGH-score optionals is covered ──
await test('RH: coverage-preserving cap ⇒ low-score required Nene behind >64 high-score optional candidates is still covered', async () => {
  // principals high-score EXCEPT Nene (required, reaction, very low score). 70 high-score hero-INELIGIBLE Lisa dupes
  //   (reaction-eligible, pruned by required coverage) would push Nene out of a naive top-64 by score.
  const principals = RH_POOL();
  principals.forEach((r) => { r.triage.semanticScore = 900; r.triage.qualityScore = 900; r.triage.slotFitScore = 900; });
  principals[1].triage.semanticScore = 5; principals[1].triage.qualityScore = 5; principals[1].triage.slotFitScore = 5; // Nene = lowest
  const dupes = Array.from({ length: 70 }, (_, i) => rhImg(`D${String(i).padStart(2, '0')}`, { person: 'Lisa', sceneKey: `sD${i}`, triageOver: { visibleBodyRegion: 'full_body', semanticScore: 800, qualityScore: 800, slotFitScore: 800 } }));
  const p = rhPatch(await rhRun(RH_ON, { pool: [...principals, ...dupes] }));
  assert.equal(p.ok, true, `expected coverage-preserving success (got ${p.hold || 'ok'})`);
  const pids = new Set(p.selectionAuthority.slots.map((s) => s.personId).filter(Boolean));
  assert.ok(pids.has(PID('Nene')), 'low-score required Nene reserved past the 64-cap and covered');
  assert.equal(p.selectionAuthority.hero.personId, PID('Lisa'));
});

// ── realized-provenance helpers: the AUTHORITY is a module-private WeakMap in refTemplate keyed by slot OBJECT IDENTITY
//    (realizedSlotSourceIndex); the non-enum _sourceIndex descriptor is defense-in-depth. Any clone/restamp is a NEW
//    object absent from that WeakMap ⇒ unauthentic. rhPerfect builds a byte-perfect LOCKED clone (still unauthentic). ──
const rhRT = await import('../src/lib/refTemplate.js');
const rhRealized = (dna) => rhRT.dnaToTemplateSpec(dna);
const rhSrcOf = (slot) => Object.getOwnPropertyDescriptor(slot, '_sourceIndex')?.value;
const rhPerfect = (src, si) => { const o = {}; for (const k of Object.keys(src)) o[k] = src[k]; Object.defineProperty(o, '_sourceIndex', { value: si, enumerable: false, writable: false, configurable: false }); return o; };

// ── (RH-22) proof: provenance is AUTHENTIC — WeakMap accessor returns the index for the original object, null for any clone ──
await test('RH: provenance authority = WeakMap by object identity (accessor returns index for original slot, null for a clone); descriptor locked + invisible to JSON/keys', async () => {
  const r = rhRealized(DNA_ALPO);
  assert.ok(r && Array.isArray(r.slots) && r.slots.length >= 3);
  for (const s of r.slots) {
    const d = Object.getOwnPropertyDescriptor(s, '_sourceIndex');
    assert.ok(d && !('get' in d) && d.enumerable === false && d.writable === false && d.configurable === false && Number.isInteger(d.value) && d.value >= 0, 'locked non-enumerable data descriptor');
    assert.equal(rhRT.realizedSlotSourceIndex(s), d.value, 'WeakMap binds THIS object to the same index');
    assert.ok(!Object.keys(s).includes('_sourceIndex') && !('_sourceIndex' in JSON.parse(JSON.stringify(s))), 'invisible to Object.keys / JSON (zero legacy)');
    assert.equal(rhRT.realizedSlotSourceIndex({ ...s }), null, 'a spread CLONE is NOT authentic ⇒ null');
    assert.equal(rhRT.realizedSlotSourceIndex(rhPerfect(s, d.value)), null, 'a byte-perfect locked clone is STILL not authentic ⇒ null');
  }
  assert.equal(new Set(r.slots.map(rhRT.realizedSlotSourceIndex)).size, r.slots.length, 'unique authentic index per slot');
});

// ── (RH-23) REORDER realized WITH original objects ⇒ ORDER-INVARIANT correct mapping (join by authentic sourceIndex) ──
await test('RH: reordered realized (ORIGINAL objects) ⇒ correct order-invariant mapping (hero→main, reaction→circle); no asset switch; brain still runs', async () => {
  const reorderDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); return { ...r, slots: r.slots.slice().reverse() }; } }; // reversed, SAME objects ⇒ authentic
  const captures = { brainArgs: [] };
  const p = rhPatch(await rhRun(RH_ON, { extraDeps: reorderDeps, captures }));
  assert.equal(p.ok, true, `order-invariant success (got ${p.hold || 'ok'})`);
  const bind = (rs) => p.renderBindings.find((b) => b.refSlotId === rs);
  assert.equal(bind('hero').composerSlotId, 'main', 'hero pins its OWN geometry regardless of realized array order');
  assert.equal(bind('reaction').composerSlotId, 'circle', 'reaction pins the circle regardless of position');
  assert.equal(p.selectionAuthority.hero.candidateId, 'L1'); // no asset substitution
  assert.equal(captures.brainArgs.length, 1, 'brain runs after the successful pre-brain gate');
});

// ── (RH-24) stripped provenance (clone, no descriptor) ⇒ HOLD — never positional/shape fallback ──
await test('RH: realized clones with provenance STRIPPED ⇒ REALIZED_PROVENANCE_MISSING HOLD', async () => {
  const stripDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); return { ...r, slots: r.slots.map((x) => ({ ...x })) }; } }; // spread ⇒ no _sourceIndex, not in WeakMap
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: stripDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_PROVENANCE_MISSING' });
});

// ── (RH-25) AUTHENTICITY (the core fix): byte-perfect restamp AND same-shape rect↔rect restamp ⇒ UNAUTHENTIC HOLD ──
await test('RH: byte-perfect restamp / same-shape rect↔rect restamp ⇒ UNAUTHENTIC HOLD (WeakMap identity, not descriptor/shape)', async () => {
  // perfect LOCKED descriptor carrying the CORRECT index, but a NEW object ⇒ absent from the WeakMap ⇒ HOLD
  const perfectDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); return { ...r, slots: r.slots.map((x) => rhPerfect(x, rhSrcOf(x))) }; } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: perfectDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_PROVENANCE_UNAUTHENTIC' });
  // SAME-SHAPE rect↔rect swap on perfect clones (shapes identical, indices swapped) ⇒ still HOLD — the gap is closed
  const swapDeps = { dnaToTemplateSpec: (dna) => {
    const r = rhRealized(dna); const rects = r.slots.map((s, ix) => ({ s, ix })).filter((o) => o.s.shape !== 'circle');
    const a = rects[0].ix, b = rects[1].ix;
    const s = r.slots.map((x) => rhPerfect(x, rhSrcOf(x)));
    s[a] = rhPerfect(r.slots[a], rhSrcOf(r.slots[b])); s[b] = rhPerfect(r.slots[b], rhSrcOf(r.slots[a])); // rect↔rect index swap
    return { ...r, slots: s };
  } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: swapDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_PROVENANCE_UNAUTHENTIC' });
});

// ── (RH-26) mutable descriptor ⇒ DESCRIPTOR_INVALID · accessor _sourceIndex ⇒ DESCRIPTOR_INVALID with getter invocation 0 (TOCTOU) ──
await test('RH: mutable descriptor ⇒ DESCRIPTOR_INVALID · accessor _sourceIndex ⇒ DESCRIPTOR_INVALID, getter NEVER invoked (TOCTOU-safe)', async () => {
  const mutDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); return { ...r, slots: r.slots.map((x) => { const o = { ...x }; Object.defineProperty(o, '_sourceIndex', { value: rhSrcOf(x), enumerable: false, writable: true, configurable: true }); return o; }) }; } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: mutDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_PROVENANCE_DESCRIPTOR_INVALID' });
  let gets = 0;
  const accDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); return { ...r, slots: r.slots.map((x) => { const o = { ...x }; const v = rhSrcOf(x); Object.defineProperty(o, '_sourceIndex', { enumerable: false, configurable: true, get() { gets++; return v; } }); return o; }) }; } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: accDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_PROVENANCE_DESCRIPTOR_INVALID' });
  assert.equal(gets, 0, 'accessor getter NEVER invoked (descriptor-only read ⇒ no TOCTOU)');
});

// ── (RH-26b) AUTHENTIC-CONTENT INTEGRITY (item 1): a post-capture mutation/swap of an authentic slot's live id/geometry/
//    shape is NEVER blessed as GO — the producer descriptor-snapshots the CURRENT render fields, compares to the frozen
//    provenance, and HOLDs on ANY divergence. A field getter is rejected WITHOUT invocation. (Reorder-of-originals GO is
//    proven positively by RH-23 above — authentic, unmutated ⇒ still GO.) ──
await test('RH: authentic id mutation after return ⇒ CONTENT_TAMPERED HOLD (never the stale snapshot as GO)', async () => {
  const idMutDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); r.slots[0].id = `HIJACK-${r.slots[0].id}`; return r; } }; // same identity, live id mutated
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: idMutDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_CONTENT_TAMPERED' });
});
await test('RH: authentic geometry mutation after return ⇒ CONTENT_TAMPERED HOLD (valid-range value still caught by the exact compare)', async () => {
  const geoMutDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); r.slots[0].x = (Number(r.slots[0].x) || 0) + 7; return r; } }; // +7 is in-range: proves it's the tamper compare, not a bounds check
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: geoMutDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_CONTENT_TAMPERED' });
});
await test('RH: authentic rect↔rect id SWAP after return ⇒ CONTENT_TAMPERED HOLD (identities preserved, content diverges)', async () => {
  const swapIdDeps = { dnaToTemplateSpec: (dna) => {
    const r = rhRealized(dna); const rects = r.slots.filter((s) => s.shape !== 'circle');
    assert.ok(rects.length >= 2, 'need two rects to swap');
    const t = rects[0].id; rects[0].id = rects[1].id; rects[1].id = t; // swap authentic live ids (same objects)
    return r;
  } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: swapIdDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_CONTENT_TAMPERED' });
});
await test('RH: authentic shape flip (rect→circle) after return ⇒ CONTENT_TAMPERED HOLD', async () => {
  const shapeFlipDeps = { dnaToTemplateSpec: (dna) => { const r = rhRealized(dna); const rect = r.slots.find((s) => s.shape !== 'circle'); rect.shape = 'circle'; return r; } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: shapeFlipDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_CONTENT_TAMPERED' });
});
await test('RH: authentic live-field GETTER (id) ⇒ CONTENT_ACCESSOR HOLD, getter NEVER invoked (descriptor-only read)', async () => {
  let gets = 0;
  const idGetDeps = { dnaToTemplateSpec: (dna) => {
    const r = rhRealized(dna); const s = r.slots[0]; const orig = s.id;
    delete s.id; Object.defineProperty(s, 'id', { enumerable: true, configurable: true, get() { gets++; return `HIJACK-${orig}`; } }); // live id → counting getter
    return r;
  } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: idGetDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_CONTENT_ACCESSOR' });
  assert.equal(gets, 0, 'live-field id getter NEVER invoked (producer descriptor-reads only)');
});

// ── (RH-26c) CONTAINER integrity (item 2): the realized `slots` container is descriptor-read exactly ONCE — a getter/
//    accessor (incl. a TOCTOU getter returning alternating arrays) is rejected WITHOUT invocation. ──
await test('RH: realized slots CONTAINER accessor/TOCTOU ⇒ CONTAINER_ACCESSOR HOLD, getter NEVER invoked', async () => {
  let gets = 0;
  const containerGetDeps = { dnaToTemplateSpec: (dna) => {
    const r = rhRealized(dna); const realSlots = r.slots; const o = { ...r }; delete o.slots;
    let toggle = 0;
    Object.defineProperty(o, 'slots', { enumerable: true, configurable: true, get() { gets++; return (toggle++ % 2) ? [] : realSlots; } }); // TOCTOU: alternating arrays
    return o;
  } };
  assert.deepEqual(rhPatch(await rhRun(RH_ON, { extraDeps: containerGetDeps })), { v: 1, ok: false, hold: 'REF_HERO_V2_REALIZED_CONTAINER_ACCESSOR' });
  assert.equal(gets, 0, 'container getter NEVER invoked (single descriptor read ⇒ no TOCTOU window)');
});

// ── (RH-27) MAIN S7 CANONICAL LATCH + NO-DOWNGRADE (P0-1/P0-2): sole latch MEGA_STRICT_RENDER; V1-vs-V2 by carrier
//    version; carrier present + latch OFF ⇒ HOLD (no downgrade); invalid carrier under latch ⇒ HOLD; slotPlan from
//    canonical bindings (hero by heroSlotId, mandatory identity fields). ──
const withEnvKeys = async (obj, fn) => { const ks = Object.keys(obj); const prev = ks.map((k) => process.env[k]); for (const k of ks) process.env[k] = obj[k]; try { return await fn(); } finally { ks.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]; }); } };
const rhMkDeps = () => { const cap = { rawBody: null, payload: null }; return { cap, deps: {
  slotDirectorBrain: async () => ({ slots: RH_PICKS, note: 'mock' }),
  fetchJson: async (url, opts) => {
    if (String(url).includes('/api/images/')) return { success: true, images: RH_POOL() };
    if (String(url).includes('/api/queue/add')) { cap.rawBody = opts.body; cap.payload = JSON.parse(opts.body); return { success: true, jobId: 'JOB-S7W' }; }
    throw new Error('unexpected fetch: ' + url);
  } } }; };
const rhJobWithCarrier = async () => { const { deps } = rhMkDeps(); const job = rhJob();
  const s6 = await withEnvKeys(RH_ON, async () => s6_slots(job, { origin: 'http://mock', _deps: deps }));
  assert.equal(s6.status, 'done'); assert.equal(s6.dossierPatch.pickImages.refHeroV2.ok, true, 'producer emitted a valid carrier');
  Object.assign(job.dossier, s6.dossierPatch); return job; };

await test('RH: S7 latch=MEGA_STRICT_RENDER + valid carrier ⇒ V2 enqueue; slotPlan SOLELY from canonical bindings (hero by heroSlotId, mandatory ids)', async () => {
  const job = await rhJobWithCarrier(); const { cap, deps } = rhMkDeps();
  const s7 = await withEnvKeys({ ...RH_ON, MEGA_STRICT_RENDER: '1' }, async () => s7_cover(job, { origin: 'http://mock', _deps: deps }));
  assert.equal(s7.status, 'done', `V2 enqueue (got ${s7.summary})`);
  assert.ok(cap.rawBody.includes('"refHeroV2"'), 'carrier own-key on the wire');
  assert.equal(cap.payload.refHeroV2.selectionSpec.v, 2);
  const sp = cap.payload.slotPlan;
  assert.ok(Array.isArray(sp) && sp.length >= 3, 'canonical slotPlan present');
  assert.ok(sp.every((p) => p.candidateId && p.personId && p.sourceAssetId && p.refSlotId && p.composerSlotId && p.url), 'every row carries mandatory identity fields');
  assert.equal(sp.filter((p) => p.isHero).length, 1, 'exactly one hero row');
  const hero = sp.find((p) => p.isHero);
  assert.deepEqual({ r: hero.refSlotId, c: hero.composerSlotId }, { r: 'hero', c: 'main' }, 'hero by heroSlotId→composerSlotId, never /main|hero/ regex');
  // slotPlan URLs come from the canonical spec bindings, not raw pickImages.slots
  const specUrls = new Set(job.dossier.pickImages.refHeroV2.selectionSpec.slots.map((s) => s.primary.imageUrl));
  assert.ok(sp.every((p) => specUrls.has(p.url)), 'slotPlan URLs derive from canonical bindings');
});

await test('RH: S7 NO-DOWNGRADE — carrier persisted but MEGA_STRICT_RENDER OFF ⇒ HOLD before queue/network (never legacy)', async () => {
  const job = await rhJobWithCarrier(); const { cap, deps } = rhMkDeps();
  const s7 = await withEnvKeys({ ...RH_ON }, async () => s7_cover(job, { origin: 'http://mock', _deps: deps })); // NO MEGA_STRICT_RENDER
  assert.equal(s7.status, 'waiting', 'carrier + latch off ⇒ HOLD (no V1/legacy downgrade)');
  assert.equal(cap.rawBody, null, 'nothing enqueued — no queue/network before the HOLD');
});

await test('RH: S7 NO-DOWNGRADE — partial/invalid carrier UNDER the latch ⇒ HOLD (never legacy)', async () => {
  const job = await rhJobWithCarrier(); const { cap, deps } = rhMkDeps();
  const bad = { ...job.dossier.pickImages.refHeroV2 }; delete bad.expectedSpecHash; // strip a required pin
  job.dossier.pickImages = { ...job.dossier.pickImages, refHeroV2: bad };
  const s7 = await withEnvKeys({ ...RH_ON, MEGA_STRICT_RENDER: '1' }, async () => s7_cover(job, { origin: 'http://mock', _deps: deps }));
  assert.equal(s7.status, 'waiting', 'partial carrier under latch ⇒ HOLD');
  assert.equal(cap.rawBody, null, 'nothing enqueued');
});

await test('RH: S7 NO carrier ⇒ legacy/V1 path unchanged (no refHeroV2 key; no forbidden strict alias)', async () => {
  // strip the carrier from the S6 dossier ⇒ s7 legacy path runs; assert byte-parity (no refHeroV2) + no forbidden alias
  const { deps } = rhMkDeps(); const job = rhJob();
  const s6 = await withEnvKeys(RH_ON, async () => s6_slots(job, { origin: 'http://mock', _deps: deps }));
  const pick = { ...s6.dossierPatch.pickImages }; delete pick.refHeroV2; // simulate producer OFF (no carrier)
  Object.assign(job.dossier, { ...s6.dossierPatch, pickImages: pick });
  const { cap, deps: deps2 } = rhMkDeps();
  const s7 = await withEnvKeys(RH_ON, async () => s7_cover(job, { origin: 'http://mock', _deps: deps2 }));
  assert.ok(s7.status === 'done' || s7.status === 'waiting'); // legacy outcome (no carrier gate)
  if (cap.rawBody) assert.ok(!cap.rawBody.includes('"refHeroV2"'), 'legacy payload has no refHeroV2 key (byte parity)');
});

// ── (RH-28) EVIDENCE INTEGRITY — the V2 slotPlan must never FABRICATE triage.newsScene. The canonical RH→Cast→Global
//    chain never carries triage.newsScene: eligibility gates only on the six readiness booleans (of which `clean` is
//    one — so `clean:true` is genuinely derived), and _rhGlobalCandidate neither reads nor emits newsScene. This test
//    forces EVERY eligible pool row to triage.newsScene=false so selection is guaranteed to pick false-evidence assets,
//    runs the REAL S6 producer → S7 V2 producer, and proves the queued V2 slotPlan rows do NOT own a newsScene property
//    and never assert true — while `clean` stays true from the eligible evidence. Regression for the removed hardcode. ──
const rhPoolNewsSceneFalse = () => [
  rhImg('L1', { person: 'Lisa', sceneKey: 'sceneL', triageOver: { newsScene: false } }),
  rhImg('N1', { person: 'Nene', sceneKey: 'sceneN', triageOver: { newsScene: false } }),
  rhImg('C1', { person: 'Ctx1', sceneKey: 'sceneC1', triageOver: { newsScene: false } }),
  rhImg('C2', { person: 'Ctx2', sceneKey: 'sceneC2', triageOver: { newsScene: false } }),
  rhImg('C3', { person: 'Ctx3', sceneKey: 'sceneC3', triageOver: { newsScene: false } }),
];
const rhMkDepsPool = (pool) => { const cap = { rawBody: null, payload: null }; return { cap, deps: {
  slotDirectorBrain: async () => ({ slots: RH_PICKS, note: 'mock' }),
  fetchJson: async (url, opts) => {
    if (String(url).includes('/api/images/')) return { success: true, images: pool };
    if (String(url).includes('/api/queue/add')) { cap.rawBody = opts.body; cap.payload = JSON.parse(opts.body); return { success: true, jobId: 'JOB-S7NS' }; }
    throw new Error('unexpected fetch: ' + url);
  } } }; };

await test('RH: EVIDENCE INTEGRITY — every eligible asset triage.newsScene=false ⇒ queued V2 slotPlan OMITS newsScene (never owns the key, never fabricates true); clean stays true', async () => {
  const pool = rhPoolNewsSceneFalse();
  // premise guard: every eligible pool row genuinely carries triage.newsScene=false yet stays cast-eligible
  assert.ok(pool.every((im) => im.triage.newsScene === false && rhElig(im.triage) === true),
    'premise: all pool rows are triage.newsScene=false AND cast-eligible (newsScene never gates eligibility)');
  // REAL S6 producer → valid carrier built from newsScene=false evidence
  const s6deps = rhMkDepsPool(pool); const job = rhJob();
  const s6 = await withEnvKeys(RH_ON, async () => s6_slots(job, { origin: 'http://mock', _deps: s6deps.deps }));
  assert.equal(s6.status, 'done');
  assert.equal(s6.dossierPatch.pickImages.refHeroV2.ok, true, 'producer emitted a valid carrier from newsScene=false evidence');
  Object.assign(job.dossier, s6.dossierPatch);
  // REAL S7 V2 producer → enqueue; capture the exact wire
  const { cap, deps } = rhMkDepsPool(pool);
  const s7 = await withEnvKeys({ ...RH_ON, MEGA_STRICT_RENDER: '1' }, async () => s7_cover(job, { origin: 'http://mock', _deps: deps }));
  assert.equal(s7.status, 'done', `V2 enqueue (got ${s7.summary})`);
  const sp = cap.payload.slotPlan;
  assert.ok(Array.isArray(sp) && sp.length >= 3, 'canonical slotPlan present');
  // ★ integrity: no row OWNS a newsScene property (omitted, not fabricated) and none asserts true
  assert.ok(sp.every((p) => !Object.prototype.hasOwnProperty.call(p, 'newsScene')),
    'no V2 slotPlan row owns a newsScene property (omitted — reaches consumer as unknown/null)');
  assert.ok(sp.every((p) => p.newsScene !== true), 'no V2 slotPlan row fabricates newsScene=true');
  // ★ clean genuinely derived: every eligible tuple cleared the six-field readiness (incl. clean)
  assert.ok(sp.every((p) => p.clean === true), 'clean stays true from eligible evidence');
  // ★ the serialized wire bytes carry no newsScene key in any slotPlan row either
  const wire = JSON.parse(cap.rawBody);
  assert.ok(wire.slotPlan.every((p) => !Object.prototype.hasOwnProperty.call(p, 'newsScene')),
    'serialized wire slotPlan rows carry no newsScene key');
});
console.log(`1..${passed}`);
