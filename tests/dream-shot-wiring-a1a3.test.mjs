// ============================================================
// 🧪 dream-shot-wiring-a1a3.test.mjs — เฟส A batch ข้อ 1+3 (29 ก.ค. 69, ปิดเงื่อนไข Opus)
// ------------------------------------------------------------
// ข้อ 1: s5_keywords (megaAdapters.js) ส่ง job.dossier.compass เข้า body ของ /api/keywords + เก็บ
//   dream_shot_queries จากคำตอบเป็น dossier.images.dreamQueries (แพทเทิร์นเดียวกับ storyQueries)
// ข้อ 3: s5_search ส่ง dreamQueries (จากข้อ 1) เข้า body ของ /api/images/search
// ทั้งคู่อยู่ใต้ kill-switch เดียว MEGA_DREAM_WIRING (default ON, '0' = byte-parity เดิม ไม่ส่ง compass/dreamQueries เลย)
// harness: s5_keywords stub globalThis.fetch (แพทเทิร์นเดียวกับ tests/s5-keywords-empty-guard.test.mjs) ·
//   s5_search ใช้ _deps.fetchJson injection (test seam ที่มีอยู่แล้วในฟังก์ชัน) + MEGA_YT_PARALLEL=0 (เลี่ยง
//   fire-and-forget raw fetch ไปที่ /api/images/youtube ซึ่งไม่เกี่ยวกับเทสนี้)
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

const setEnv = (k, v) => { if (v === null) delete process.env[k]; else process.env[k] = v; };

const EMPTY_KW = {
  queries_th: ['สมชาย สัมภาษณ์'], queries_en: [], object_queries: [], moment_action: [], scene_place: [],
  relationship_archive: [], lifestyle_travel: [], family_album: [], landmark_context: [],
  emotion: [], source_show: [], subjects: [{ name: 'สมชาย' }],
};

let capturedFetchBody = null;
function stubFetch(payload) {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true, writable: true,
    value: async (url, opts) => {
      capturedFetchBody = opts?.body ? JSON.parse(opts.body) : null;
      return { status: 200, json: async () => payload };
    },
  });
}
function restoreFetch() {
  if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC);
}

// ═══════════════════════════ ข้อ 1: s5_keywords ═══════════════════════════

test('ข้อ 1 (default ON): มี job.dossier.compass → ถูกส่งเข้า body ของ /api/keywords เป็น key "compass"', async () => {
  setEnv('MEGA_DREAM_WIRING', null);
  stubFetch({ success: true, keywords: { ...EMPTY_KW } });
  try {
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const compass = { angle: 'ซึ้ง', visualDreamShots: [{ slot: 'hero', description: 'ยืนหน้าบ้านเก่า' }] };
    await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' }, compass } }, { origin: 'http://stub' });
    assert.deepEqual(capturedFetchBody.compass, compass, 'compass ต้องถูกส่งไปทั้งก้อนตรงๆ');
    assert.equal(capturedFetchBody.caseId, 'AC-TEST');
  } finally { restoreFetch(); }
});

test('ข้อ 1: ไม่มี job.dossier.compass เลย → body ไม่มี key "compass" เลย (พฤติกรรมเดิม)', async () => {
  setEnv('MEGA_DREAM_WIRING', null);
  stubFetch({ success: true, keywords: { ...EMPTY_KW } });
  try {
    const { s5_keywords } = await import('@/lib/megaAdapters');
    await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub' });
    assert.ok(!('compass' in capturedFetchBody), 'ไม่มี compass เลย ต้องไม่มี key นี้ใน body');
    assert.deepEqual(capturedFetchBody, { caseId: 'AC-TEST' }, 'body ต้องเหมือนพฤติกรรมเดิมทุกไบต์ (แค่ caseId)');
  } finally { restoreFetch(); }
});

