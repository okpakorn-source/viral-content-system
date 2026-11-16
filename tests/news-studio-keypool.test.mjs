// ข้อสอบ "ชุดคีย์ Anthropic แบบสลับใช้" ของระบบเขียนข่าวตัวใหม่ (10 พ.ย. 69 — เจ้าของสั่ง "ใส่หลายคีย์ ให้สลับใช้กันถ้าหมด")
// import โค้ดจริงตรงๆ · client ของโมเดลเป็นตัวปลอม · คีย์ในข้อสอบเป็นข้อความสมมติ · ไม่ยิง API
// รัน: node --test tests/news-studio-keypool.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnthropicKeys, skippedAnthropicEnvNames, classifyKeyFailure, createKeyPool, redactKeys, keyWarning, keyAlertFromRuns, KEY_BENCH_MS, KEY_ENV_NAMES, KEY_REASON, KEY_WARNING_CODES } from '../src/lib/services/newsStudio/keyPool.js';
import { makeAnthropicCaller } from '../src/lib/services/newsStudio/callers.js';
import { runQualityWarnings } from '../src/lib/services/newsStudio/legacyResult.js';

const err = (status, type, message = `HTTP ${status}`) => Object.assign(new Error(message), { status, type });
const okReply = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
const spec = { model: 'claude-opus-4-8', effort: 'medium', thinking: false, maxTokens: 100, timeoutMs: 1000 };
const noWait = { now: () => 0, wait: async () => {} };

/** ชุดคีย์ปลอม: behaviours[ชื่อคีย์] = ฟังก์ชันที่ถูกเรียกแทน messages.create */
function makePool(behaviours, { clock = { t: 1_000_000 } } = {}) {
  const calls = [];
  const keys = readAnthropicKeys(Object.fromEntries(Object.keys(behaviours).map((k, i) => [KEY_ENV_NAMES[i], k])));
  const pool = createKeyPool({
    keys, now: () => clock.t,
    makeClient: (key) => ({ messages: { create: async () => { calls.push(key); return behaviours[key](); } } }),
  });
  return { pool, calls, clock };
}

test('อ่านคีย์จาก env: ตามลำดับเลข · ข้ามช่องว่าง · ค่าซ้ำนับครั้งเดียว · แกะเครื่องหมายคำพูด · ไม่มีคีย์ = รายการว่าง', () => {
  assert.deepEqual(KEY_ENV_NAMES.slice(0, 3), ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3']);
  assert.equal(KEY_ENV_NAMES.length, 9);
  const keys = readAnthropicKeys({ ANTHROPIC_API_KEY: ' key-a ', ANTHROPIC_API_KEY_2: '', ANTHROPIC_API_KEY_3: '"key-c"', ANTHROPIC_API_KEY_4: 'key-a', ANTHROPIC_API_KEY_5: "'key-e'", OTHER: 'x' });
  assert.deepEqual(keys.map((k) => [k.label, k.envName, k.key]), [['คีย์ 1', 'ANTHROPIC_API_KEY', 'key-a'], ['คีย์ 2', 'ANTHROPIC_API_KEY_3', 'key-c'], ['คีย์ 3', 'ANTHROPIC_API_KEY_5', 'key-e']]);
  assert.deepEqual(readAnthropicKeys({}), []);
  assert.deepEqual(readAnthropicKeys({ ANTHROPIC_API_KEY_2: 'only-backup' }).map((k) => k.envName), ['ANTHROPIC_API_KEY_2'], 'มีแต่คีย์สำรองก็ใช้ได้');
});

test('แยกเหตุ: ปัญหาของคีย์ = สลับ · ปัญหาที่ไม่ใช่ของคีย์ = ห้ามสลับ', () => {
  assert.equal(classifyKeyFailure(err(402, 'billing_error')), 'billing');
  assert.equal(classifyKeyFailure(err(401, 'authentication_error')), 'auth');
  assert.equal(classifyKeyFailure(err(403, 'permission_error')), 'permission');
  assert.equal(classifyKeyFailure(err(404, 'not_found_error')), 'model');
  assert.equal(classifyKeyFailure(err(429, 'rate_limit_error')), 'rate');
  assert.equal(classifyKeyFailure({ status: 402 }), 'billing', 'ไม่มี .type ก็ดูจากรหัส HTTP');
  assert.equal(classifyKeyFailure({ type: 'billing_error' }), 'billing', 'ไม่มีรหัส HTTP ก็ดูจาก .type');
  assert.equal(classifyKeyFailure(err(400, 'invalid_request_error', 'Your credit balance is too low to access the API')), 'billing', 'เครดิตหมดที่รายงานเป็นคำขอผิด');
  for (const e of [err(400, 'invalid_request_error', 'messages: roles must alternate'), err(413, 'request_too_large'), err(500, 'api_error'), err(529, 'overloaded_error'), new Error('Request timed out.'), null, {}]) {
    assert.equal(classifyKeyFailure(e), null, `ต้องไม่สลับคีย์: ${e?.message || JSON.stringify(e)}`);
  }
});

test('คีย์แรกเครดิตหมด → คำขอเดียวกันไปต่อที่คีย์ถัดไป · คำขอต่อไปข้ามคีย์ที่พักไว้ · ครบเวลาพักแล้วกลับไปลองคีย์แรก', async () => {
  let aDead = true;
  const { pool, calls, clock } = makePool({ 'key-a': () => { if (aDead) throw err(402, 'billing_error'); return okReply('จากคีย์ a'); }, 'key-b': () => okReply('จากคีย์ b') });
  assert.equal(pool.size, 2);
  const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b', 'งานไม่ล้ม ทั้งที่คีย์แรกเครดิตหมด');
  assert.deepEqual(calls, ['key-a', 'key-b']);
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b');
  assert.deepEqual(calls, ['key-a', 'key-b', 'key-b'], 'ระหว่างพัก ไม่ยิงคีย์ที่หมดซ้ำ');
  const snap = pool.snapshot();
  assert.deepEqual([snap[0].benched, snap[0].kind, snap[0].reason, snap[1].benched], [true, 'billing', 'เครดิตหมดหรือมีปัญหาการชำระเงิน', false]);
  assert.equal(Date.parse(snap[0].retryAt), 1_000_000 + KEY_BENCH_MS.billing);
  // เติมเงินแล้ว + ครบเวลาพัก → กลับไปใช้คีย์แรกเอง
  aDead = false;
  clock.t += KEY_BENCH_MS.billing + 1;
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ a');
  assert.equal(pool.snapshot()[0].benched, false);
});

test('ทุกคีย์ใช้ไม่ได้ = error ที่บอกเหตุทีละคีย์ (ไม่ใช่ "เรียกโมเดลไม่สำเร็จ" กลางๆ) · รอบถัดไปยังลองทุกคีย์ใหม่ (เติมเงินแล้วกลับมาได้ทันที)', async () => {
  let dead = true;
  const { pool, calls } = makePool({ 'key-a': () => { if (dead) throw err(402, 'billing_error'); return okReply('ฟื้นแล้ว'); }, 'key-b': () => { throw err(401, 'authentication_error'); } });
  const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
  await assert.rejects(() => call({ system: 's', user: 'u' }), (e) => {
    assert.equal(e.errorType, 'ANTHROPIC_KEYS_EXHAUSTED');
    assert.equal(e.message, 'เรียกนักเขียนไม่ได้: คีย์ Anthropic ใช้ไม่ได้ทั้ง 2 คีย์ (คีย์ 1: เครดิตหมดหรือมีปัญหาการชำระเงิน · คีย์ 2: คีย์ไม่ถูกต้องหรือถูกยกเลิก)');
    return true;
  });
  assert.deepEqual(calls, ['key-a', 'key-b']);
  dead = false; // เจ้าของเติมเงินคีย์แรก — ยังไม่ครบเวลาพัก
  assert.equal(await call({ system: 's', user: 'u' }), 'ฟื้นแล้ว', 'ทุกคีย์ถูกพัก = ลองใหม่ทุกคีย์ ไม่ล็อกระบบจนครบเวลา');
  assert.equal(pool.snapshot()[0].benched, false);
});

test('เหตุที่ไม่ใช่ของคีย์: ไม่ลองคีย์อื่น ไม่พักคีย์ (ระบบผู้ให้บริการล่ม / คำขอผิดรูป / หมดเวลา)', async () => {
  for (const e of [err(529, 'overloaded_error'), err(500, 'api_error'), err(400, 'invalid_request_error', 'bad request'), new Error('Request timed out.')]) {
    const { pool, calls } = makePool({ 'key-a': () => { throw e; }, 'key-b': () => okReply('ไม่ควรถึง') });
    const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: { now: () => 0, wait: async () => {} } });
    await assert.rejects(() => call({ system: 's', user: 'u' }), (x) => x.errorType === 'MODEL_CALL_FAILED');
    assert.ok(!calls.includes('key-b'), `ห้ามไปคีย์สำรองเมื่อ ${e.message}`);
    assert.ok(pool.snapshot().every((k) => !k.benched));
  }
});

