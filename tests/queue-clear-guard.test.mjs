// ★ 1 ก.ย. 69 — /api/queue/clear โหมด stale ต้องมีกุญแจ และห้ามลบงานที่ยังทำอยู่ (บั๊กระดับกลาง)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// โหลด route จริงโดยแทนของที่ต้องพึ่ง Next/ฐานข้อมูลด้วยตัวปลอม
const src = readFileSync(new URL('../src/app/api/queue/clear/route.js', import.meta.url), 'utf8')
  .replace(/^import .*$/mg, '')
  .replace(/^export const .*$/mg, '')
  .replace('export async function POST', 'async function POST');

function load({ jobs, adminKey }) {
  const removed = [];
  const NextResponse = { json: (body, init) => ({ body, status: init?.status || 200 }) };
  const createStore = () => ({ getAll: async () => jobs, remove: async (id) => { removed.push(id); } });
  const createLogger = () => ({ info() {}, error() {}, warn() {} });
  const POST = new Function('NextResponse', 'createStore', 'createLogger', 'process', `${src}\nreturn POST;`)(
    NextResponse, createStore, createLogger, { env: { ADMIN_API_KEY: adminKey } });
  return { POST, removed };
}
const req = (body, key) => ({
  json: async () => body,
  headers: { get: (h) => (h === 'x-admin-key' ? (key || '') : '') },
});
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

test('โหมด stale ไม่มีกุญแจ → 403 ไม่ลบอะไรเลย', async () => {
  const { POST, removed } = load({ jobs: [{ id: 'a', status: 'processing', startedAt: ago(60) }], adminKey: 'K' });
  const res = await POST(req({}, ''));
  assert.equal(res.status, 403);
  assert.equal(removed.length, 0);
});

test('ไม่ตั้ง ADMIN_API_KEY เลย → ปฏิเสธเสมอ (fail-closed)', async () => {
  const { POST, removed } = load({ jobs: [{ id: 'a', status: 'failed', createdAt: ago(99) }], adminKey: undefined });
  const res = await POST(req({ mode: 'stale' }, 'anything'));
  assert.equal(res.status, 403);
  assert.equal(removed.length, 0);
});

test('มีกุญแจ: งานที่กำลังทำ 10 นาที ต้องไม่ถูกลบ (ข่าวใช้ได้ถึง ~13 นาที) แต่ 20 นาทีลบได้', async () => {
  const jobs = [
    { id: 'p10', status: 'processing', startedAt: ago(10) },
    { id: 'p20', status: 'processing', startedAt: ago(20) },
    { id: 'pend10', status: 'pending', createdAt: ago(10) },
    { id: 'done5', status: 'completed', completedAt: ago(5), createdAt: ago(8) },
    { id: 'done40', status: 'completed', completedAt: ago(40), createdAt: ago(45) },
    { id: 'fail40', status: 'failed', completedAt: ago(40), createdAt: ago(45) },
  ];
  const { POST, removed } = load({ jobs, adminKey: 'K' });
  const res = await POST(req({ mode: 'stale' }, 'K'));
  assert.equal(res.status, 200);
  assert.deepEqual(removed.sort(), ['done40', 'fail40', 'p20']);
});
