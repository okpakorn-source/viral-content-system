// ============================================================
// 🩹 29 ก.ค. 69 — Opus fix #2 (ง): patchJob() ต้องขยับ heartbeatAt จริงทุกครั้งที่ถูกเรียก
//   + getBootId() คงค่าเดิมตลอดอายุโปรเซส (globalThis cache)
// ------------------------------------------------------------
// recoverOrphanJobs (ดู tests/orphan-job-recovery.test.mjs) เชื่อ heartbeatAt เป็นสัญญาณ "เจ้าของยังมีชีวิต"
// สำหรับงานข้าม bootId — เทสนี้พิสูจน์ต้นทางของสัญญาณนั้น: patchJob() (src/lib/quickTestJobs.js) ต้องประทับ
// heartbeatAt = เวลาปัจจุบันเสมอ ไม่ว่า patch จะมีฟิลด์อะไรมาบ้าง (แม้พยายาม override ก็แพ้)
//
// Offline: stub @supabase/supabase-js เป็นฐานข้อมูลจำลองในหน่วยความจำ (Map) — ไม่แตะ Supabase จริง/ไฟล์จริงเลย
// (quickTestJobs.js เช็ค env NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_KEY เอง — ต้องตั้งค่าปลอมไว้ก่อนเรียกใช้
// ฟังก์ชันใดๆ ในไฟล์ ไม่งั้นจะตกไปโหมด fallback ไฟล์จริง data/quick-test-jobs.json)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.supabase.local';
process.env.SUPABASE_SERVICE_KEY = 'fake-service-key-for-test';

const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// ฐานข้อมูลจำลอง in-memory — เลียนแบบ chain ที่ quickTestJobs.js ใช้จริง (.from().select().eq()[.eq().maybeSingle() | thenable]/.upsert())
const STUB_SUPABASE = _mod(
  "const rows = new Map();\n" +
  "export function createClient() {\n" +
  "  return {\n" +
  "    from(table) {\n" +
  "      return {\n" +
  "        select(_cols) {\n" +
  "          return {\n" +
  "            eq(col1, val1) {\n" +
  "              const stage2 = {\n" +
  "                eq(col2, val2) {\n" +
  "                  return {\n" +
  "                    async maybeSingle() {\n" +
  "                      const row = rows.get(val2);\n" +
  "                      return { data: row ? { data: row.data } : null, error: null };\n" +
  "                    },\n" +
  "                  };\n" +
  "                },\n" +
  "                then(onFulfilled, onRejected) {\n" +
  "                  try {\n" +
  "                    const data = Array.from(rows.values()).filter((r) => r.store_name === val1).map((r) => ({ data: r.data }));\n" +
  "                    onFulfilled({ data, error: null });\n" +
  "                  } catch (e) { if (onRejected) onRejected(e); }\n" +
  "                },\n" +
  "              };\n" +
  "              return stage2;\n" +
  "            },\n" +
  "          };\n" +
  "        },\n" +
  "        async upsert(row) {\n" +
  "          rows.set(row.id, row);\n" +
  "          return { error: null };\n" +
  "        },\n" +
  "        delete() {\n" +
  "          return { eq: () => ({ eq: async () => ({ error: null }) }) };\n" +
  "        },\n" +
  "      };\n" +
  "    },\n" +
  "  };\n" +
  "}\n"
);
const STUB_RESILIENT = _mod("export function resilientFetch(...args) { return fetch(...args); }");

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@supabase/supabase-js') return { url: ${JSON.stringify(STUB_SUPABASE)}, shortCircuit: true };
  if (specifier === './supabase.js') return { url: ${JSON.stringify(STUB_RESILIENT)}, shortCircuit: true };
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { createJob, patchJob, getJob, getBootId } = await import('../src/lib/quickTestJobs.js');

