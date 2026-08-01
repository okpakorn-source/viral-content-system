// ============================================================
// 🛑 เทสพฤติกรรมจริงของสวิตช์โต๊ะข่าว (31 ก.ค. 69 — ผู้ตรวจรอบ 2 เรียกร้อง)
// ------------------------------------------------------------
// presence test พิสูจน์แค่ "มีข้อความ guard ในไฟล์" — ไฟล์นี้พิสูจน์ "พฤติกรรมจริง":
//   ปิด (default) → โค้ดเผาเงินข้างในต้องไม่ถูกเรียกแม้ครั้งเดียว
//   เปิด (DESK_PIPELINE=1) → โค้ดเดิมกลับมาถูกเรียกตามปกติ
// ครอบ 3 เส้นหลัก (dispatch cron / mine-clip / consult) + ส่วนเสียเงินแฝงของปุ่มไวรัล
// แพทเทิร์น register-stub เดียวกับ tests/batch2-v2-failfast.test.mjs — ห้ามมี network/LLM จริง
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (src) => 'data:text/javascript,' + encodeURIComponent(src);

const STUB_NEXT = _mod(`
export const NextResponse = { json: (body, init) => ({ _body: body, status: (init && init.status) || 200 }) };
`);
// ตัวนับกลาง — ทุก stub รายงานเข้า globalThis.__REOPEN
const STUB_OUTBOX = _mod(`
export async function dispatchOne() { globalThis.__REOPEN.dispatchOne++; return { released: 0, held: false }; }
`);
const STUB_WATCHDOG = _mod(`
export async function sweepDeadWork() { globalThis.__REOPEN.sweep++; return { swept: 0 }; }
`);
const STUB_MINER = _mod(`
export async function mineClip() { globalThis.__REOPEN.mineClip++; return { id: 'MC1', title: 'คลิปทดสอบ', judgeScore: 6, goldenMoments: [], fullText: 'x' }; }
`);
// ★ ผู้ตรวจรอบ 3: เส้น production (non-win32) ของ mine-clip โหลด queueService แบบ dynamic — ต้อง stub กันหลุดไปของจริง
const STUB_QUEUESVC = _mod(`
export async function enqueueJob() { globalThis.__REOPEN.enqueue++; return { jobId: 'QJ1' }; }
`);
const STUB_STORE = _mod(`
const item = { id: 'N1', title: 'ข่าวทดสอบ', status: 'new', category: 'บันเทิง' };
export function createStore() {
  return {
    getAll: async () => [item],
    get: async () => ({ ...item }),
    add: async (r) => { globalThis.__REOPEN.storeAdd++; return r; },
    update: async (id, fn) => { globalThis.__REOPEN.storeUpdate++; return typeof fn === 'function' ? fn({ ...item }) : { ...item }; },
  };
}
`);
const STUB_BRAIN = _mod(`
export function applyMixGovernor(items) { return { items, governor: {} }; }
export function applyDiscoveryRanking(items) { return items; }
export async function consultSpecialist() { globalThis.__REOPEN.consult++; return { verdict: 'ok' }; }
`);
const STUB_TAXONOMY = _mod(`
export function enrichDeskItem(x) { return x; }
export function isClip() { return false; }
export const LIBRARY_KEYS = [];
export const CLIP_SOURCES = [];
`);
const STUB_WATCHLIST = _mod(`
export async function addFromTitle() { globalThis.__REOPEN.addFromTitle++; return { added: true }; }
`);
const STUB_GENERIC_AGENT = _mod(`
export async function deepResearch() { globalThis.__REOPEN.research++; return {}; }
export async function reframeNews() { globalThis.__REOPEN.reframe++; return {}; }
`);

