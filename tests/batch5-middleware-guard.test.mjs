// ============================================================
// 🧪 BATCH-5 middleware guard — offline unit test (rev sol-critical)
// ------------------------------------------------------------
// Target: src/middleware.js
//   • _coverTestGuardDecision — pure decision function (env-flag based, NO hostname)
//   • middleware(req)          — thin wrapper (reads process.env at call time)
//
// ⚠️ ทำไมเลิกทดสอบ hostname: Codex sol พิสูจน์ว่า next@16.2.6 รายงาน req.nextUrl.hostname
//   เป็น 'localhost' เสมอบน `next start` ไร้ -H (แม้ request จากอินเทอร์เน็ต) และ NextURL
//   canonicalize 127/8 → localhost → host allow-list เปิดประตูคนนอก. ด่านใหม่พึ่ง
//   COVER_TEST_LOCAL_OPEN (ธงที่ตั้งเองเฉพาะเครื่องทีม) + คีย์ ไม่แตะ hostname เลย.
//
// ทำไม stub 'next/server': import จริงโยน ERR_MODULE_NOT_FOUND ใต้ plain Node ESM
//   (ตรง convention repo — batch2/ac0084 stub แบบเดียวกัน)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

const STUB_NEXT = _mod(`
export const NextResponse = {
  json: (obj, init) => ({ __isNextResponse: true, status: (init && init.status) || 200, _body: obj, json: async () => obj }),
  next: () => ({ __isNextResponse: true, status: 200, _passthrough: true }),
};
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { _coverTestGuardDecision, middleware, config } = await import('../src/middleware.js');

// ── matcher scope (sol R2 LOW: ลบ /api/quick-test แล้ว deputy เปิดคืนโดยเทสไม่จับ) ──
test('config.matcher ล็อกทั้ง /api/cover-ref-test และ /api/quick-test (ปิด deputy) — เพิ่ม path ท่อหนักต้องมาอัปเดตที่นี่', () => {
  const m = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
  assert.ok(m.includes('/api/cover-ref-test'), 'ต้อง guard ประตูหลัก');
  assert.ok(m.includes('/api/quick-test'), 'ต้อง guard deputy (quick-test แนบคีย์ให้ท่อหนักแทนคนนอกได้)');
  // อย่าเผลอครอบ path ที่มีผู้เรียกภายใน/สาธารณะ
  assert.ok(!m.includes('/api/analyze') && !m.includes('/api/keywords'), 'ห้าม guard analyze/keywords (megaAdapters + /image-search เรียก)');
});

const ENV = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';

// ── _coverTestGuardDecision (pure, env-flag based) ──────────────────────────

test('COVER_TEST_LOCAL_OPEN=1 → ผ่านเสมอ แม้ไม่มี header key และ env คีย์ว่าง (เครื่องทีม)', () => {
  assert.equal(_coverTestGuardDecision({ localOpen: '1', headerKey: null, envKey: '' }).allow, true);
  assert.equal(_coverTestGuardDecision({ localOpen: '1', headerKey: null, envKey: ENV }).reason, 'local_open_flag');
});

test('localOpen ค่าอื่นที่ไม่ใช่ "1" → ไม่ถือว่าเปิด (ต้องผ่านด่านคีย์)', () => {
  for (const v of ['0', 'true', '', undefined, 'yes', ' 1 ', 1]) {
    const d = _coverTestGuardDecision({ localOpen: v, headerKey: null, envKey: ENV });
    assert.equal(d.allow, false, `localOpen=${JSON.stringify(v)} ต้องไม่เปิด`);
  }
});

test('cloud (ไม่มี localOpen) ไม่มี header key → ปัดตก', () => {
  const d = _coverTestGuardDecision({ localOpen: undefined, headerKey: null, envKey: ENV });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'header_key_mismatch');
});

test('cloud header key ผิด → ปัดตก', () => {
  const d = _coverTestGuardDecision({ localOpen: undefined, headerKey: 'wrong-key', envKey: ENV });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'header_key_mismatch');
});

test('cloud header key ตรงเป๊ะ → ผ่าน', () => {
  const d = _coverTestGuardDecision({ localOpen: undefined, headerKey: ENV, envKey: ENV });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'header_key_match');
});

test('cloud key เกือบตรง (case/whitespace/ความยาวต่าง) → ปัดตก (constant-time เป๊ะ)', () => {
  assert.equal(_coverTestGuardDecision({ localOpen: undefined, headerKey: ENV.toUpperCase(), envKey: ENV }).allow, false);
  assert.equal(_coverTestGuardDecision({ localOpen: undefined, headerKey: `${ENV} `, envKey: ENV }).allow, false);
  assert.equal(_coverTestGuardDecision({ localOpen: undefined, headerKey: ENV.slice(0, -1), envKey: ENV }).allow, false); // ความยาวต่าง
});

test('env ว่าง/undefined + ไม่มี localOpen → ปัดตกเสมอ (fail-closed) ไม่ว่า headerKey จะเป็นอะไร', () => {
  const cases = [
    { headerKey: null, envKey: '' },
    { headerKey: 'anything', envKey: '' },
    { headerKey: '', envKey: '' },
    { headerKey: null, envKey: undefined },
    { headerKey: 'anything', envKey: undefined },
    { headerKey: null, envKey: '   ' }, // ช่องว่างล้วน = ว่างหลัง trim
  ];
  for (const c of cases) {
    const d = _coverTestGuardDecision({ localOpen: undefined, ...c });
    assert.equal(d.allow, false, `expected deny for ${JSON.stringify(c)}`);
    assert.equal(d.reason, 'env_key_missing');
  }
});

test('env ว่าง แต่ localOpen=1 → ยังผ่าน (ธง local ชนะทุกอย่าง — เครื่องทีมไม่ต้องตั้งคีย์)', () => {
  assert.equal(_coverTestGuardDecision({ localOpen: '1', headerKey: null, envKey: undefined }).allow, true);
});

// ── middleware(req) thin-wrapper smoke tests (อ่าน process.env จริงตอนเรียก) ──

function mockReq({ headerKey }) {
  return {
    headers: { get: (name) => (name === 'x-cover-test-key' ? (headerKey ?? null) : null) },
  };
}
// helper: ตั้ง/คืน env รอบการเรียก middleware (process.env จริง — save/restore)
function withEnv(env, fn) {
  const KEYS = ['COVER_TEST_LOCAL_OPEN', 'COVER_TEST_KEY'];
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('middleware() localOpen=1 → NextResponse.next() (passthrough 200)', () => {
  withEnv({ COVER_TEST_LOCAL_OPEN: '1' }, () => {
    const res = middleware(mockReq({ headerKey: null }));
    assert.equal(res._passthrough, true);
    assert.equal(res.status, 200);
  });
});

test('middleware() cloud ไม่มี key → 401 COVER_TEST_KEY_REQUIRED', async () => {
  await withEnv({ COVER_TEST_KEY: ENV }, async () => {
    const res = middleware(mockReq({ headerKey: null }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.errorType, 'COVER_TEST_KEY_REQUIRED');
  });
});

test('middleware() cloud key ตรง → passthrough', () => {
  withEnv({ COVER_TEST_KEY: ENV }, () => {
    const res = middleware(mockReq({ headerKey: ENV }));
    assert.equal(res._passthrough, true);
  });
});

test('middleware() cloud env ไม่ตั้งเลย (ลืมตั้งคีย์) → 401 fail-closed ไม่เปิดโล่ง', async () => {
  await withEnv({}, async () => {
    const res = middleware(mockReq({ headerKey: 'anything' }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.errorType, 'COVER_TEST_KEY_REQUIRED');
  });
});

test('middleware() error ระหว่างตัดสิน (req พัง) → fail-closed 401 COVER_TEST_GUARD_ERROR', async () => {
  const brokenReq = { headers: null }; // req.headers.get โยน TypeError → ต้องโดน catch แล้วปัดตก
  const res = middleware(brokenReq);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.errorType, 'COVER_TEST_GUARD_ERROR');
});
