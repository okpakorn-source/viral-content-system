// ============================================================
// 🧪 reftest-queue — cover-ref-test QUEUE mode (R2) offline regression
// ------------------------------------------------------------
// Target: src/lib/refTestPipeline.js
//   exports under test: rt_compass / rt_s5case / rt_s5keywords / rt_s5search / rt_s5triage /
//     rt_s5clipframe / rt_s6slots / rt_s7compose (queue stage functions) +
//     enqueueRefTest / cancelRefTestJob / duplicateRefTestJob (store-pure) + runCoverRefTest (sync parity).
//
// - offline 100%: global.fetch = bomb (โยนทันทีถ้าถูกเรียก) · ทุก adapter/compose/qc/archive ฉีดผ่าน _deps
//   (default โมดูลจริงไม่ถูก "เรียก" — โหลดตอน import เฉยๆ ไม่ยิง network)
// - store (newJob/updateJob/getJob) = in-memory stub เท่านั้น — ไม่แตะ fs/supabase
// - @/ alias resolve ผ่าน loader hook (แบบเดียวกับ ac0099/ac0084)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const ORIG_FETCH_DESC = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

let fetchBombCalls = 0;
globalThis.fetch = () => { fetchBombCalls++; throw new Error('NETWORK_BOMB: global.fetch is forbidden in this test'); };

const {
  rt_compass, rt_s5case, rt_s5keywords, rt_s5search, rt_s5triage, rt_s5clipframe, rt_s6slots, rt_s7compose,
  enqueueRefTest, cancelRefTestJob, duplicateRefTestJob, runCoverRefTest,
} = await import('../src/lib/refTestPipeline.js');

// ---------- in-memory store stub (mirror megaJobStore newJob/updateJob/getJob) ----------
function mkStore(initial = []) {
  const rows = new Map();
  for (const j of initial) rows.set(j.id, JSON.parse(JSON.stringify(j)));
  let seq = 0;
  for (const id of rows.keys()) { const m = /^MG-(\d+)$/.exec(id); if (m) seq = Math.max(seq, parseInt(m[1], 10)); }
  return {
    rows,
    newJob: async ({ mode = 'auto' } = {}) => {
      seq += 1;
      const job = { id: `MG-${String(seq).padStart(4, '0')}`, status: 'pending', stage: 's1_pick', mode, dossier: { s1Attempts: 0, triedCardIds: [] }, stagesDone: [] };
      rows.set(job.id, job);
      return JSON.parse(JSON.stringify(job));
    },
    getJob: async (id) => (rows.has(id) ? JSON.parse(JSON.stringify(rows.get(id))) : null),
    updateJob: async (id, patch) => {
      const cur = rows.get(id);
      if (!cur) return null;
      const merged = { ...cur, ...patch, dossier: { ...(cur.dossier || {}), ...(patch.dossier || {}) } };
      rows.set(id, merged);
      return JSON.parse(JSON.stringify(merged));
    },
  };
}

const bodyOf = (n) => 'ก'.repeat(n);
const COVER_ORIGIN = 'http://localhost:3000';

