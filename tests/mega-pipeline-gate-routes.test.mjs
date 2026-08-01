// ============================================================
// 🛑 เทสระดับ route ของประตูปิดท่อปก MEGA (31 ก.ค. 69)
// ------------------------------------------------------------
// ผู้ตรวจไขว้ชี้ว่า: เทสระดับ lib อย่างเดียวไม่พอ — ถ้าใครถอด guard ออกจาก route จริง เทสจะยังเขียว
// ไฟล์นี้จึงโหลด route จริงพร้อม stub แล้วพิสูจน์ 2 อย่างที่สำคัญที่สุด:
//   ① ท่อปิด (ค่าเริ่มต้น) → งานปกถูกปฏิเสธ 503 และ "ไม่มีการสร้างงานลงคิวเลย" (ไม่ใช่แค่ตอบ error)
//   ② 🔴 งานโต๊ะข่าว desk_* ต้องผ่านตามปกติ — ประตูปกห้ามไปแตะระบบข่าวเด็ดขาด (คำสั่งเจ้าของ 31 ก.ค.)
// แพทเทิร์นสตับ: module hook + register() แบบเดียวกับ tests/batch2-v2-failfast.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (src) => 'data:text/javascript,' + encodeURIComponent(src);

// next/server ปลอม — เก็บ status/body ให้ตรวจได้
const STUB_NEXT = _mod(`
export const NextResponse = {
  json: (body, init) => ({ _body: body, status: (init && init.status) || 200 }),
};
`);

// คิวงานปลอม — จดทุกการเรียก createJob ไว้พิสูจน์ว่า "ท่อปิดแล้วไม่มีงานเกิดขึ้นจริง"
const STUB_JOBS = _mod(`
const g = () => globalThis.__GATE_JOBS || {};
export const createJob = async (...a) => { (globalThis.__GATE_CREATED = globalThis.__GATE_CREATED || []).push(a[0]); return { id: 'JOB1', ...(a[0] || {}) }; };
export const patchJob = async () => null;
export const finishJob = async () => null;
export const listJobs = async () => [];
export const getJob = async () => null;
export const claimTeamJob = async (kinds) => { (globalThis.__GATE_CLAIMS = globalThis.__GATE_CLAIMS || []).push(kinds); return null; };
export const removeJob = async () => null;
export const getBootId = () => 'test-boot';
`);

const STUB_TAXONOMY = _mod(`
export const HARVEST_MODES = [{ key: 'all', label: 'ทุกเลน' }];
export const HARVEST_MODE_KEYS = ['all'];
`);

const hook = `
export async function resolve(specifier, ctx, next) {
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier === '@/lib/quickTestJobs') return { url: ${JSON.stringify(STUB_JOBS)}, shortCircuit: true };
  if (specifier === '@/lib/newsDesk/taxonomy') return { url: ${JSON.stringify(STUB_TAXONOMY)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const base = new URL('../src/' + specifier.slice(2), ${JSON.stringify(import.meta.url)}).href;
    // ★ alias @/ ของโปรเจกต์ไม่มีนามสกุล — เติม .js ให้ ESM resolver เอง (ไม่งั้น ERR_MODULE_NOT_FOUND)
    return next(/\\.(m?js|json)$/.test(base) ? base : base + '.js', ctx);
  }
  return next(specifier, ctx);
}
`;
register(_mod(hook));

// เน็ตเวิร์กเป็นระเบิด — ไม่มีอะไรในเทสนี้ควรยิงออกนอกเครื่อง
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };

const { POST } = await import('../src/app/api/quick-test/route.js');
const mkReq = (body) => ({ json: async () => body, nextUrl: { origin: 'http://test-origin' } });

function reset() { globalThis.__GATE_CREATED = []; globalThis.__GATE_CLAIMS = []; }
// ★ 31 ก.ค. 69 (คำสั่งที่สอง): มีสวิตช์ที่สองแล้ว DESK_PIPELINE — helper รับทั้งคู่ {mega, desk}
//   ไม่ส่ง = ลบ env (ค่าเริ่มต้นจริง = ปิดทั้งคู่ตามคำสั่งเจ้าของ)
function withEnv(envs, fn) {
  const cfg = (envs && typeof envs === 'object' && !Array.isArray(envs)) ? envs : { mega: envs };
  return async () => {
    const KEYS = { mega: 'MEGA_PIPELINE', desk: 'DESK_PIPELINE' };
    const saved = {};
    for (const [short, name] of Object.entries(KEYS)) {
      saved[name] = process.env[name];
      const v = cfg[short];
      if (v === undefined) delete process.env[name]; else process.env[name] = v;
    }
    reset();
    try { return await fn(); } finally {
      for (const name of Object.values(KEYS)) {
        if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
      }
    }
  };
}

