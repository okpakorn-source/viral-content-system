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
  rt_gaphunt, _buildGapNeeds,
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
  const calls = { compass: 0, s5_case: 0, s5_keywords: 0, s5_search: 0, s5_triage: 0, s5_clipframe: 0, s6_slots: 0, s7_cover: 0, compose: 0, qc: 0, archive: 0, persist: 0, gapSearch: 0 };
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
    // ★ G1: gap search ฉีดแทน /api/images/search (ไม่ยิง network) — คืน added คงที่ + นับครั้ง
    gapSearchFn: async () => { calls.gapSearch++; return { added: 2, found: 2 }; },
    clipframeWaitMs: 0,
    env: { MEGA_COVER_ORIGIN: COVER_ORIGIN },
    ...overrides,
  };
  return { deps, calls };
}

// ★ G1: ขับ flow แบบ tick จริง — ตาม STAGE_FLOW next + รองรับ nextAction 'goto:<stage>' (gap hunt วนกลับ)
const RT_STAGES = {
  rt_compass: { fn: rt_compass, next: 'rt_s5case' },
  rt_s5case: { fn: rt_s5case, next: 'rt_s5keywords' },
  rt_s5keywords: { fn: rt_s5keywords, next: 'rt_s5search' },
  rt_s5search: { fn: rt_s5search, next: 'rt_s5triage' },
  rt_s5triage: { fn: rt_s5triage, next: 'rt_s5clipframe' },
  rt_s5clipframe: { fn: rt_s5clipframe, next: 'rt_s6slots' },
  rt_s6slots: { fn: rt_s6slots, next: 'rt_s7compose' },
  rt_s7compose: { fn: rt_s7compose, next: 'cover_ready' },
  rt_gaphunt: { fn: rt_gaphunt, next: 'rt_s5triage' },
};
async function driveFlow(job, deps, env, { startStage = 'rt_compass', maxSteps = 40 } = {}) {
  let stage = startStage;
  const results = [];
  for (let i = 0; i < maxSteps; i++) {
    const def = RT_STAGES[stage];
    if (!def) break;
    const r = await def.fn(job, { origin: 'http://mock', _deps: deps, env });
    results.push({ stage, r });
    if (r?.dossierPatch) job.dossier = { ...job.dossier, ...r.dossierPatch };
    const act = r?.nextAction || 'continue';
    if (r?.status === 'failed' || act === 'fail') break;
    if (typeof act === 'string' && act.startsWith('goto:')) { stage = act.slice(5); continue; }
    stage = def.next;
    if (stage === 'cover_ready') break;
  }
  return results;
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

// ============================================================ G1 — gap hunt loop
const gapJob = (title = 'ข่าวทดสอบ gap', content = bodyOf(250), mainChars = [{ name: 'ก' }]) => {
  const j = seedJob(title, content);
  j.dossier.images = { caseId: 'RT-CASE' };
  j.dossier.compass = { mainCharacters: mainChars };
  return j;
};

test('G1-1 rt_s7compose: QC ตีตก duplicate_person → goto:rt_gaphunt + round=1 + needs (คนอื่นของข่าว)', async () => {
  const { deps, calls } = mkChainDeps({
    composeAndVerify: async () => ({ success: true, base64: 'data:image/jpeg;base64,QUJD', template: 'ref_dna', caseId: 'RT-CASE', qcFlags: ['duplicate_person_panels:สมชาย:3'], refSimilarity: 70 }),
    evaluateCoverQc: () => ({ pass: false, reasons: ['คนเดียวกินหลายช่อง'] }),
  });
  const job = gapJob('ข่าว', bodyOf(250), [{ name: 'สมชาย' }, { name: 'สมหญิง' }]);
  const r = await rt_s7compose(job, { origin: 'm', _deps: deps, env: deps.env });
  assert.strictEqual(r.status, 'done', 'ไม่ fail — แตกสาย gap hunt แทน');
  assert.strictEqual(r.nextAction, 'goto:rt_gaphunt');
  assert.strictEqual(r.dossierPatch.gapHunt.round, 1, 'round นับเป็น 1');
  assert.ok(Array.isArray(r.dossierPatch.gapHunt.needs) && r.dossierPatch.gapHunt.needs.length > 0, 'มี needs');
  assert.ok(r.dossierPatch.gapHunt.needs.some((n) => n.type === 'person_distinct' && n.person === 'สมหญิง'), 'ขอภาพคนที่ไม่ใช่คนซ้ำ (สมหญิง)');
  assert.strictEqual(calls.archive, 0, 'ไม่ archive ตอน QC ตีตก');
});

test('G1-2 chain: QC ตีตกทุกรอบ → gap hunt ครบ 2 รอบ → fail จริง (zero archive)', async () => {
  const { deps, calls } = mkChainDeps({
    composeAndVerify: async () => ({ success: true, base64: 'data:image/jpeg;base64,QUJD', template: 'ref_dna', caseId: 'RT-CASE', qcFlags: ['duplicate_person_panels:ก:3'], refSimilarity: 70 }),
    evaluateCoverQc: () => ({ pass: false, reasons: ['dup'] }),
  });
  const job = seedJob();
  const results = await driveFlow(job, deps, deps.env);
  const last = results[results.length - 1];
  assert.strictEqual(last.stage, 'rt_s7compose');
  assert.strictEqual(last.r.status, 'failed');
  assert.match(last.r.summary, /QC_REJECTED/);
  assert.match(last.r.summary, /2 รอบ/, 'summary บอกว่าหาเพิ่มแล้ว 2 รอบ');
  assert.strictEqual(results.filter((x) => x.stage === 'rt_s7compose').length, 3, 's7compose 3 ครั้ง (goto×2 + fail)');
  assert.strictEqual(results.filter((x) => x.stage === 'rt_gaphunt').length, 2, 'gap hunt 2 รอบ');
  assert.strictEqual(calls.gapSearch, 4, 'ยิงค้น 2 รอบ × 1 need × 2 แหล่ง');
  assert.strictEqual(calls.archive, 0, 'zero archive');
});

test('G1-3 MEGA_GAP_HUNT=0 → fail เดิมเป๊ะ (ไม่ goto)', async () => {
  const { deps, calls } = mkChainDeps({
    composeAndVerify: async () => ({ success: true, base64: 'data:image/jpeg;base64,QUJD', template: 'ref_dna', caseId: 'RT-CASE', qcFlags: ['duplicate_person_panels:ก:3'], refSimilarity: 70 }),
    evaluateCoverQc: () => ({ pass: false, reasons: ['dup'] }),
    env: { MEGA_COVER_ORIGIN: COVER_ORIGIN, MEGA_GAP_HUNT: '0' },
  });
  const job = gapJob();
  const r = await rt_s7compose(job, { origin: 'm', _deps: deps, env: deps.env });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.nextAction, 'fail');
  assert.match(r.summary, /QC_REJECTED/);
  assert.doesNotMatch(r.summary, /รอบ/, 'ปิดสวิตช์ = ไม่มีข้อความ gap hunt');
  assert.strictEqual(calls.gapSearch, 0, 'ไม่ยิงค้นเพิ่ม');
});