// ---------- stub adapters for the rt_* chain (no real AI/network) ----------
function mkChainDeps(overrides = {}) {
  const calls = { compass: 0, s5_case: 0, s5_keywords: 0, s5_search: 0, s5_triage: 0, s5_clipframe: 0, s6_slots: 0, s7_cover: 0, compose: 0, qc: 0, archive: 0, persist: 0 };
  const done = (patch) => ({ status: 'done', nextAction: 'continue', ...(patch ? { dossierPatch: patch } : {}) });
  const deps = {
    compassBrain: async () => { calls.compass++; return { angle: 'มุมทดสอบ', primaryEmotion: 'warm', mainCharacters: [{ name: 'ก', role: 'hero' }], visualDreamShots: [] }; },
    s5_case: async () => { calls.s5_case++; return done({ images: { caseId: 'RT-CASE', keywordsCount: 3 } }); },
    s5_keywords: async () => { calls.s5_keywords++; return done(); },
    s5_search: async () => { calls.s5_search++; return (calls.s5_search < 2) ? { status: 'waiting', nextAction: 'wait' } : done({ images: { caseId: 'RT-CASE', poolReady: true } }); },
    s5_triage: async () => { calls.s5_triage++; return done({ refMatch: { refId: 'REF-x', dnaHash: 'h', refBoundAt: 't' } }); },
    s5_clipframe: async () => { calls.s5_clipframe++; return done(); },
    s6_slots: async () => { calls.s6_slots++; return done({ pickImages: { slots: { hero: { id: 'A', imageUrl: 'u' } }, slotOrder: ['hero'], heroSlotId: 'hero', slotContractHash: 'sc', poolSize: 5 } }); },
    s7_cover: async (job, { _deps } = {}) => {
      calls.s7_cover++;
      await _deps.fetchJson(`${COVER_ORIGIN}/api/queue/add`, { method: 'POST', body: JSON.stringify({ composer: 'mega', newsTitle: 'x', slotPlan: [{ url: 'u1' }, { url: 'u2' }] }) });
      return { status: 'done', nextAction: 'continue', summary: 's7 queued', dossierPatch: { cover: { queueJobId: 'Q1', enqueuedAt: 't' } } };
    },
    composeAndVerify: async () => { calls.compose++; return { success: true, base64: 'data:image/jpeg;base64,QUJD', template: 'ref_dna', caseId: 'RT-CASE', qcFlags: [], refSimilarity: 88 }; },
    evaluateCoverQc: () => { calls.qc++; return { pass: true, reasons: [] }; },
    loadArchive: async () => ({ addMegaCover: async () => { calls.archive++; return { id: 'ARC-1' }; } }),
    persistCoverImage: async () => { calls.persist++; return null; },
    resolveLatchReport: async () => ({ armedProducer: false, armed: false }),
    clipframeWaitMs: 0,
    env: { MEGA_COVER_ORIGIN: COVER_ORIGIN },
    ...overrides,
  };
  return { deps, calls };
}

// drive the rt_* chain like the real tick does: run one stage, merge its dossierPatch, advance
async function driveChain(job, deps, env) {
  const chain = [rt_compass, rt_s5case, rt_s5keywords, rt_s5search, rt_s5triage, rt_s5clipframe, rt_s6slots, rt_s7compose];
  const results = [];
  for (const stage of chain) {
    const r = await stage(job, { origin: 'http://mock', _deps: deps, env });
    results.push(r);
    if (r?.dossierPatch) job.dossier = { ...job.dossier, ...r.dossierPatch };
    if (r?.status === 'failed') break;
  }
  return results;
}

const seedJob = (title = 'หัวข่าวทดสอบคิว', content = bodyOf(250)) => ({
  id: 'MG-JOB',
  status: 'running',
  stage: 'rt_compass',
  dossier: { desk: { title, lane: '', category: '' }, extract: { text: content, chars: content.length }, generate: { newsData: { newsTitle: title, newsBody: content } } },
});

// ============================================================ 1 — enqueue multi
test('1 enqueue: หลายข่าวในคำขอเดียว → N jobs seed ถูกต้อง (stage rt_compass, pending, dossier ครบ)', async () => {
  const store = mkStore();
  const body = {
    mode: 'queue',
    items: [
      { newsTitle: 'ข่าวหนึ่ง', content: bodyOf(200) },
      { newsTitle: 'ข่าวสอง', content: bodyOf(300), forceTemplateId: 'REF-lock-2' },
    ],
  };
  const { status, body: out } = await enqueueRefTest(body, { newJob: store.newJob, updateJob: store.updateJob });
  assert.strictEqual(status, 200);
  assert.strictEqual(out.success, true);
  assert.strictEqual(out.jobs.length, 2, 'exactly 2 jobs created');
  assert.deepStrictEqual(out.jobs.map((j) => j.title), ['ข่าวหนึ่ง', 'ข่าวสอง']);
  // seed correctness
  const j1 = store.rows.get(out.jobs[0].jobId);
  const j2 = store.rows.get(out.jobs[1].jobId);
  assert.strictEqual(j1.stage, 'rt_compass');
  assert.strictEqual(j1.status, 'pending');
  assert.strictEqual(j1.dossier.desk.title, 'ข่าวหนึ่ง');
  assert.strictEqual(j1.dossier.extract.text, bodyOf(200));
  assert.strictEqual(j1.dossier.extract.chars, 200);
  assert.strictEqual(j1.dossier.generate.newsData.newsBody, bodyOf(200));
  assert.ok(!j1.dossier.refIdLock, 'no refIdLock when not given');
  assert.strictEqual(j2.dossier.refIdLock, 'REF-lock-2', 'forceTemplateId → refIdLock');
});