test('ข้อ 1: MEGA_DREAM_WIRING=0 → ไม่ส่ง compass แม้จะมีจริงใน job.dossier.compass (byte-parity เดิม)', async () => {
  setEnv('MEGA_DREAM_WIRING', '0');
  stubFetch({ success: true, keywords: { ...EMPTY_KW } });
  try {
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const compass = { angle: 'ซึ้ง', visualDreamShots: [{ slot: 'hero', description: 'ยืนหน้าบ้านเก่า' }] };
    await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' }, compass } }, { origin: 'http://stub' });
    assert.ok(!('compass' in capturedFetchBody), 'ปิดสวิตช์ต้องไม่ส่ง compass เลย แม้มีจริง');
  } finally { setEnv('MEGA_DREAM_WIRING', null); restoreFetch(); }
});

test('ข้อ 1: คำตอบมี dream_shot_queries → เก็บเข้า dossierPatch.images.dreamQueries (ผูกช่องว่าง/trim เหมือน storyQueries)', async () => {
  setEnv('MEGA_DREAM_WIRING', null);
  stubFetch({ success: true, keywords: { ...EMPTY_KW, dream_shot_queries: ['  สมชายยืนหน้าบ้านเก่า  ', 'สมชายกอดลูก', ''] } });
  try {
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const r = await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' }, compass: { visualDreamShots: [{}] } } }, { origin: 'http://stub' });
    assert.equal(r.status, 'done');
    assert.deepEqual(r.dossierPatch.images.dreamQueries, ['สมชายยืนหน้าบ้านเก่า', 'สมชายกอดลูก'], 'ต้อง trim + ตัดค่าว่างทิ้ง เหมือน storyQueries');
  } finally { restoreFetch(); }
});

test('ข้อ 1: คำตอบไม่มี dream_shot_queries เลย (คำตอบเก่า/ไม่มี compass) → dossierPatch.images.dreamQueries = [] เสมอ ไม่ throw', async () => {
  setEnv('MEGA_DREAM_WIRING', null);
  stubFetch({ success: true, keywords: { ...EMPTY_KW } }); // ไม่มี dream_shot_queries เลย
  try {
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const r = await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub' });
    assert.equal(r.status, 'done');
    assert.deepEqual(r.dossierPatch.images.dreamQueries, []);
  } finally { restoreFetch(); }
});

test('ข้อ 1: MEGA_DREAM_WIRING=0 → dreamQueries เป็น [] เสมอ แม้คำตอบจะมี dream_shot_queries จริง (byte-parity)', async () => {
  setEnv('MEGA_DREAM_WIRING', '0');
  stubFetch({ success: true, keywords: { ...EMPTY_KW, dream_shot_queries: ['ช็อตหลุด'] } });
  try {
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const r = await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub' });
    assert.deepEqual(r.dossierPatch.images.dreamQueries, [], 'ปิดสวิตช์ต้องไม่อ่าน dream_shot_queries เข้ามาเลยแม้ตอบมาจริง');
  } finally { setEnv('MEGA_DREAM_WIRING', null); restoreFetch(); }
});

test('ข้อ 1: dossierPatch.images ฟิลด์อื่นทั้งหมด (keywordsCount/subjects/storyQueries) ไม่เปลี่ยนแปลง — เพิ่ม dreamQueries แบบ additive ล้วน', async () => {
  setEnv('MEGA_DREAM_WIRING', null);
  stubFetch({ success: true, keywords: { ...EMPTY_KW, relationship_archive: ['สมชาย ครอบครัว'] } });
  try {
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const r = await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub' });
    assert.equal(r.dossierPatch.images.keywordsCount, 2); // queries_th 1 + relationship_archive 1
    assert.deepEqual(r.dossierPatch.images.subjects, ['สมชาย']);
    assert.deepEqual(r.dossierPatch.images.storyQueries, ['สมชาย ครอบครัว']);
  } finally { restoreFetch(); }
});

// ═══════════════════════════ ข้อ 3: s5_search ═══════════════════════════