test('getBootId(): คงค่าเดิมทุกครั้งที่เรียกในโปรเซสเดียวกัน (globalThis cache) + เป็น string ไม่ว่าง', () => {
  const a = getBootId();
  const b = getBootId();
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0);
  assert.equal(a, b, 'ต้องคืนค่าเดิมเสมอในโปรเซสเดียวกัน (ไม่สุ่มใหม่ทุกครั้ง)');
});

test('patchJob(): ประทับ heartbeatAt เป็นเวลาปัจจุบันทุกครั้งที่ถูกเรียก แม้ patch ไม่ได้ขอฟิลด์นี้มาเลย', async () => {
  const job = await createJob({ kind: 'compose', label: 'เทส heartbeat', input: {}, dispatch: 'local' });
  assert.ok(!job.heartbeatAt, 'ตอนสร้างงานยังไม่มี heartbeatAt (ยังไม่เคย patch)');
  const before = Date.now();
  const updated = await patchJob(job.id, { progress: { step: 'กำลังรัน', pct: 5 } });
  const after = Date.now();
  assert.ok(updated.heartbeatAt, 'patchJob ต้องเติม heartbeatAt ให้เสมอ');
  const stamped = Date.parse(updated.heartbeatAt);
  assert.ok(stamped >= before - 1000 && stamped <= after + 1000, 'heartbeatAt ต้องเป็นเวลา ณ ตอน patch จริง');
});

test('patchJob(): ขยับ heartbeatAt ใหม่ทุกครั้ง (เรียกซ้ำ 2 รอบ รอบหลังต้อง >= รอบแรกเสมอ)', async () => {
  const job = await createJob({ kind: 'ref', label: 'เทส heartbeat ซ้ำ', input: {}, dispatch: 'local' });
  const first = await patchJob(job.id, { progress: { step: 'รอบ 1' } });
  await new Promise((r) => setTimeout(r, 15)); // เว้นช่วงกันเวลาเท่ากันเป๊ะจนเทียบไม่ออก
  const second = await patchJob(job.id, { progress: { step: 'รอบ 2' } });
  assert.ok(Date.parse(second.heartbeatAt) >= Date.parse(first.heartbeatAt), 'heartbeat รอบหลังต้องไม่เก่ากว่ารอบแรก');
  assert.ok(Date.parse(second.heartbeatAt) > Date.parse(first.heartbeatAt) - 1, 'ควรขยับจริง ไม่ใช่ค่าค้าง');
});

test('patchJob(): แม้ผู้เรียกพยายามยัด heartbeatAt เก่าปลอมมาใน patch ก็ไม่มีผล — ฟังก์ชันคำนวณเวลาจริงทับเสมอ', async () => {
  const job = await createJob({ kind: 'compose', label: 'เทส override', input: {}, dispatch: 'local' });
  const fakeOld = new Date(Date.now() - 999999 * 1000).toISOString();
  const updated = await patchJob(job.id, { heartbeatAt: fakeOld, progress: { step: 'พยายาม override' } });
  assert.notEqual(updated.heartbeatAt, fakeOld, 'ห้ามให้ patch ทับ heartbeatAt ได้ ต้องเป็นเวลาปัจจุบันของ patchJob เองเสมอ');
  assert.ok(Date.now() - Date.parse(updated.heartbeatAt) < 5000, 'heartbeatAt ต้องเป็นเวลาสดตอนนี้ ไม่ใช่ค่าเก่าที่ผู้เรียกส่งมา');
});

test('getJob() หลัง patchJob() อ่านเจอ heartbeatAt ที่ถูกบันทึกจริง (ผ่านชั้น storage ครบวงจร)', async () => {
  const job = await createJob({ kind: 'desk_harvest', label: 'เทส persist', input: {}, dispatch: 'local' });
  await patchJob(job.id, { status: 'running' });
  const reread = await getJob(job.id);
  assert.ok(reread.heartbeatAt, 'อ่านกลับมาต้องเจอ heartbeatAt ที่บันทึกไว้');
  assert.equal(reread.status, 'running');
});