test('โควตาเต็มชั่วคราว (429): ลองซ้ำเร็ว 1 ครั้งที่คีย์เดิมก่อน แล้วค่อยไปคีย์ถัดไป · พักสั้น', async () => {
  const { pool, calls } = makePool({ 'key-a': () => { throw err(429, 'rate_limit_error'); }, 'key-b': () => okReply('จากคีย์ b') });
  const call = makeAnthropicCaller({ pool, spec, role: 'ผู้ตรวจข้อเท็จจริง', retryClock: noWait });
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b');
  assert.deepEqual(calls, ['key-a', 'key-a', 'key-b']);
  const a = pool.snapshot()[0];
  assert.deepEqual([a.benched, a.kind], [true, 'rate']);
  assert.ok(KEY_BENCH_MS.rate <= 60000 && KEY_BENCH_MS.billing >= 5 * 60000);
});

test('ไม่มีคีย์เลย = บอกชัดว่าขาดคีย์ · คีย์เดียวทำงานเหมือนเดิม · สถานะไม่มีค่าคีย์หลุดออกมา', async () => {
  const empty = createKeyPool({ keys: [], makeClient: () => { throw new Error('ไม่ควรถูกเรียก'); } });
  await assert.rejects(() => makeAnthropicCaller({ pool: empty, spec, role: 'นักเขียน' })({ system: 's', user: 'u' }), (e) => e.errorType === 'ANTHROPIC_KEY_MISSING' && /ANTHROPIC_API_KEY/.test(e.message));
  await assert.rejects(() => empty.run(async () => 'x'), (e) => e.errorType === 'ANTHROPIC_KEY_MISSING');

  let made = 0;
  const single = createKeyPool({ keys: readAnthropicKeys({ ANTHROPIC_API_KEY: 'secret-value-123' }), makeClient: () => { made++; return { messages: { create: async () => okReply('ผ่าน') } }; } });
  const call = makeAnthropicCaller({ pool: single, spec, role: 'นักเขียน', retryClock: noWait });
  assert.equal(await call({ system: 's', user: 'u' }), 'ผ่าน');
  assert.equal(await call({ system: 's', user: 'u' }), 'ผ่าน');
  assert.equal(made, 1, 'สร้าง client ครั้งเดียวต่อคีย์');
  const snap = single.snapshot();
  assert.deepEqual(Object.keys(snap[0]).sort(), ['benched', 'down', 'downReason', 'envName', 'failures', 'kind', 'label', 'lastFailAt', 'reason', 'retryAt', 'uses']);
  assert.ok(!JSON.stringify(snap).includes('secret-value-123'), 'สถานะห้ามมีค่าคีย์');
  assert.deepEqual([snap[0].label, snap[0].envName, snap[0].uses, snap[0].failures], ['คีย์ 1', 'ANTHROPIC_API_KEY', 2, 0]);

});