const hook = `
export async function resolve(specifier, ctx, next) {
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier === '@/lib/services/deskV2/editorOutbox.js') return { url: ${JSON.stringify(STUB_OUTBOX)}, shortCircuit: true };
  if (specifier === '@/lib/services/deskV2/deskWatchdog.js') return { url: ${JSON.stringify(STUB_WATCHDOG)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/interviewMiner') return { url: ${JSON.stringify(STUB_MINER)}, shortCircuit: true };
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/deskBrain') return { url: ${JSON.stringify(STUB_BRAIN)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/taxonomy') return { url: ${JSON.stringify(STUB_TAXONOMY)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/watchlistService') return { url: ${JSON.stringify(STUB_WATCHLIST)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/researchAgent') return { url: ${JSON.stringify(STUB_GENERIC_AGENT)}, shortCircuit: true };
  if (specifier === '@/lib/services/newsDesk/reframeEngine') return { url: ${JSON.stringify(STUB_GENERIC_AGENT)}, shortCircuit: true };
  if (specifier === '@/lib/services/queueService') return { url: ${JSON.stringify(STUB_QUEUESVC)}, shortCircuit: true };
  if (specifier === '@/lib/deskPipelineGate') {
    // ตัวเดียวที่อนุญาตให้เป็นของจริง — มันคือหน่วยที่กำลังทดสอบ
    return next(new URL('../src/lib/deskPipelineGate.js', ${JSON.stringify(import.meta.url)}).href, ctx);
  }
  if (specifier.startsWith('@/')) {
    // ★ ผู้ตรวจรอบ 3: ห้าม fail-open ไปโหลดโมดูลจริง — เจอ '@/' ที่ไม่รู้จัก = ระเบิดทันที ให้คนเติม stub
    throw new Error('UNSTUBBED_IMPORT_FORBIDDEN: ' + specifier);
  }
  return next(specifier, ctx);
}
`;
register(_mod(hook));

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };

const { GET: dispatchGET } = await import('../src/app/api/desk/editor/dispatch/route.js');
const { POST: mineClipPOST } = await import('../src/app/api/news-desk/mine-clip/route.js');
const { POST: deskPOST } = await import('../src/app/api/news-desk/route.js');

const mkReq = (body) => ({ json: async () => body, nextUrl: { origin: 'http://test-origin' } });
function withDesk(v, fn) {
  return async () => {
    const saved = process.env.DESK_PIPELINE;
    if (v === undefined) delete process.env.DESK_PIPELINE; else process.env.DESK_PIPELINE = v;
    globalThis.__REOPEN = { dispatchOne: 0, sweep: 0, mineClip: 0, consult: 0, addFromTitle: 0, storeAdd: 0, storeUpdate: 0, research: 0, reframe: 0, enqueue: 0 };
    try { return await fn(); } finally {
      if (saved === undefined) delete process.env.DESK_PIPELINE; else process.env.DESK_PIPELINE = saved;
      delete globalThis.__REOPEN;
    }
  };
}

test('ปิด (default): dispatch cron → skipped และ dispatchOne/sweep ไม่ถูกเรียกเลย', withDesk(undefined, async () => {
  const res = await dispatchGET(mkReq({}));
  assert.strictEqual(res.status, 200, 'cron ต้องได้ 200 ไม่ใช่ error');
  assert.ok(res._body.skipped, 'ต้องบอกชัดว่า skipped');
  assert.strictEqual(globalThis.__REOPEN.dispatchOne, 0);
  assert.strictEqual(globalThis.__REOPEN.sweep, 0);
}));

test('เปิด (=1): dispatch cron → dispatchOne ถูกเรียกจริง', withDesk('1', async () => {
  const res = await dispatchGET(mkReq({}));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__REOPEN.dispatchOne, 1, 'เปิดแล้วต้องปล่อยงานจริง');
}));

