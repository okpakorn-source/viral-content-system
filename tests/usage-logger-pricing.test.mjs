// ============================================================
// 💸 usage-logger-pricing.test.mjs — /cost ต้องไม่ลง $0 ให้ claude-opus-5 / gemini-3.6-flash
// ------------------------------------------------------------
// บริบท: COST-AUDIT.md ข้อ 2-A/2-B (29 ก.ค. 69) พบว่าตารางราคาใน usageLogger.js ไม่มี 2 โมเดลนี้เลย
//   ทั้งที่เป็นโมเดลเขียนจริง/ตาจริงของท่อปกตั้งแต่ 26 ก.ค. → ทุก call ถูกบันทึก costUsd=0 เงียบๆ
// เทสนี้พิสูจน์ว่าหลังเพิ่ม 2 บรรทัดในตาราง PRICING แล้ว logApiUsage คำนวณ costUsd ได้ถูกต้อง (ไม่ใช่ 0)
// ------------------------------------------------------------
// usageLogger.js import '../db.js' (prisma) ตรงๆ — เทสนี้ไม่อยากแตะ DB จริง (Supabase/SQLite) จึง stub
// เฉพาะ '../db.js' ผ่าน node:module register() hook (แพทเทิร์นเดียวกับ tests/pickbestref-fidelity.test.mjs)
// แล้วดัก payload ที่ logApiUsage ส่งเข้า prisma.apiUsageLog.create เพื่อตรวจ costUsd จริงที่คำนวณได้
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// stub prisma: เก็บ payload ล่าสุดไว้ที่ globalThis ให้เทสอ่านได้ ไม่แตะ DB จริง
const STUB_DB = _mod(`
  export const prisma = {
    apiUsageLog: {
      async create(args) { globalThis.__USAGE_LOG_CAPTURED = args; return args; }
    }
  };
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../db.js' && context.parentURL && context.parentURL.includes('usageLogger.js')) {
    return { url: ${JSON.stringify(STUB_DB)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const { logApiUsage } = await import('../src/lib/ai/usageLogger.js');

test('claude-opus-5: คิดราคาได้จริง (ไม่ใช่ 0) ตามชั้น opus-4-8 (5.0/25.0 ต่อ 1M token)', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'anthropic', model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  const captured = globalThis.__USAGE_LOG_CAPTURED;
  assert.ok(captured, 'ต้องเรียกถึง prisma.apiUsageLog.create');
  assert.equal(captured.data.costUsd, 30, 'input 1M×$5 + output 1M×$25 = $30');
});

test('gemini-3.6-flash: คิดราคาได้จริง (ไม่ใช่ 0) ยืมชั้น gemini-3.5-flash (1.50/9.00 ต่อ 1M token)', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'google', model: 'gemini-3.6-flash', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  const captured = globalThis.__USAGE_LOG_CAPTURED;
  assert.ok(captured, 'ต้องเรียกถึง prisma.apiUsageLog.create');
  assert.equal(captured.data.costUsd, 10.5, 'input 1M×$1.50 + output 1M×$9.00 = $10.50');
});

test('claude-opus-5: ตัวคูณ token เศษส่วนคิดถูกสัดส่วน (regression กันพิมพ์ราคาผิดหลักสิบ)', async () => {
  globalThis.__USAGE_LOG_CAPTURED = null;
  await logApiUsage({ provider: 'anthropic', model: 'claude-opus-5', inputTokens: 2900, outputTokens: 900 });
  const captured = globalThis.__USAGE_LOG_CAPTURED;
  const expected = (2900 / 1_000_000) * 5.0 + (900 / 1_000_000) * 25.0;
  assert.ok(Math.abs(captured.data.costUsd - expected) < 1e-9);
  assert.ok(captured.data.costUsd > 0, 'ต้องไม่ใช่ 0 — นี่คือบั๊กเดิมที่ COST-AUDIT.md ชี้ (ข้อ 2-A)');
});
