// ============================================================
// 🧪 TRIAGE_LIMIT_PER_CALL (21 ก.ค. 69) — เคส AC-0164: Vercel S5_TRIAGE_FAILED (function ตายกลางทาง)
// ------------------------------------------------------------
// s5_triage เดิมส่ง limit:60 ตายตัว → cloud function (โหลดภาพ+Gemini 6 ชุด/call) เสี่ยงชนเพดานเวลา/แรม
// แก้: เครื่องทีม (win32) = 60 เดิมเป๊ะ · cloud (non-win32) = 40 · override ทุกเครื่อง: MEGA_TRIAGE_LIMIT
// พิสูจน์:
//   (a) win32 ไม่ตั้ง env → limit ที่ส่งเข้า /api/images/triage = 60 (byte-parity ฝั่งทีม)
//   (b) MEGA_TRIAGE_LIMIT=25 → limit = 25 (override ทำงาน — เส้นเดียวกับที่จะตั้งบน Vercel ได้)
// (กรณี non-win32 default 40 พิสูจน์บนเครื่องนี้ตรงๆ ไม่ได้ — logic เป็น ternary เดียวกับ (b))
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// จับ request ที่ jfetch ยิง (jfetch ใช้ global fetch)
const captured = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  captured.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  return { status: 200, json: async () => ({ success: false, error: 'stub-triage-down' }) };
};
test.after(() => { globalThis.fetch = realFetch; });

const mkJob = () => ({ dossier: { images: { caseId: 'CASE-TRIAGE-LIMIT', triageErrors: 0 } } });

// (a) default บน win32 = 60 เดิมเป๊ะ
test('(a) win32 ไม่ตั้ง env: s5_triage ส่ง limit=60 (พฤติกรรมทีมเดิมเป๊ะ)', async () => {
  delete process.env.MEGA_TRIAGE_LIMIT;
  const { s5_triage } = await import('@/lib/megaAdapters');
  captured.length = 0;
  const r = await s5_triage(mkJob(), { origin: 'http://mock' });
  assert.equal(r.status, 'waiting', 'ตาล้มครั้งแรก = waiting (retry เดิม)');
  const call = captured.find((c) => c.url.includes('/api/images/triage'));
  assert.ok(call, 'ต้องยิง /api/images/triage');
  assert.equal(call.body.limit, 60, 'win32 default = 60 เดิม');
});

// (b) override ด้วย env (เส้นเดียวกับตั้งบน Vercel)
test('(b) MEGA_TRIAGE_LIMIT=25: s5_triage ส่ง limit=25 (override ทำงาน)', async () => {
  process.env.MEGA_TRIAGE_LIMIT = '25';
  try {
    // cache-bust ให้โมดูลคำนวณ constant ใหม่ (ค่าอ่านตอน module load)
    const { s5_triage } = await import('@/lib/megaAdapters.js?triage-limit-override');
    captured.length = 0;
    const r = await s5_triage(mkJob(), { origin: 'http://mock' });
    assert.equal(r.status, 'waiting');
    const call = captured.find((c) => c.url.includes('/api/images/triage'));
    assert.ok(call, 'ต้องยิง /api/images/triage');
    assert.equal(call.body.limit, 25, 'override ต้องชนะ default');
  } finally {
    delete process.env.MEGA_TRIAGE_LIMIT;
  }
});