test('1b enqueue: รายการเสียไม่ล้มทั้งชุด — รายการผ่านเข้าคิว, รายการพังรายงานใน rejected ต่อรายการ', async () => {
  const store = mkStore();
  const body = { mode: 'queue', items: [{ newsTitle: 'ดี', content: bodyOf(250) }, { newsTitle: 'สั้น', content: bodyOf(50) }] };
  const { status, body: out } = await enqueueRefTest(body, { newJob: store.newJob, updateJob: store.updateJob });
  assert.strictEqual(status, 200);
  assert.strictEqual(out.success, true);
  assert.strictEqual(out.jobs.length, 1, 'valid item queued');
  assert.strictEqual(out.jobs[0].title, 'ดี');
  assert.strictEqual(out.rejected.length, 1, 'invalid item reported per-item');
  assert.strictEqual(out.rejected[0].index, 1);
  assert.match(out.rejected[0].error, /รายการที่ 2/);
  assert.strictEqual(store.rows.size, 1, 'only the valid item created a job');
});

test('1b2 enqueue: พังหมดทุกรายการ → 400 NO_CONTENT (สัญญาสายเดี่ยวเดิม: error+itemIndex ของรายการแรก) + rejected ครบ', async () => {
  const store = mkStore();
  const body = { mode: 'queue', items: [{ newsTitle: 'สั้น1', content: bodyOf(50) }, { newsTitle: 'สั้น2', content: bodyOf(60) }] };
  const { status, body: out } = await enqueueRefTest(body, { newJob: store.newJob, updateJob: store.updateJob });
  assert.strictEqual(status, 400);
  assert.strictEqual(out.errorType, 'NO_CONTENT');
  assert.strictEqual(out.itemIndex, 0);
  assert.strictEqual(out.rejected.length, 2, 'every invalid item reported');
  assert.strictEqual(store.rows.size, 0, 'no jobs created when all items invalid');
});

test('1c enqueue: top-level เดี่ยว (ไม่มี items) ก็ต่อคิวได้', async () => {
  const store = mkStore();
  const { status, body: out } = await enqueueRefTest({ mode: 'queue', newsTitle: 'เดี่ยว', content: bodyOf(200) }, { newJob: store.newJob, updateJob: store.updateJob });
  assert.strictEqual(status, 200);
  assert.strictEqual(out.jobs.length, 1);
});

// ============================================================ 2 — rt_* chain
test('2 tick chain: rt_* เดินครบจนได้ปก (done) ด้วย stub — s7 ยิงคิวครั้งเดียว, archive ครั้งเดียว', async () => {
  const { deps, calls } = mkChainDeps();
  const job = seedJob();
  const results = await driveChain(job, deps, deps.env);
  assert.strictEqual(results.length, 8, 'all 8 stages ran');
  for (const r of results) assert.notStrictEqual(r.status, 'failed', `stage did not fail: ${r.summary || ''}`);
  const last = results[results.length - 1];
  assert.strictEqual(last.status, 'done');
  assert.strictEqual(last.nextAction, 'continue');
  assert.strictEqual(last.dossierPatch.cover.productionQcPass, true);
  assert.strictEqual(last.dossierPatch.cover.archiveId, 'ARC-1');
  assert.strictEqual(last.dossierPatch.cover.queueJobId, 'Q1', 's7 cover carry preserved');
  assert.strictEqual(calls.s7_cover, 1, 's7 ran once');
  assert.strictEqual(calls.compose, 1, 'compose once');
  assert.strictEqual(calls.archive, 1, 'archive once');
  assert.strictEqual(calls.s5_search, 2, 's5_search looped until non-wait');
  assert.strictEqual(fetchBombCalls, 0, 'no real network');
});

test('2b rt_s7compose: QC ไม่ผ่าน → failed QC_REJECTED, archive 0 (zero-archive คงเดิม)', async () => {
  const { deps, calls } = mkChainDeps({ evaluateCoverQc: () => ({ pass: false, reasons: ['blank_image'] }) });
  const job = seedJob();
  const results = await driveChain(job, deps, deps.env);
  const last = results[results.length - 1];
  assert.strictEqual(last.status, 'failed');
  assert.match(last.summary, /QC_REJECTED/);
  assert.strictEqual(calls.archive, 0, 'no archive on QC fail');
});