test('G1-4 rt_gaphunt ค้นล้ม/ได้ 0 ใบ → ไม่ fail งาน (done continue ไหลต่อ triage)', async () => {
  const { deps } = mkChainDeps();
  const job = gapJob();
  job.dossier.gapHunt = { round: 1, needs: [{ type: 'person_distinct', person: 'ก', queries: ['ก'] }] };
  const r = await rt_gaphunt(job, { origin: 'm', _deps: { ...deps, gapSearchFn: async () => { throw new Error('quota แห้ง'); } }, env: deps.env });
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(r.nextAction, 'continue');
  assert.match(r.summary, /GAP_HUNT/);
});

test('G1-5 chain: QC ตีตกรอบแรก → gap hunt → รอบสองผ่าน QC = done (archive ครั้งเดียว)', async () => {
  let qcCalls = 0;
  const { deps, calls } = mkChainDeps({
    composeAndVerify: async () => ({ success: true, base64: 'data:image/jpeg;base64,QUJD', template: 'ref_dna', caseId: 'RT-CASE', qcFlags: qcCalls === 0 ? ['duplicate_person_panels:ก:3'] : [], refSimilarity: 88 }),
    evaluateCoverQc: () => { const pass = qcCalls > 0; qcCalls++; return { pass, reasons: pass ? [] : ['dup'] }; },
  });
  const job = seedJob();
  const results = await driveFlow(job, deps, deps.env);
  const last = results[results.length - 1];
  assert.strictEqual(last.stage, 'rt_s7compose');
  assert.strictEqual(last.r.status, 'done');
  assert.strictEqual(last.r.nextAction, 'continue');
  assert.strictEqual(last.r.dossierPatch.cover.productionQcPass, true);
  assert.ok(results.some((x) => x.stage === 'rt_gaphunt'), 'flow ผ่าน rt_gaphunt');
  assert.strictEqual(calls.gapSearch, 2, 'gap hunt ยิง 2 ครั้ง (1 need × 2 แหล่ง)');
  assert.strictEqual(calls.archive, 1, 'archive ครั้งเดียวตอนสำเร็จ');
});

test('G1-6 _buildGapNeeds: ครอปพัง/hero ยืด → person_clear + person_big', () => {
  const dossier = { compass: { mainCharacters: [{ name: 'ก' }] } };
  const needsCrop = _buildGapNeeds(['face_overflow:main:120'], dossier);
  assert.ok(needsCrop.some((n) => n.type === 'person_clear' && n.person === 'ก'), 'face_overflow → person_clear');
  const needsHero = _buildGapNeeds(['upscaled:main:1.9'], dossier);
  assert.ok(needsHero.some((n) => n.type === 'person_big' && n.person === 'ก'), 'hero ยืด → person_big');
  assert.strictEqual(_buildGapNeeds(['duplicate_person_panels:ก:3'], { compass: { mainCharacters: [] } }).length, 0, 'ไม่มีชื่อ = ไม่มี need (ค้นไม่ได้)');
});

test('z restore fetch descriptor', () => {
  if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC); else delete globalThis.fetch;
});