test('ท่อปิด (ค่าเริ่มต้น): kind=compose → 503 และไม่มีงานถูกสร้างเลย', withEnv(undefined, async () => {
  const res = await POST(mkReq({ kind: 'compose', caseId: 'AC-0001' }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res._body.errorType, 'MEGA_PIPELINE_DISABLED');
  assert.deepEqual(globalThis.__GATE_CREATED, [], 'ท่อปิด = ห้ามมีงานปกเกิดในคิวแม้แต่งานเดียว');
}));

test('ท่อปิด (ค่าเริ่มต้น): kind=ref → 503 และไม่มีงานถูกสร้างเลย', withEnv(undefined, async () => {
  const res = await POST(mkReq({ kind: 'ref', content: 'เนื้อข่าวทดสอบยาวพอสมควรสำหรับเทสนี้' }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res._body.errorType, 'MEGA_PIPELINE_DISABLED');
  assert.deepEqual(globalThis.__GATE_CREATED, []);
}));

test('🔴 สองสวิตช์อิสระ: ปกปิดแต่โต๊ะข่าวเปิด (DESK_PIPELINE=1) → งานโต๊ะข่าวสร้างได้ปกติ', withEnv({ desk: '1' }, async () => {
  const res = await POST(mkReq({ kind: 'desk_harvest', mode: 'all' }));
  assert.notStrictEqual(res.status, 503, 'โต๊ะข่าวเปิดอยู่ ห้ามโดนประตูปกจับ');
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__GATE_CREATED.length, 1, 'งานโต๊ะข่าวต้องถูกสร้างจริง');
  assert.strictEqual(globalThis.__GATE_CREATED[0].kind, 'desk_harvest');
}));

test('ท่อปิด+โต๊ะเปิด: action=run ไม่ claim งานปก แต่ claim คลาสโต๊ะข่าวตามปกติ', withEnv({ desk: '1' }, async () => {
  await POST(mkReq({ action: 'run' }));
  const flat = (globalThis.__GATE_CLAIMS || []).flat();
  assert.ok(!flat.includes('compose') && !flat.includes('ref'), 'ท่อปิด = ห้ามหยิบงานปกที่ค้างคิวมารัน');
  assert.ok(flat.includes('desk_harvest'), 'โต๊ะข่าวเปิด = ต้องยังถูกหยิบตามปกติ');
}));

test('เปิดคืนด้วย MEGA_PIPELINE=1: kind=compose กลับมาสร้างงานได้เหมือนเดิม', withEnv({ mega: '1' }, async () => {
  const res = await POST(mkReq({ kind: 'compose', caseId: 'AC-0001' }));
  assert.notStrictEqual(res.status, 503);
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__GATE_CREATED.length, 1);
  assert.strictEqual(globalThis.__GATE_CREATED[0].kind, 'compose');
}));

// ═══ 🛑 สวิตช์ที่สอง (31 ก.ค. คำสั่งเจ้าของ): ปิดโต๊ะข่าวกลางชั่วคราว ═══

test('โต๊ะข่าวปิด (ค่าเริ่มต้น): kind=desk_harvest → 503 DESK_PIPELINE_DISABLED และไม่มีงานถูกสร้าง', withEnv({}, async () => {
  const res = await POST(mkReq({ kind: 'desk_harvest', mode: 'all' }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res._body.errorType, 'DESK_PIPELINE_DISABLED');
  assert.deepEqual(globalThis.__GATE_CREATED, [], 'โต๊ะปิด = ห้ามมีงานโต๊ะข่าวเกิดในคิว');
}));

test('โต๊ะข่าวปิด (ค่าเริ่มต้น): desk_search/desk_chief → 503 ทั้งคู่', withEnv({}, async () => {
  const r1 = await POST(mkReq({ kind: 'desk_search', keyword: 'ทดสอบ' }));
  const r2 = await POST(mkReq({ kind: 'desk_chief' }));
  assert.strictEqual(r1.status, 503);
  assert.strictEqual(r2.status, 503);
  assert.deepEqual(globalThis.__GATE_CREATED, []);
}));

test('โต๊ะข่าวปิด: action=run ต้องไม่ claim งานโต๊ะข่าวที่ค้างคิวเลย', withEnv({}, async () => {
  await POST(mkReq({ action: 'run' }));
  const flat = (globalThis.__GATE_CLAIMS || []).flat();
  assert.ok(!flat.includes('desk_harvest') && !flat.includes('desk_search') && !flat.includes('desk_chief'),
    'โต๊ะปิด = ห้ามหยิบงานโต๊ะข่าวค้างคิวมารันเผาโทเคน');
}));

test('อิสระต่อกันจริง: MEGA=1 + โต๊ะปิด → งานปกผ่าน งานโต๊ะ 503', withEnv({ mega: '1' }, async () => {
  const cover = await POST(mkReq({ kind: 'compose', caseId: 'AC-0002' }));
  assert.strictEqual(cover._body.success, true, 'สวิตช์โต๊ะข่าวห้ามไปปิดงานปก');
  const desk = await POST(mkReq({ kind: 'desk_harvest', mode: 'all' }));
  assert.strictEqual(desk.status, 503);
  assert.strictEqual(desk._body.errorType, 'DESK_PIPELINE_DISABLED');
}));

test('เปิดโต๊ะคืนด้วย DESK_PIPELINE=1: desk_harvest กลับมาสร้างงานได้เหมือนเดิม', withEnv({ desk: '1' }, async () => {
  const res = await POST(mkReq({ kind: 'desk_harvest', mode: 'all' }));
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(globalThis.__GATE_CREATED.length, 1);
}));