test('ปิด: mine-clip → 503 และ mineClip ไม่ถูกเรียก', withDesk(undefined, async () => {
  const res = await mineClipPOST(mkReq({ url: 'https://example.com/clip' }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res._body.errorType, 'DESK_PIPELINE_DISABLED');
  assert.strictEqual(globalThis.__REOPEN.mineClip, 0);
}));

test('เปิด: mine-clip → mineClip ถูกเรียกจริง + ผลถูกบันทึกลงคลัง (ผู้ตรวจรอบ 3 สั่งรัด)', withDesk('1', async () => {
  const res = await mineClipPOST(mkReq({ url: 'https://example.com/clip' }));
  assert.notStrictEqual(res.status, 503);
  assert.strictEqual(res._body.success, true, 'เส้นเปิดต้องจบงานสำเร็จจริง ไม่ใช่แค่ไม่ 503');
  assert.strictEqual(globalThis.__REOPEN.mineClip, 1);
  assert.ok(globalThis.__REOPEN.storeAdd + globalThis.__REOPEN.storeUpdate >= 1, 'ผลขุดต้องถูกเก็บลงคลังจริง');
}));

// ★ ผู้ตรวจรอบ 3: เส้น production (non-win32) — mine-clip ส่งเข้าคิวกลางแทนการขุดเอง ต้องถูกสวิตช์คุมเหมือนกัน
function withPlatform(plat, fn) {
  return async () => {
    const desc = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: plat, configurable: true });
    try { return await fn(); } finally { Object.defineProperty(process, 'platform', desc); }
  };
}

test('ปิด (จำลองคลาวด์ linux): mine-clip → 503 และไม่ enqueue เข้าคิวกลางเลย', withDesk(undefined, () => withPlatform('linux', async () => {
  const res = await mineClipPOST(mkReq({ url: 'https://example.com/clip' }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(globalThis.__REOPEN.enqueue, 0, 'ปิดแล้วห้ามส่งงานเข้าคิวกลาง');
  assert.strictEqual(globalThis.__REOPEN.mineClip, 0);
})()));

test('เปิด (จำลองคลาวด์ linux): mine-clip → enqueue เข้าคิวกลางตามพฤติกรรมเดิม', withDesk('1', () => withPlatform('linux', async () => {
  const res = await mineClipPOST(mkReq({ url: 'https://example.com/clip' }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(res._body.queued, true, 'ฝั่งคลาวด์ต้องตอบว่าส่งคิวแล้ว');
  assert.strictEqual(globalThis.__REOPEN.enqueue, 1);
  assert.strictEqual(globalThis.__REOPEN.mineClip, 0, 'ฝั่งคลาวด์ไม่ขุดเอง');
})()));

test('ปิด: news-desk consult → 503 และ consultSpecialist ไม่ถูกเรียก', withDesk(undefined, async () => {
  const res = await deskPOST(mkReq({ action: 'consult', id: 'N1' }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(globalThis.__REOPEN.consult, 0);
}));

test('เปิด: news-desk consult → consultSpecialist ถูกเรียก + ผลถูกเก็บ', withDesk('1', async () => {
  const res = await deskPOST(mkReq({ action: 'consult', id: 'N1' }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__REOPEN.consult, 1);
  assert.ok(globalThis.__REOPEN.storeUpdate >= 1, 'ผล consult ต้องถูกบันทึก');
}));

test('ปิด: ปุ่มไวรัล — การ์ดยังตีป้ายได้ (ฟรี) แต่ addFromTitle (AI) ต้องไม่ถูกเรียก', withDesk(undefined, async () => {
  const res = await deskPOST(mkReq({ action: 'viral', id: 'N1' }));
  assert.strictEqual(res._body.success, true, 'ส่วนฟรีของปุ่มไวรัลต้องยังทำงาน');
  assert.strictEqual(globalThis.__REOPEN.addFromTitle, 0, 'ส่วนเสียเงิน (Watchlist ผ่าน AI) ต้องถูกข้าม');
}));

test('เปิด: ปุ่มไวรัล → addFromTitle กลับมาทำงานตามเดิม', withDesk('1', async () => {
  const res = await deskPOST(mkReq({ action: 'viral', id: 'N1' }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__REOPEN.addFromTitle, 1);
}));
