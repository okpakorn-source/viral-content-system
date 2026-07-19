// ============================================================
// 🧪 Research Trace × Discovery V2 (เฟส 0) — offline unit test
// ------------------------------------------------------------
// Target: src/lib/services/deskV2/researchTrace.js → logRun()
//   ต่อสายโมดูลวัดผลเงา (researchDiscoveryConfig/Metrics) เข้า logRun:
//   • ไม่ส่ง measurementSample                → ไม่มี field discoveryV2 (record เหมือนเดิมเป๊ะ)
//   • ส่ง sample แต่ MASTER ปิด               → ไม่คำนวณ (การ์ดกันพฤติกรรมเปลี่ยน)
//   • ส่ง sample + MASTER เปิด                → มี discoveryV2 (เฉพาะผลรวม ไม่เก็บ sample ดิบ)
//   • priorStoryKeys ตัด runId ปัจจุบันออก    → ลีดของรอบนี้เองไม่ถูกนับเป็น "ของเก่า"
//
// ทำไม stub '../../persistStore.js': import จริงพึ่ง supabase/env — โยน ERR_MODULE_NOT_FOUND
//   ใต้ plain Node ESM. Stub เป็น store ในหน่วยความจำ (globalThis.__STORES__) ให้ seed/อ่านย้อนได้
//   (แพตเทิร์นเดียวกับ tests/batch5-middleware-guard.test.mjs ที่ stub 'next/server')
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// stub persistStore → in-memory store บน globalThis.__STORES__ (Map<storeName, item[]>)
const STUB_PERSIST = _mod(`
function reg() {
  if (!globalThis.__STORES__) globalThis.__STORES__ = new Map();
  return globalThis.__STORES__;
}
function arr(name) {
  const r = reg();
  if (!r.has(name)) r.set(name, []);
  return r.get(name);
}
export function createStore(name) {
  return {
    async getAll() { return arr(name).slice(); },
    async add(item) { arr(name).push(item); return item; },
    async addMany(items) { const a = arr(name); for (const it of items) a.push(it); return items; },
    async remove(id) { const a = arr(name); const i = a.findIndex((r) => r && r.id === id); if (i >= 0) a.splice(i, 1); },
  };
}
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('persistStore.js')) return { url: ${JSON.stringify(STUB_PERSIST)}, shortCircuit: true };
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { logRun } = await import('../src/lib/services/deskV2/researchTrace.js');

const RUNS = 'research-hunt-runs';
const LEADS = 'research-leads';

function resetStores() { globalThis.__STORES__ = new Map(); }
function seedLeads(leads) { globalThis.__STORES__.set(LEADS, leads.slice()); }
function storedRun(id) { return (globalThis.__STORES__.get(RUNS) || []).find((x) => x && x.id === id) || null; }

// เปิด/ปิด MASTER flag รอบการเรียก logRun (process.env จริง — save/restore)
async function withMaster(on, fn) {
  const KEY = 'DESK_V2_DISCOVERY_V2';
  const saved = process.env[KEY];
  if (on) process.env[KEY] = '1'; else process.env[KEY] = '0'; // 🟢 canary: default=ON → ปิดต้องตั้ง '0' (empty=ON แล้ว)
  try { return await fn(); } finally {
    if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved;
  }
}

// ── การ์ดกันพฤติกรรมเปลี่ยน ──────────────────────────────────────

test('ไม่ส่ง measurementSample → ไม่มี discoveryV2 (record เหมือนเดิม) แม้ MASTER เปิด', async () => {
  resetStores();
  await withMaster(true, async () => {
    const run = await logRun({ runId: 'r_nosample', huntStats: { serperCalls: 3 } });
    assert.equal(run.discoveryV2, undefined);
    assert.equal(storedRun('r_nosample')?.discoveryV2, undefined);
  });
});

test('ส่ง sample แต่ MASTER ปิด → ไม่คำนวณ discoveryV2 (flag off = พฤติกรรมเดิมเป๊ะ)', async () => {
  resetStores();
  await withMaster(false, async () => {
    const run = await logRun({
      runId: 'r_off',
      measurementSample: [{ url: 'https://a.com/1', channel: 'youtube', fingerprint: { names: ['ก้อย'], action: 'เปิดใจ' }, kept: true }],
    });
    assert.equal(run.discoveryV2, undefined);
    assert.equal(storedRun('r_off')?.discoveryV2, undefined);
  });
});

// ── โหมด shadow ทำงานเมื่อเปิด MASTER ────────────────────────────

test('ส่ง sample + MASTER เปิด → มี discoveryV2 ครบ + เก็บเฉพาะผลรวม (ไม่เก็บ sample ดิบ)', async () => {
  resetStores();
  // เพจเคยทำเรื่อง "ก้อย::เปิดใจ" (คนละรอบ) · เรื่อง "ตูน::ช่วยคน" อยู่ใต้ runId ปัจจุบันเท่านั้น (ต้องถูกตัดออกจาก prior)
  seedLeads([
    { id: 'lead_old', runId: 'old_run', fingerprint: { names: ['ก้อย'], action: 'เปิดใจ' } },
    { id: 'lead_cur', runId: 'r_on', fingerprint: { names: ['ตูน'], action: 'ช่วยคน' } },
  ]);
  await withMaster(true, async () => {
    const run = await logRun({
      runId: 'r_on',
      measurementSample: [
        { url: 'u1', channel: 'youtube', fingerprint: { names: ['ก้อย'], action: 'เปิดใจ' }, kept: true },   // เคยทำ → ไม่ใหม่
        { url: 'u2', channel: 'facebook', fingerprint: { names: ['ตูน'], action: 'ช่วยคน' }, kept: true },   // ตรงลีดรอบนี้เอง → ใหม่
        { url: 'u3', channel: 'tiktok', fingerprint: { names: ['เชน'], action: 'เล่าเรื่อง' }, kept: false },  // ไม่เก็บ → ไม่นับ novelty
      ],
    });
    const d = run.discoveryV2;
    assert.ok(d, 'ต้องมี discoveryV2');
    assert.equal(d.mode, 'shadow');
    assert.equal(d.candidateCount, 3);
    assert.equal(d.keptCount, 2);
    assert.equal(d.uniqueStoryCount, 2);
    assert.equal(d.novelStoryCount, 1);   // เฉพาะ "ตูน" (ก้อย เคยทำแล้ว)
    assert.equal(d.noveltyRate, 0.5);
    assert.deepEqual(d.byPlatformGroup, { youtube: 1, facebook: 1, tiktok: 1 });
    // เก็บเฉพาะผลรวม — ห้ามมี sample ดิบหลุดลง record
    assert.equal(run.measurementSample, undefined);
    assert.equal(d.sample, undefined);
    // เก็บลง store จริง (ไม่ใช่แค่ค่าที่คืน)
    assert.ok(storedRun('r_on')?.discoveryV2, 'record ใน store ต้องมี discoveryV2 ด้วย');
  });
});

test('priorStoryKeys ตัด runId ปัจจุบันออก — ลีดของรอบนี้เองไม่ถูกนับเป็นของเก่า', async () => {
  resetStores();
  seedLeads([{ id: 'lead_cur', runId: 'rX', fingerprint: { names: ['ก้อย'], action: 'เปิดใจ' } }]);
  await withMaster(true, async () => {
    const run = await logRun({ runId: 'rX', measurementSample: [{ url: 'u1', fingerprint: { names: ['ก้อย'], action: 'เปิดใจ' }, kept: true }] });
    assert.equal(run.discoveryV2.novelStoryCount, 1); // เป็นเรื่องใหม่ เพราะลีดที่ตรงกันเป็นของรอบนี้เอง
    assert.equal(run.discoveryV2.noveltyRate, 1);
  });
});

test('เรื่องที่เพจเคยทำ (คนละ runId) → ไม่นับเป็นเรื่องใหม่', async () => {
  resetStores();
  seedLeads([{ id: 'lead_old', runId: 'old', fingerprint: { names: ['ก้อย'], action: 'เปิดใจ' } }]);
  await withMaster(true, async () => {
    const run = await logRun({ runId: 'rY', measurementSample: [{ url: 'u1', fingerprint: { names: ['ก้อย'], action: 'เปิดใจ' }, kept: true }] });
    assert.equal(run.discoveryV2.novelStoryCount, 0);
    assert.equal(run.discoveryV2.noveltyRate, 0);
  });
});

// ── ทนทาน: ขยะใน sample ต้องไม่ทำ logRun พัง + ยังบันทึกรอบล่าครบ ──

test('sample มีขยะ (null / ไม่ใช่ object / ไม่มีตัวชี้ตัวตน) → ไม่พัง + บันทึกรอบล่าครบ', async () => {
  resetStores();
  await withMaster(true, async () => {
    const run = await logRun({
      runId: 'r_junk',
      measurementSample: [null, 42, {}, { fingerprint: {} }, { url: 'ok', kept: true }],
    });
    assert.ok(run);
    assert.equal(run.discoveryV2.candidateCount, 1); // เหลือใบเดียวที่มี urlKey
    assert.ok(storedRun('r_junk'), 'รอบล่าต้องถูกบันทึกแม้ sample ส่วนใหญ่เป็นขยะ');
  });
});

test('runId ว่าง → โยน error เหมือนเดิม (สัญญาเดิมของ logRun ไม่เปลี่ยน)', async () => {
  resetStores();
  await withMaster(true, async () => {
    await assert.rejects(() => logRun({ measurementSample: [{ url: 'u1', kept: true }] }), /runId/);
  });
});