test('2c rt_s6slots: S6 waiting/HOLD → failed พร้อม summary ระบุ HOLD (โหมดคิวไม่มี 422)', async () => {
  const { deps } = mkChainDeps({ s6_slots: async () => ({ status: 'waiting', nextAction: 'wait', summary: 'ยังไม่พร้อม', dossierPatch: { pickImages: { refHeroV2: { ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' } } } }) });
  const r = await rt_s6slots(seedJob(), { origin: 'm', _deps: deps });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.nextAction, 'fail');
  assert.match(r.summary, /REF_HERO_V2_INSUFFICIENT_CAST_ASSETS/);
});

test('2d rt_s7compose: seam reject (ยิงคิวสองครั้ง) → failed STRICT_SEAM_REJECT', async () => {
  const { deps } = mkChainDeps({
    s7_cover: async (job, { _deps } = {}) => {
      await _deps.fetchJson(`${COVER_ORIGIN}/api/queue/add`, { method: 'POST', body: JSON.stringify({ slotPlan: [] }) });
      await _deps.fetchJson(`${COVER_ORIGIN}/api/queue/add`, { method: 'POST', body: JSON.stringify({ slotPlan: [] }) });
      return { status: 'done', nextAction: 'continue' };
    },
  });
  const job = seedJob();
  job.dossier.images = { caseId: 'RT-CASE' };
  const r = await rt_s7compose(job, { origin: 'm', _deps: deps, env: deps.env });
  assert.strictEqual(r.status, 'failed');
  assert.match(r.summary, /SEAM_SECOND_QUEUE_CALL|STRICT_SEAM_REJECT/);
});

// ============================================================ 3 — cancel
test('3 cancel: pending/waiting/running → cancelled (terminal); done → 409; tick picker ไม่หยิบ cancelled', async () => {
  for (const st of ['pending', 'waiting', 'running']) {
    const store = mkStore([{ id: 'MG-0001', status: st, stage: 'rt_compass', dossier: {} }]);
    const { status, body: out } = await cancelRefTestJob('MG-0001', { getJob: store.getJob, updateJob: store.updateJob });
    assert.strictEqual(status, 200, `${st} cancellable`);
    assert.strictEqual(out.job.status, 'cancelled');
    // tick picker หยิบเฉพาะ running/waiting/pending — cancelled อยู่นอกชุด
    assert.ok(!['running', 'waiting', 'pending'].includes('cancelled'), 'cancelled not pickable');
  }
  const store2 = mkStore([{ id: 'MG-0002', status: 'cover_ready', stage: 'cover_ready', dossier: {} }]);
  const done = await cancelRefTestJob('MG-0002', { getJob: store2.getJob, updateJob: store2.updateJob });
  assert.strictEqual(done.status, 409, 'terminal job not cancellable');
  assert.strictEqual(done.body.errorType, 'NOT_CANCELLABLE');
  const missing = await cancelRefTestJob('NOPE', { getJob: store2.getJob, updateJob: store2.updateJob });
  assert.strictEqual(missing.status, 404);
});

// ============================================================ 4 — duplicate
test('4 duplicate: clone seed dossier (desk/extract/generate/refIdLock) เป็น job ใหม่ pending rt_compass', async () => {
  const src = { id: 'MG-0001', status: 'failed', mode: 'reftest', stage: 'rt_s6slots', dossier: {
    desk: { title: 'ต้นฉบับ', lane: '', category: '' },
    extract: { text: bodyOf(200), chars: 200 },
    generate: { newsData: { newsTitle: 'ต้นฉบับ', newsBody: bodyOf(200) } },
    refIdLock: 'REF-9',
    // ค่าที่ไม่ควร clone (ผลระหว่างทาง)
    pickImages: { slots: { hero: {} } }, compass: { angle: 'x' },
  } };
  const store = mkStore([src]);
  const { status, body: out } = await duplicateRefTestJob('MG-0001', { getJob: store.getJob, newJob: store.newJob, updateJob: store.updateJob });
  assert.strictEqual(status, 200);
  assert.strictEqual(out.sourceId, 'MG-0001');
  const dup = store.rows.get(out.job.id);
  assert.notStrictEqual(out.job.id, 'MG-0001', 'new job id');
  assert.strictEqual(dup.stage, 'rt_compass');
  assert.strictEqual(dup.status, 'pending');
  assert.strictEqual(dup.dossier.desk.title, 'ต้นฉบับ');
  assert.strictEqual(dup.dossier.refIdLock, 'REF-9');
  assert.ok(!dup.dossier.pickImages, 'intermediate pickImages NOT cloned');
  assert.ok(!dup.dossier.compass, 'intermediate compass NOT cloned');
});

// ============================================================ 5 — sync mode parity
test('5 sync mode: runCoverRefTest response shape เดิม (throughMega/effectiveMode/qcVerdict/matchedRef/outputId ครบ)', async () => {
  // full-stub deps (แบบ batch2/ac0099 harness) — happy path ผ่านทุกขั้นถึง 200 success
  const WIRE = JSON.stringify({ composer: 'mega', newsTitle: 'x', slotPlan: [{ url: 'u1' }, { url: 'u2' }], refDNA: null, refImagePath: null });
  const deps = {
    resolveLatchReport: async (e) => ({ canonicalLatch: 'MEGA_STRICT_RENDER', armed: false, armedProducer: false, _source: 'test' }),
    compassBrain: async () => ({ angle: 'a', primaryEmotion: 'warm', mainCharacters: [{ name: 'ก', role: 'hero' }], visualDreamShots: [] }),
    s5_case: async () => ({ status: 'done', nextAction: 'continue', dossierPatch: { images: { caseId: 'RT-CASE' } } }),
    s5_keywords: async () => ({ status: 'done', nextAction: 'continue' }),
    s5_search: async () => ({ status: 'done', nextAction: 'continue' }),
    s5_triage: async () => ({ status: 'done', nextAction: 'continue', dossierPatch: { refMatch: { refId: 'REF-x', dnaHash: 'h', refBoundAt: 't', imagePath: '/r.jpg', styleName: 's', dna: { k: 1 } } } }),
    s5_clipframe: async () => ({ status: 'done', nextAction: 'continue' }),
    s6_slots: async () => ({ status: 'done', nextAction: 'continue', dossierPatch: { pickImages: { slots: { hero: { id: 'A', imageUrl: 'u1' } }, slotOrder: ['hero'], heroSlotId: 'hero', slotContractHash: 'sc' } } }),
    s7_cover: async (job, { _deps } = {}) => { await _deps.fetchJson('http://localhost:3000/api/queue/add', { method: 'POST', body: WIRE }); return { status: 'done', nextAction: 'continue' }; },
    composeAndVerify: async () => ({ success: true, base64: 'data:image/jpeg;base64,QUJD', template: 'ref_dna', caseId: 'RT-CASE', qcFlags: [], refSimilarity: 90 }),
    evaluateCoverQc: () => ({ pass: true, reasons: [] }),
    readImageCase: async () => ({ httpStatus: 200, success: true, images: [] }),
    loadArchive: async () => ({ addMegaCover: async () => ({ id: 'ARC-1' }) }),
    persistCoverImage: async () => null,
    clipframeWaitMs: 0,
    env: {},
  };
  const res = await runCoverRefTest({ content: bodyOf(250), newsTitle: 'หัวข่าว' }, deps);
  assert.strictEqual(res.status, 200, `sync happy path 200 (got ${res.status} ${JSON.stringify(res.body?.errorType)})`);
  const b = res.body;
  assert.strictEqual(b.success, true);
  assert.strictEqual(b.throughMega, true);
  assert.strictEqual(b.effectiveMode, 'preview_advisory', 'non-strict → preview_advisory (unchanged label)');
  assert.strictEqual(b.renderMode, 'legacy');
  assert.strictEqual(b.productionQcPass, true);
  assert.strictEqual(b.qcVerdict.pass, true);
  assert.strictEqual(b.matchedRef.refId, 'REF-x');
  assert.strictEqual(b.imageCaseId, 'RT-CASE');
  assert.ok(typeof b.outputId === 'string' && b.outputId, 'outputId present');
  assert.ok(Array.isArray(b.sourceLinks) && b.sourceLinks.length === 2, 'sourceLinks from slotPlan urls');
  assert.ok(Array.isArray(b.trace) && b.trace.length > 0, 'trace present');
});

test('z restore fetch descriptor', () => {
  if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC); else delete globalThis.fetch;
});