test('ข้อ 3 (default ON): im.dreamQueries มีจริง → ถูกส่งเข้า body ของ /api/images/search เป็น key "dreamQueries"', async () => {
  setEnv('MEGA_DREAM_WIRING', null);
  setEnv('MEGA_YT_PARALLEL', '0'); // เลี่ยง fire-and-forget raw fetch ไป /api/images/youtube (ไม่เกี่ยวกับเทสนี้)
  try {
    const { s5_search } = await import('@/lib/megaAdapters');
    let capturedBody = null;
    const fakeFetchJson = async (url, opts) => { capturedBody = JSON.parse(opts.body); return { success: true, found: 0, added: 0, vetDropped: 0 }; };
    const job = { dossier: { images: { caseId: 'AC-TEST', dreamQueries: ['สมชายยืนหน้าบ้านเก่า', 'สมชายกอดลูก'] } } };
    await s5_search(job, { origin: 'http://stub', _deps: { fetchJson: fakeFetchJson } });
    assert.deepEqual(capturedBody.dreamQueries, ['สมชายยืนหน้าบ้านเก่า', 'สมชายกอดลูก']);
    assert.equal(capturedBody.caseId, 'AC-TEST');
    assert.equal(capturedBody.platform, 'google', 'ต้องเป็นแพลตฟอร์มแรกที่ยังไม่ค้น');
  } finally { setEnv('MEGA_YT_PARALLEL', null); }
});

test('ข้อ 3: ไม่มี im.dreamQueries เลย (undefined/[]) → body ไม่มี key "dreamQueries" เลย (พฤติกรรมเดิม)', async () => {
  setEnv('MEGA_DREAM_WIRING', null);
  setEnv('MEGA_YT_PARALLEL', '0');
  try {
    const { s5_search } = await import('@/lib/megaAdapters');
    let capturedBody = null;
    const fakeFetchJson = async (url, opts) => { capturedBody = JSON.parse(opts.body); return { success: true, found: 0, added: 0, vetDropped: 0 }; };
    await s5_search({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub', _deps: { fetchJson: fakeFetchJson } });
    assert.ok(!('dreamQueries' in capturedBody), 'ไม่มี im.dreamQueries เลย ต้องไม่มี key นี้ใน body');
    assert.deepEqual(capturedBody, { caseId: 'AC-TEST', platform: 'google' }, 'body ต้องเหมือนพฤติกรรมเดิมทุกไบต์');

    let capturedBody2 = null;
    const fakeFetchJson2 = async (url, opts) => { capturedBody2 = JSON.parse(opts.body); return { success: true, found: 0, added: 0, vetDropped: 0 }; };
    await s5_search({ dossier: { images: { caseId: 'AC-TEST', dreamQueries: [] } } }, { origin: 'http://stub', _deps: { fetchJson: fakeFetchJson2 } });
    assert.ok(!('dreamQueries' in capturedBody2), 'dreamQueries=[] (ว่างเปล่า) ก็ต้องไม่ส่ง key นี้ (เท่ากับไม่มี)');
  } finally { setEnv('MEGA_YT_PARALLEL', null); }
});

test('ข้อ 3: MEGA_DREAM_WIRING=0 → ไม่ส่ง dreamQueries แม้ im.dreamQueries จะมีจริง (byte-parity เดิม)', async () => {
  setEnv('MEGA_DREAM_WIRING', '0');
  setEnv('MEGA_YT_PARALLEL', '0');
  try {
    const { s5_search } = await import('@/lib/megaAdapters');
    let capturedBody = null;
    const fakeFetchJson = async (url, opts) => { capturedBody = JSON.parse(opts.body); return { success: true, found: 0, added: 0, vetDropped: 0 }; };
    const job = { dossier: { images: { caseId: 'AC-TEST', dreamQueries: ['สมชายยืนหน้าบ้านเก่า'] } } };
    await s5_search(job, { origin: 'http://stub', _deps: { fetchJson: fakeFetchJson } });
    assert.ok(!('dreamQueries' in capturedBody), 'ปิดสวิตช์ต้องไม่ส่ง dreamQueries เลย แม้มีจริง');
  } finally { setEnv('MEGA_DREAM_WIRING', null); setEnv('MEGA_YT_PARALLEL', null); }
});

console.log('dream-shot-wiring-a1a3: all tests defined via node:test — see summary above');