test('มีคีย์เดียว = ผลเหมือนทางเดิมทุกกรณีที่ล้ม (ชนิดข้อผิดพลาดและข้อความเดียวกัน · ไม่พักคีย์ · ไม่มีคำเตือนเรื่องคีย์สำรอง)', async () => {
  const cases = [err(402, 'billing_error', 'credit balance is too low'), err(401, 'authentication_error', 'invalid x-api-key'), err(403, 'permission_error', 'forbidden'), err(429, 'rate_limit_error', 'rate limited'), err(404, 'not_found_error', 'model: claude-typo'), err(529, 'overloaded_error', 'overloaded')];
  for (const e of cases) {
    const client = { messages: { create: async () => { throw e; } } };
    const pool = createKeyPool({ keys: readAnthropicKeys({ ANTHROPIC_API_KEY: 'only-key-123' }), makeClient: () => client });
    const viaClient = await makeAnthropicCaller({ client, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
    const viaPool = await makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
    assert.deepEqual([viaPool.errorType, viaPool.message], [viaClient.errorType, viaClient.message], `HTTP ${e.status}`);
    assert.equal(viaPool.errorType, 'MODEL_CALL_FAILED');
    assert.ok(viaPool.message.includes(`(HTTP ${e.status})`) && viaPool.message.includes(e.message), 'ยังมีรหัสและข้อความของผู้ให้บริการ');
    assert.ok(pool.snapshot().every((k) => !k.benched), 'คีย์เดียวไม่ถูกพัก');
    assert.equal(keyWarning(pool.snapshot()), null, 'คีย์เดียวไม่มีคำว่า "สลับไปใช้คีย์ที่เหลือ"');
  }
  // เหตุที่เจ้าของต้องลงมือเอง มีคำไทยนำหน้าข้อความของผู้ให้บริการ (ทั้งทางเดิมและทางชุดคีย์)
  const billing = await makeAnthropicCaller({ client: { messages: { create: async () => { throw err(402, 'billing_error', 'credit balance is too low'); } } }, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
  assert.equal(billing.message, 'เรียกนักเขียนไม่สำเร็จ (HTTP 402): เครดิตหมดหรือมีปัญหาการชำระเงิน · credit balance is too low');
});

test('ถึงเพดานใช้จ่ายรายเดือน (HTTP 400 "API usage limits") = เรื่องเครดิตของคีย์นั้น → สลับคีย์', async () => {
  const limit = (msg) => err(400, 'invalid_request_error', msg);
  assert.equal(classifyKeyFailure(limit('You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.')), 'billing');
  assert.equal(classifyKeyFailure(limit('You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.')), 'billing');
  const { pool, calls } = makePool({ 'key-a': () => { throw limit('You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'); }, 'key-b': () => okReply('จากคีย์ b') });
  assert.equal(await makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }), 'จากคีย์ b');
  assert.deepEqual(calls, ['key-a', 'key-b']);
  assert.equal(pool.snapshot()[0].kind, 'billing');
});

test('คีย์ที่ใช้ได้ล้มในคำขอนี้ → ลองคีย์ที่ถูกพักต่อในคำขอเดียวกัน (ไม่ยอมแพ้ทั้งที่ยังมีคีย์ไม่ได้ลอง) · ข้อความ "ทั้ง N คีย์" มีเหตุครบทุกคีย์', async () => {
  let aRate = true; let bRate = false;
  const { pool, calls, clock } = makePool({ 'key-a': () => { if (aRate) throw err(429, 'rate_limit_error'); return okReply('จากคีย์ a'); }, 'key-b': () => { if (bRate) throw err(429, 'rate_limit_error'); return okReply('จากคีย์ b'); } });
  const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b'); // คีย์ a ถูกพัก 60 วินาที
  clock.t += 45000; aRate = false; bRate = true; calls.length = 0; // คีย์ a ฟื้นแล้วแต่ยังอยู่ในช่วงพัก · คีย์ b เต็ม
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ a', 'ต้องกลับไปลองคีย์ที่ถูกพักในคำขอเดียวกัน');
  assert.deepEqual(calls, ['key-b', 'key-b', 'key-a']);
  assert.deepEqual(pool.snapshot().map((k) => k.benched), [false, true]);

  // คีย์ 1 เครดิตหมด (ถูกพักอยู่) · คีย์ 2 โควตาเต็ม → ลองครบ 2 คีย์ และรายงานเหตุของทั้งสอง
  const two = makePool({ 'key-a': () => { throw err(402, 'billing_error'); }, 'key-b': () => { throw err(429, 'rate_limit_error'); } });
  const call2 = makeAnthropicCaller({ pool: two.pool, spec, role: 'นักเขียน', retryClock: noWait });
  await call2({ system: 's', user: 'u' }).catch(() => {});
  const again = await call2({ system: 's', user: 'u' }).then(() => null, (x) => x);
  assert.equal(again.errorType, 'ANTHROPIC_KEYS_EXHAUSTED');
  assert.ok(again.message.includes('คีย์ 1: เครดิตหมดหรือมีปัญหาการชำระเงิน') && again.message.includes('คีย์ 2: โควตาของบัญชีนี้เต็มชั่วคราว'), again.message);
});

test('คำตอบที่มาช้าของคำขอที่เริ่มก่อน ไม่ล้างการพักที่คำขออื่นเพิ่งตั้ง', async () => {
  let release; let n = 0;
  const { pool, calls } = makePool({ 'key-a': () => { n++; if (n === 1) return new Promise((r) => { release = () => r(okReply('คำตอบช้า')); }); throw err(402, 'billing_error'); }, 'key-b': () => okReply('จากคีย์ b') });
  const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
  const slow = call({ system: 's', user: 'u' });       // ค้างอยู่ที่คีย์ a
  await new Promise((r) => setImmediate(r));
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b'); // คีย์ a เครดิตหมดระหว่างนั้น → ถูกพัก
  release();
  assert.equal(await slow, 'คำตอบช้า');
  assert.equal(pool.snapshot()[0].benched, true, 'คีย์ a ต้องยังถูกพัก');
  assert.deepEqual([pool.snapshot()[0].down, pool.snapshot()[0].downReason], [true, KEY_REASON.billing], 'คำตอบช้าไม่ล้างคำเตือนถึงเจ้าของ');
  assert.equal(keyWarning(pool.snapshot())?.code, 'KEY_BENCHED');
  calls.length = 0;
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b');
  assert.deepEqual(calls, ['key-b'], 'คำขอถัดไปไม่วนกลับไปคีย์ที่เครดิตหมด');
});

test('ทุกคีย์ตอบ "ไม่พบโมเดล" = ชื่อโมเดลผิด ไม่ใช่ปัญหาของคีย์: ไม่พักคีย์ · ข้อความยังมีชื่อโมเดล · ไม่มีคำเตือนให้เติมเงิน', async () => {
  const notFound = () => { throw err(404, 'not_found_error', 'model: claude-typo'); };
  const { pool, calls } = makePool({ 'key-a': notFound, 'key-b': notFound });
  const e = await makeAnthropicCaller({ pool, spec, role: 'ผู้อ่านจับใจความ', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
  assert.deepEqual([e.errorType, e.message], ['MODEL_CALL_FAILED', 'เรียกผู้อ่านจับใจความไม่สำเร็จ (HTTP 404): model: claude-typo']);
  assert.deepEqual(calls, ['key-a', 'key-b']);
  assert.ok(pool.snapshot().every((k) => !k.benched));
  assert.equal(keyWarning(pool.snapshot()), null);
  // บัญชีของคีย์แรกใช้โมเดลนี้ไม่ได้ แต่คีย์ที่สองใช้ได้ = เป็นเรื่องของคีย์แรกจริง → พักคีย์แรก
  const mixed = makePool({ 'key-a': notFound, 'key-b': () => okReply('จากคีย์ b') });
  assert.equal(await makeAnthropicCaller({ pool: mixed.pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }), 'จากคีย์ b');
  assert.deepEqual(mixed.pool.snapshot().map((k) => k.kind), ['model', '']);
  assert.deepEqual(mixed.pool.snapshot().map((k) => [k.down, k.downReason]), [[true, KEY_REASON.model], [false, '']]);
  assert.ok(keyWarning(mixed.pool.snapshot()).message.includes(`คีย์ 1: ${KEY_REASON.model}`));
  // คีย์แรกตอบ "ไม่พบโมเดล" แล้วคีย์ถัดไปล้มด้วยเหตุที่ไม่ใช่ของคีย์ (ระบบล่ม/สายหลุด) = ยังไม่มีหลักฐานว่าคีย์แรกเสีย → ไม่พัก ไม่เตือน
  for (const other of [err(529, 'overloaded_error', 'overloaded'), new Error('Connection error.')]) {
    const p = makePool({ 'key-a': notFound, 'key-b': () => { throw other; } });
    const x = await makeAnthropicCaller({ pool: p.pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (v) => v);
    assert.ok(x.errorType === 'MODEL_CALL_FAILED' && x.message.includes(other.message), x.message);
    assert.deepEqual(p.pool.snapshot().map((k) => [k.benched, k.down]), [[false, false], [false, false]]);
    assert.equal(keyWarning(p.pool.snapshot()), null);
  }
  // คำขอ A ได้ "ไม่พบโมเดล" จากคีย์ 1 แล้วค้างที่คีย์ 2 · ระหว่างนั้นคำขอ B พบว่าคีย์ 1 เครดิตหมด → เมื่อ A จบด้วย 404 ครบทุกคีย์ ต้องไม่ลบการพักของ B
  let releaseB2; let aCalls = 0;
  const race = makePool({
    'key-a': () => { aCalls++; if (aCalls === 1) throw err(404, 'not_found_error', 'model: claude-typo'); throw err(402, 'billing_error'); },
    'key-b': () => new Promise((_, rej) => { releaseB2 = () => rej(err(404, 'not_found_error', 'model: claude-typo')); }),
  });
  const callA = makeAnthropicCaller({ pool: race.pool, spec, role: 'ผู้อ่านจับใจความ', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (v) => v);
  await new Promise((r) => setImmediate(r)); // A: คีย์ a ตอบ 404 แล้ว กำลังรอคีย์ b
  const firstB2 = releaseB2;
  const callB = race.pool.run(async (c) => c.messages.create()).then(() => null, (v) => v); // B: คีย์ a ตอบ 402 → พัก → ไปรอคีย์ b
  await new Promise((r) => setImmediate(r));
  firstB2(); releaseB2();
  assert.equal((await callA).errorType, 'MODEL_CALL_FAILED');
  await callB;
  assert.deepEqual(race.pool.snapshot().map((k) => [k.benched, k.kind, k.down]), [[true, 'billing', true], [false, '', false]], 'การพักเพราะเครดิตหมดต้องยังอยู่');

  // ทุกคีย์ล้มด้วยเหตุเดียวกันที่ไม่ใช่ 404 (เช่น 403) = หมดทุกคีย์จริง ไม่เข้าทาง "ชื่อโมเดลผิด"
  const forbidden = makePool({ 'key-a': () => { throw err(403, 'permission_error'); }, 'key-b': () => { throw err(403, 'permission_error'); } });
  const f = await makeAnthropicCaller({ pool: forbidden.pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (v) => v);
  assert.equal(f.errorType, 'ANTHROPIC_KEYS_EXHAUSTED');
  assert.deepEqual(forbidden.pool.snapshot().map((k) => [k.benched, k.down]), [[true, true], [true, true]]);
});

test('ค่าคีย์ไม่หลุดทางข้อความ error: ค่าที่วางผิดรูปไม่ถูกส่งเข้า SDK · ข้อความที่มีค่าคีย์ติดมาถูกลบก่อนส่งต่อ', async () => {
  // วางสองคีย์ในช่องเดียว (คนละบรรทัด) = แยกเป็นสองคีย์ · ค่าที่มีตัวอักษรซึ่ง header ไม่รับ = ข้าม
  const keys = readAnthropicKeys({ ANTHROPIC_API_KEY: 'sk-fake-AAA111\nsk-fake-BBB222', ANTHROPIC_API_KEY_2: 'sk-fake-CCC333, sk-fake-AAA111', ANTHROPIC_API_KEY_3: 'คีย์ภาษาไทย' });
  assert.deepEqual(keys.map((k) => [k.label, k.envName, k.key]), [['คีย์ 1', 'ANTHROPIC_API_KEY', 'sk-fake-AAA111'], ['คีย์ 2', 'ANTHROPIC_API_KEY', 'sk-fake-BBB222'], ['คีย์ 3', 'ANTHROPIC_API_KEY_2', 'sk-fake-CCC333']]);
  assert.ok(keys.every((k) => /^[!-~]+$/.test(k.key)));
  // ข้อผิดพลาดที่ไม่มีรหัส HTTP และมีค่าคีย์อยู่ในข้อความ (แบบที่ชั้น header โยน) → ข้อความที่ส่งต่อต้องไม่มีค่าคีย์
  const leaky = (key) => ({ messages: { create: async () => { throw new TypeError(`Headers.append: "${key}" is an invalid header value.`); } } });
  const pool = createKeyPool({ keys, makeClient: leaky });
  const viaPool = await makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
  assert.equal(viaPool.errorType, 'MODEL_CALL_FAILED');
  assert.ok(!/sk-fake/.test(viaPool.message) && viaPool.message.includes('[คีย์ถูกซ่อน]'), viaPool.message);
  assert.ok(!/sk-fake/.test(JSON.stringify(viaPool, Object.getOwnPropertyNames(viaPool))), 'ไม่มีค่าคีย์ในฟิลด์ใดของ error');
  // ทางคีย์เดียว (ไม่มีชุดคีย์): ลบตามรูปแบบคีย์ของ Anthropic
  const viaClient = await makeAnthropicCaller({ client: leaky('sk-ant-api03-ZZZZ9999zzzz'), spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
  assert.ok(!/ZZZZ9999/.test(viaClient.message), viaClient.message);
  assert.equal(redactKeys('ก่อน sk-ant-api03-abcDEF_123-xyz หลัง', []), 'ก่อน [คีย์ถูกซ่อน] หลัง');
  assert.equal(redactKeys('ค่า k สั้นเกินไป ไม่แตะ', ['k']), 'ค่า k สั้นเกินไป ไม่แตะ');
  // error ชนิด "ทุกคีย์ใช้ไม่ได้" ไม่พ่วงวัตถุ error ต้นทางของ SDK มาด้วย
  const dead = makePool({ 'sk-fake-AAA111': () => { throw err(402, 'billing_error'); }, 'sk-fake-BBB222': () => { throw err(401, 'authentication_error'); } });
  const exhausted = await dead.pool.run((c) => c.messages.create()).then(() => null, (x) => x);
  assert.deepEqual([exhausted.errorType, exhausted.cause], ['ANTHROPIC_KEYS_EXHAUSTED', undefined]);
});

test('คำเตือนถึงเจ้าของ: บอกตามจริงว่าเหลือคีย์ใช้ได้หรือหมดทุกคีย์ · โควตาเต็มชั่วคราวไม่เตือน', () => {
  // down = ใช้ไม่ได้ด้วยเหตุของคีย์เอง (ชุดคีย์ไม่ตั้ง down ให้โควตาเต็มชั่วคราว)
  const k = (n, benched, kind) => ({ label: `คีย์ ${n}`, envName: KEY_ENV_NAMES[n - 1], benched, kind: benched ? kind : '', reason: benched ? KEY_REASON[kind] : '', down: benched && kind !== 'rate', downReason: benched && kind !== 'rate' ? KEY_REASON[kind] : '' });
  assert.equal(keyWarning([k(1, false), k(2, false)]), null);
  assert.equal(keyWarning([k(1, true, 'rate'), k(2, false)]), null);
  assert.equal(keyWarning([]), null);
  assert.deepEqual(keyWarning([k(1, true, 'billing'), k(2, false), k(3, false)]), { code: 'KEY_BENCHED', message: 'คีย์ Anthropic ใช้ไม่ได้ 1 จาก 3 คีย์ (คีย์ 1: เครดิตหมดหรือมีปัญหาการชำระเงิน) — ระบบสลับไปใช้คีย์ที่เหลือแล้ว ให้เติมเงินหรือแก้คีย์ก่อนคีย์ที่เหลือหมด' });
  const all = keyWarning([k(1, true, 'billing'), k(2, true, 'auth')]);
  assert.equal(all.code, 'KEYS_ALL_BENCHED');
  assert.ok(all.message.includes('ครบทั้ง 2 คีย์') && all.message.includes('ต้องเติมเงินหรือแก้คีย์ทันที') && !all.message.includes('คีย์ที่เหลือ'), all.message);
  assert.deepEqual([...KEY_WARNING_CODES], ['KEY_BENCHED', 'KEYS_ALL_BENCHED']);
});

test('หน้าสถานะอ่านสัญญาณเรื่องคีย์จากประวัติงาน (ทุกเครื่องเห็นร่วมกัน): ดูงานล่าสุดที่จบแล้วใน 24 ชั่วโมง', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const warn = { code: 'KEY_BENCHED', message: 'คีย์ Anthropic ใช้ไม่ได้ 1 จาก 3 คีย์ (…)' };
  const done = (minAgo, warnings = []) => ({ status: 'done', finishedAt: at(minAgo), warnings });
  assert.equal(keyAlertFromRuns([], now), null);
  assert.equal(keyAlertFromRuns(null, now), null);
  assert.deepEqual(keyAlertFromRuns([done(30), done(5, [warn]), { status: 'running', createdAt: at(1) }], now), { level: 'warn', message: warn.message, at: at(5) });
  assert.equal(keyAlertFromRuns([done(30, [warn]), done(5)], now), null, 'งานล่าสุดปกติ = เติมเงินแล้ว ไม่เตือนค้าง');
  assert.equal(keyAlertFromRuns([done(25 * 60, [warn])], now), null, 'เก่ากว่า 24 ชั่วโมง ไม่เตือน');
  assert.equal(keyAlertFromRuns([done(5, [{ code: 'KEYS_ALL_BENCHED', message: 'หมดทุกคีย์' }])], now).level, 'bad');
  const failed = (error) => ({ status: 'failed', finishedAt: at(2), error });
  assert.equal(keyAlertFromRuns([done(9), failed('เขียนไม่สำเร็จทั้ง 3 เวอร์ชัน: เรียกนักเขียนไม่ได้: คีย์ Anthropic ใช้ไม่ได้ทั้ง 2 คีย์ (คีย์ 1: …)')], now).level, 'bad');
  assert.equal(keyAlertFromRuns([failed('เรียกนักเขียนไม่สำเร็จ (HTTP 402): เครดิตหมดหรือมีปัญหาการชำระเงิน · credit balance is too low')], now).level, 'bad', 'คีย์เดียวแล้วเครดิตหมดก็ต้องเตือน');
  assert.equal(keyAlertFromRuns([failed('เรียกนักเขียนไม่สำเร็จ (HTTP 529): overloaded')], now), null, 'ล้มด้วยเหตุอื่น ไม่ใช่เรื่องคีย์');
  // งานที่ล้มด้วยเหตุอื่นไม่ได้พิสูจน์ว่าคีย์กลับมาใช้ได้ → คำเตือนเดิมต้องยังอยู่ (ลำดับในรายการไม่เกี่ยว ดูจากเวลา)
  assert.deepEqual(keyAlertFromRuns([failed('งานใช้เวลาเกิน 285 วินาที'), done(10, [warn]), done(40)], now), { level: 'warn', message: warn.message, at: at(10) });
  assert.equal(keyAlertFromRuns([done(1), failed('งานใช้เวลาเกิน 285 วินาที'), done(10, [warn])], now), null, 'งานสำเร็จที่ใหม่กว่าและไม่มีคำเตือน = คีย์กลับมาแล้ว');
  // งานที่ล้มแต่พกคำเตือนเรื่องคีย์ (server.js แนบให้) ก็นับ
  assert.equal(keyAlertFromRuns([{ status: 'failed', finishedAt: at(3), error: 'งานใช้เวลาเกิน 285 วินาที', warnings: [warn] }, done(20)], now).level, 'warn');
  assert.equal(keyAlertFromRuns([done(23 * 60, [warn])], now).level, 'warn', 'ภายใน 24 ชั่วโมงยังเตือน');
  // แถวที่ไม่มีเวลาจบ/เวลาผิดรูป ไม่บังแถวจริง · คำเตือนชนิดอื่นไม่ใช่เรื่องคีย์ · รูปของคำเตือนจากงานที่ล้มเพราะคีย์
  assert.deepEqual(keyAlertFromRuns([{ status: 'done' }, { status: 'done', finishedAt: 'not-a-date' }, done(5, [warn])], now), { level: 'warn', message: warn.message, at: at(5) });
  assert.equal(keyAlertFromRuns([done(2, [{ code: 'NO_DIRECTION', message: 'x' }])], now), null);
  const long = `เรียกนักเขียนไม่ได้: คีย์ Anthropic ใช้ไม่ได้ทั้ง 2 คีย์ (${'x'.repeat(400)})`;
  assert.deepEqual(keyAlertFromRuns([failed(long)], now), { level: 'bad', message: `งานล่าสุดล้มเพราะคีย์ Anthropic: ${long.slice(0, 300)}`, at: at(2) });
  // เหตุของคีย์ทั้งสามชนิดที่เจ้าของต้องลงมือเอง ถูกจับได้จากข้อความของงานที่ล้ม
  for (const reason of [KEY_REASON.billing, KEY_REASON.auth, KEY_REASON.permission]) assert.equal(keyAlertFromRuns([failed(`เรียกนักเขียนไม่สำเร็จ (HTTP 4xx): ${reason} · provider text`)], now).level, 'bad', reason);
});

test('แยกเหตุ (ละเอียด): ดูได้จากรหัส HTTP อย่างเดียว หรือ .type อย่างเดียว · คำในข้อความ 400 แต่ละคำใช้ได้เดี่ยวๆ · คำเรื่องเงินในข้อผิดพลาดอื่นไม่นับ', () => {
  for (const [status, type, kind] of [[401, 'authentication_error', 'auth'], [403, 'permission_error', 'permission'], [404, 'not_found_error', 'model'], [429, 'rate_limit_error', 'rate']]) {
    assert.equal(classifyKeyFailure({ status }), kind, `status ${status}`);
    assert.equal(classifyKeyFailure({ type }), kind, type);
    assert.equal(classifyKeyFailure({ error: { type: 'error', error: { type } } }), kind, `nested ${type}`);
    assert.equal(classifyKeyFailure({ error: { type } }), kind, `error.type ${type}`);
  }
  for (const msg of ['You have reached your specified API usage limits.', 'You will regain access on 2026-12-01.', 'Billing is not set up for this organization', 'Your credit balance is too low']) {
    assert.equal(classifyKeyFailure(err(400, 'invalid_request_error', msg)), 'billing', msg);
  }
  assert.equal(classifyKeyFailure(err(500, 'api_error', 'billing service unavailable')), null);
  assert.equal(classifyKeyFailure(new Error('credit balance lookup timed out')), null, 'ไม่มีรหัส 400 = ไม่ใช่เรื่องเครดิตของคีย์');
});

test('ระยะพักคีย์ตามเหตุ (ค่าตายตัว) · ครบเวลาแล้วสถานะ "พัก" หาย แต่คำเตือนถึงเจ้าของยังอยู่จนกว่าคีย์นั้นจะกลับมาสำเร็จ', async () => {
  assert.deepEqual({ ...KEY_BENCH_MS }, { billing: 600000, auth: 1800000, permission: 1800000, model: 1800000, rate: 60000 });
  for (const [status, type, kind, ms] of [[402, 'billing_error', 'billing', 600000], [401, 'authentication_error', 'auth', 1800000], [403, 'permission_error', 'permission', 1800000], [429, 'rate_limit_error', 'rate', 60000]]) {
    let dead = true;
    const { pool, clock, calls } = makePool({ 'key-a': () => { if (dead) throw err(status, type); return okReply('จากคีย์ a'); }, 'key-b': () => okReply('จากคีย์ b') });
    const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
    assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b');
    let a = pool.snapshot()[0];
    assert.deepEqual([a.benched, a.kind, Date.parse(a.retryAt) - clock.t], [true, kind, ms], kind);
    assert.deepEqual([a.down, a.downReason], kind === 'rate' ? [false, ''] : [true, KEY_REASON[kind]], `down ${kind}`);
    assert.equal(keyWarning(pool.snapshot())?.code, kind === 'rate' ? undefined : 'KEY_BENCHED');
    // ครบเวลาพัก โดยยังไม่มีคำขอใหม่: สถานะพักหาย · แต่คีย์ที่ล้มด้วยเหตุของคีย์เองยังถูกเตือน (ไม่ขึ้นกับนาฬิกา)
    clock.t += ms + 1;
    a = pool.snapshot()[0];
    assert.deepEqual([a.benched, a.kind, a.reason, a.retryAt], [false, '', '', ''], `expired ${kind}`);
    assert.equal(keyWarning(pool.snapshot())?.code, kind === 'rate' ? undefined : 'KEY_BENCHED', 'คำเตือนไม่หายเองตามเวลา');
    if (kind !== 'rate') assert.ok(keyWarning(pool.snapshot()).message.includes(`(คีย์ 1: ${KEY_REASON[kind]})`), 'ครบเวลาพักแล้วคำเตือนยังบอกเหตุ');
    // คีย์กลับมาใช้ได้ (เติมเงิน/แก้แล้ว): คำขอถัดไปลองคีย์นั้นก่อน สำเร็จ → คำเตือนหาย
    dead = false; calls.length = 0;
    assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ a');
    assert.deepEqual(calls, ['key-a']);
    assert.equal(keyWarning(pool.snapshot()), null);
    assert.equal(pool.snapshot()[0].down, false);
  }
});

test('คีย์ที่ใช้ไม่ได้: ล้มซ้ำด้วยเหตุอื่นไม่ทำให้คำเตือนหาย · คีย์สำรองที่เจ้าของแก้แล้วถูกลองใหม่เอง แม้คีย์ก่อนหน้ายังดี', async () => {
  // เครดิตหมด → ครบเวลาพัก → ล้มอีกด้วยโควตาเต็มชั่วคราว: ยัง "ใช้ไม่ได้เพราะเครดิต" · ล้มอีกด้วยคีย์ถูกยกเลิก: เหตุเปลี่ยนตามล่าสุด
  for (const [status, type, kind, downReason] of [[429, 'rate_limit_error', 'rate', KEY_REASON.billing], [401, 'authentication_error', 'auth', KEY_REASON.auth]]) {
    let phase = 1;
    const { pool, clock } = makePool({ 'key-a': () => { throw phase === 1 ? err(402, 'billing_error') : err(status, type); }, 'key-b': () => okReply('จากคีย์ b') });
    const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
    await call({ system: 's', user: 'u' });
    clock.t += KEY_BENCH_MS.billing + 1; phase = 2;
    assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b');
    const a = pool.snapshot()[0];
    assert.deepEqual([a.benched, a.kind, a.down, a.downReason], [true, kind, true, downReason]);
    assert.ok(keyWarning(pool.snapshot()).message.includes(`(คีย์ 1: ${downReason})`));
  }
  // คีย์ 1 ดี · คีย์ 2 เคยเครดิตหมด (ตอนคีย์ 1 โควตาเต็มชั่วคราว) แล้วเจ้าของเติมเงิน → ครบเวลาพัก คำขอถัดไปลองคีย์ 2 ก่อน 1 ครั้ง สำเร็จ = คำเตือนหาย แล้วกลับไปใช้คีย์ 1
  let aRate = true; let bDead = true;
  const { pool, clock, calls } = makePool({ 'key-a': () => { if (aRate) throw err(429, 'rate_limit_error'); return okReply('จากคีย์ a'); }, 'key-b': () => { if (bDead) throw err(402, 'billing_error'); return okReply('จากคีย์ b'); }, 'key-c': () => okReply('จากคีย์ c') });
  const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ c');
  aRate = false; clock.t += KEY_BENCH_MS.rate + 1; calls.length = 0;
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ a');
  assert.deepEqual(calls, ['key-a'], 'ระหว่างที่คีย์ 2 ยังอยู่ในช่วงพัก ไม่แตะคีย์ 2');
  assert.equal(keyWarning(pool.snapshot())?.code, 'KEY_BENCHED');
  clock.t += KEY_BENCH_MS.billing + 1; calls.length = 0; // ครบเวลาพักของคีย์ 2 แต่ยังไม่ได้เติมเงิน → ลอง 1 ครั้ง ล้ม พักต่อ งานเดินด้วยคีย์ 1
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ a');
  assert.deepEqual(calls, ['key-b', 'key-a']);
  calls.length = 0;
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ a');
  assert.deepEqual(calls, ['key-a'], 'ลองคีย์ที่เสียแค่ครั้งเดียวต่อรอบพัก');
  bDead = false; clock.t += KEY_BENCH_MS.billing + 1; calls.length = 0; // เติมเงินแล้ว
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ b');
  assert.equal(keyWarning(pool.snapshot()), null, 'คำเตือนหายเองหลังคีย์กลับมาใช้ได้');
  calls.length = 0;
  assert.equal(await call({ system: 's', user: 'u' }), 'จากคีย์ a', 'กลับไปใช้ตามลำดับเลข');
  assert.deepEqual(calls, ['key-a']);

  // คีย์ที่ถูกพักหลายตัว: ลองตัวที่ใกล้ครบเวลาพักก่อน
  const four = makePool({ 'key-a': () => { throw err(402, 'billing_error'); }, 'key-b': () => { throw err(401, 'authentication_error'); }, 'key-c': () => { throw err(403, 'permission_error'); }, 'key-d': () => { throw err(402, 'billing_error'); } });
  await four.pool.run((c) => c.messages.create()).catch(() => {});
  four.calls.length = 0;
  await four.pool.run((c) => c.messages.create()).catch(() => {});
  assert.deepEqual(four.calls, ['key-a', 'key-d', 'key-b', 'key-c']);
});

test('ข้อความของงานที่ล้มเพราะคีย์ (จากตัวเรียกจริง) ทำให้หน้าสถานะเตือนได้ ทั้งทางชุดคีย์และทางคีย์เดียว', async () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  for (const [status, type, kind] of [[402, 'billing_error', 'billing'], [401, 'authentication_error', 'auth'], [403, 'permission_error', 'permission']]) {
    const client = { messages: { create: async () => { throw err(status, type, 'provider text'); } } };
    const pool = createKeyPool({ keys: readAnthropicKeys({ ANTHROPIC_API_KEY: 'only-key-123' }), makeClient: () => client });
    for (const opts of [{ pool }, { client }]) {
      const e = await makeAnthropicCaller({ ...opts, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
      assert.equal(e.message, `เรียกนักเขียนไม่สำเร็จ (HTTP ${status}): ${KEY_REASON[kind]} · provider text`);
      assert.equal(keyAlertFromRuns([{ status: 'failed', finishedAt: new Date(now - 60000).toISOString(), error: `เขียนไม่สำเร็จทั้ง 3 เวอร์ชัน: ${e.message}` }], now)?.level, 'bad', kind);
    }
  }
  // โควตาเต็มชั่วคราว/ไม่พบโมเดล ไม่มีคำนำหน้า (ไม่ใช่เรื่องที่ต้องเติมเงินหรือแก้คีย์)
  for (const [status, type] of [[429, 'rate_limit_error'], [404, 'not_found_error']]) {
    const e = await makeAnthropicCaller({ client: { messages: { create: async () => { throw err(status, type, 'provider text'); } } }, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
    assert.equal(e.message, `เรียกนักเขียนไม่สำเร็จ (HTTP ${status}): provider text`);
  }
});

test('สลับคีย์แล้วเจอเหตุที่ไม่ใช่ของคีย์ = หยุดทันที ไม่ไปคีย์ถัดไป ไม่ล้างการพักที่ตั้งไว้ · สถานะหลังทุกคีย์ล้มใช้ออกคำเตือนได้จริง', async () => {
  const three = makePool({ 'key-a': () => { throw err(402, 'billing_error'); }, 'key-b': () => { throw err(400, 'invalid_request_error', 'bad request'); }, 'key-c': () => okReply('ไม่ควรถึง') });
  const e = await makeAnthropicCaller({ pool: three.pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
  assert.equal(e.errorType, 'MODEL_CALL_FAILED');
  assert.ok(e.message.includes('(HTTP 400)') && e.message.includes('bad request'), e.message);
  assert.deepEqual(three.calls, ['key-a', 'key-b']);
  assert.deepEqual(three.pool.snapshot().map((k) => k.benched), [true, false, false]);

  const dead = makePool({ 'key-a': () => { throw err(402, 'billing_error'); }, 'key-b': () => { throw err(401, 'authentication_error'); } });
  await makeAnthropicCaller({ pool: dead.pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).catch(() => {});
  assert.deepEqual(dead.pool.snapshot().map((k) => [k.benched, k.kind, k.down]), [[true, 'billing', true], [true, 'auth', true]]);
  assert.equal(keyWarning(dead.pool.snapshot()).code, 'KEYS_ALL_BENCHED');

  const one = makePool({ 'key-a': () => { throw err(403, 'permission_error'); }, 'key-b': () => okReply('จากคีย์ b') });
  assert.equal(await makeAnthropicCaller({ pool: one.pool, spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }), 'จากคีย์ b');
  assert.deepEqual(keyWarning(one.pool.snapshot()), { code: 'KEY_BENCHED', message: 'คีย์ Anthropic ใช้ไม่ได้ 1 จาก 2 คีย์ (คีย์ 1: คีย์นี้ไม่มีสิทธิ์) — ระบบสลับไปใช้คีย์ที่เหลือแล้ว ให้เติมเงินหรือแก้คีย์ก่อนคีย์ที่เหลือหมด' });
});

test('ชื่อโมเดลผิด + มีคีย์ที่ตายจริงอยู่ด้วย: ข้อความยังบอกชื่อโมเดล · คีย์ที่ยังดีไม่ถูกพัก · คีย์ที่เครดิตหมดยังถูกเตือนตามจริง', async () => {
  for (const order of [[402, 404], [404, 402]]) {
    const thrower = (s) => () => { throw s === 404 ? err(404, 'not_found_error', 'model: claude-typo') : err(402, 'billing_error', 'credit balance is too low'); };
    const p = makePool({ 'key-a': thrower(order[0]), 'key-b': thrower(order[1]) });
    const e = await makeAnthropicCaller({ pool: p.pool, spec, role: 'ผู้อ่านจับใจความ', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
    assert.deepEqual([e.errorType, e.message], ['MODEL_CALL_FAILED', 'เรียกผู้อ่านจับใจความไม่สำเร็จ (HTTP 404): model: claude-typo'], `ลำดับ ${order}`);
    const snap = p.pool.snapshot();
    const dead = order.indexOf(402); const fine = order.indexOf(404);
    assert.deepEqual([snap[dead].benched, snap[dead].kind, snap[dead].down], [true, 'billing', true]);
    assert.deepEqual([snap[fine].benched, snap[fine].down], [false, false], 'คีย์ที่ตอบ 404 ไม่ถูกชี้ว่าเสีย');
    assert.equal(keyWarning(snap).code, 'KEY_BENCHED', 'ไม่ใช่ "หมดทุกคีย์"');
  }
  // คีย์ที่ถูกพักเพราะเครดิตอยู่ก่อน แล้วมาตอบ 404 ในคำขอนี้ → คืนสถานะพักเดิม ไม่ล้างทิ้ง
  let phase = 1;
  const p = makePool({ 'key-a': () => { throw phase === 1 ? err(402, 'billing_error') : err(404, 'not_found_error', 'model: x'); }, 'key-b': () => { if (phase === 1) return okReply('จากคีย์ b'); throw err(404, 'not_found_error', 'model: x'); } });
  const call = makeAnthropicCaller({ pool: p.pool, spec, role: 'นักเขียน', retryClock: noWait });
  await call({ system: 's', user: 'u' });
  phase = 2;
  await call({ system: 's', user: 'u' }).catch(() => {});
  assert.deepEqual(p.pool.snapshot().map((k) => [k.benched, k.kind, k.down]), [[true, 'billing', true], [false, '', false]]);
});

test('ค่าคีย์ไม่หลุด (ละเอียด): คีย์สำรอง · โผล่หลายครั้ง · คร่อมจุดตัดข้อความ · หลายคีย์ในข้อความเดียว', async () => {
  const k2 = 'sk-fake-BBB222-backup';
  const pool = (thrown) => createKeyPool({
    keys: readAnthropicKeys({ ANTHROPIC_API_KEY: 'sk-fake-AAA111', ANTHROPIC_API_KEY_2: k2 }),
    makeClient: (key) => ({ messages: { create: async () => { if (key !== k2) throw err(402, 'billing_error'); throw thrown; } } }),
  });
  for (const thrown of [new TypeError(`Headers.append: "${k2}" is invalid (${k2})`), new TypeError('x'.repeat(152) + k2)]) {
    const e = await makeAnthropicCaller({ pool: pool(thrown), spec, role: 'นักเขียน', retryClock: noWait })({ system: 's', user: 'u' }).then(() => null, (x) => x);
    assert.equal(e.errorType, 'MODEL_CALL_FAILED');
    assert.ok(!/sk-fake/.test(e.message), e.message);
  }
  assert.equal(redactKeys('a sk-ant-api03-AAAAAAAAAA b sk-ant-api03-BBBBBBBBBB', []), 'a [คีย์ถูกซ่อน] b [คีย์ถูกซ่อน]');
  assert.equal(redactKeys('k1=secret-one-1 k2=secret-two-2 again secret-one-1', ['secret-one-1', 'secret-two-2']), 'k1=[คีย์ถูกซ่อน] k2=[คีย์ถูกซ่อน] again [คีย์ถูกซ่อน]');
});

test('ค่าที่วางมาไม่สะอาด: ตัวอักษรล่องหน/เครื่องหมายคำพูดโค้งถูกล้างให้ใช้ได้ · ค่าที่ใช้ไม่ได้จริงถูกรายงานด้วยชื่อตัวแปร (ไม่เงียบหาย)', async () => {
  const env = { ANTHROPIC_API_KEY: 'key-main-001​', ANTHROPIC_API_KEY_2: '“key-back-002”', ANTHROPIC_API_KEY_3: 'key-a;key-b\tkey-c key-d', ANTHROPIC_API_KEY_4: 'คีย์ไทย', ANTHROPIC_API_KEY_5: 'ok-key-005 เสีย\u0001' };
  assert.deepEqual(readAnthropicKeys(env).map((k) => k.key), ['key-main-001', 'key-back-002', 'key-a', 'key-b', 'key-c', 'key-d', 'ok-key-005']);
  assert.deepEqual(skippedAnthropicEnvNames(env), ['ANTHROPIC_API_KEY_4', 'ANTHROPIC_API_KEY_5']);
  assert.deepEqual(skippedAnthropicEnvNames({ ANTHROPIC_API_KEY: 'good-key' }), []);
  // ตัวอักษรล่องหนทุกชนิด ทั้งหัว กลาง ท้าย · เครื่องหมายคำพูดโค้งเดี่ยว และซ้อนหลายชั้น
  assert.deepEqual(readAnthropicKeys({ ANTHROPIC_API_KEY: '﻿key‌-ma‍in⁠-001​' }).map((k) => k.key), ['key-main-001']);
  assert.deepEqual(readAnthropicKeys({ ANTHROPIC_API_KEY: '‘key-one-001’', ANTHROPIC_API_KEY_2: '“"key-two-002"”' }).map((k) => k.key), ['key-one-001', 'key-two-002']);
  // ค่าที่ขึ้นต้นถูกแต่มีตัวอักษรใช้ไม่ได้ต่อท้าย/แทรกกลาง (ไทย · ตัวควบคุม · ละติน-1) = ข้ามทั้งค่า และรายงานชื่อตัวแปร
  const badTail = { ANTHROPIC_API_KEY: 'sk-good-123(สำรอง)', ANTHROPIC_API_KEY_2: 'abc\u0001def', ANTHROPIC_API_KEY_3: 'café-key-003' };
  assert.deepEqual(readAnthropicKeys(badTail), []);
  assert.deepEqual(skippedAnthropicEnvNames(badTail), ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3']);
  const twoBad = createKeyPool({ keys: [], skipped: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_2'], makeClient: () => ({}) });
  await assert.rejects(() => twoBad.run(async () => 'x'), (x) => x.errorType === 'ANTHROPIC_KEY_MISSING' && x.message === 'ค่าใน ANTHROPIC_API_KEY, ANTHROPIC_API_KEY_2 มีตัวอักษรที่ใช้เป็นคีย์ไม่ได้ ให้วางคีย์ใหม่');
  assert.deepEqual(skippedAnthropicEnvNames({}), []);
  // ตั้งค่าไว้แต่ใช้ไม่ได้เลย: ข้อความต้องบอกว่าค่าที่วางไว้ผิด ไม่ใช่ "ยังไม่ได้ตั้งค่า" · ไม่มีค่าที่วางไว้ในข้อความ
  const bad = { ANTHROPIC_API_KEY: 'คีย์เสีย-secret' };
  const empty = createKeyPool({ keys: readAnthropicKeys(bad), skipped: skippedAnthropicEnvNames(bad), makeClient: () => { throw new Error('ไม่ควรถูกเรียก'); } });
  const e = await makeAnthropicCaller({ pool: empty, spec, role: 'นักเขียน' })({ system: 's', user: 'u' }).then(() => null, (x) => x);
  assert.deepEqual([e.errorType, e.message], ['ANTHROPIC_KEY_MISSING', 'เรียกนักเขียนไม่ได้: ค่าใน ANTHROPIC_API_KEY มีตัวอักษรที่ใช้เป็นคีย์ไม่ได้ ให้วางคีย์ใหม่']);
});

test('ข้อความ error ที่ส่งต่อถึงหน้าเว็บ/คิว ไม่มีค่าคีย์ · คำเตือนเรื่องคีย์สำรองไม่ถูกส่งถึงพนักงานใน Discord', async () => {
  const { pool } = makePool({ 'sk-fake-AAA111': () => { throw err(401, 'authentication_error', 'invalid x-api-key'); }, 'sk-fake-BBB222': () => { throw err(402, 'billing_error', 'credit balance is too low'); } });
  const call = makeAnthropicCaller({ pool, spec, role: 'นักเขียน', retryClock: noWait });
  const caught = await call({ system: 's', user: 'u' }).then(() => null, (e) => e);
  assert.ok(caught && !/sk-fake/.test(caught.message) && !/sk-fake/.test(JSON.stringify(pool.snapshot())));
  const run = { versions: [], warnings: [{ code: 'KEY_BENCHED', message: 'คีย์ Anthropic ใช้ไม่ได้ 1 คีย์ (คีย์ 1: เครดิตหมด) — งานนี้เขียนด้วยคีย์สำรอง' }, { code: 'NO_DIRECTION', message: 'กำหนดทิศทางข่าวไม่สำเร็จ' }] };
  assert.deepEqual(runQualityWarnings(run), ['กำหนดทิศทางข่าวไม่สำเร็จ'], 'เรื่องคีย์เป็นของเจ้าของ ไม่ใช่จุดให้พนักงานตรวจ');
  for (const code of KEY_WARNING_CODES) assert.deepEqual(runQualityWarnings({ versions: [], warnings: [{ code, message: 'เรื่องคีย์' }] }), [], code);
});
