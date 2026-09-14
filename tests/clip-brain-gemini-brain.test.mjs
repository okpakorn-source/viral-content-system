/**
 * ★ 14 ก.ย. 69 P12 — สมอง brain:'gemini' ใน brainRunner (เรียก API ตรง)
 * ทุกเคสสตับ globalThis.fetch — ห้ามยิง Gemini จริง · ตรวจทั้งคำขอที่ส่งออกและผลที่คืน
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { runBrain, checkBrain } = await import(new URL('../src/lib/services/clipBrain/brainRunner.js', import.meta.url).href);

const ENV_KEYS = ['GEMINI_API_KEY', 'CLIP_GEMINI_API_KEY', 'CLIP_GEMINI_MAX_CONCURRENT', 'CLIP_GEMINI_MODEL', 'CLIP_GEMINI_TEMPERATURE',
  'CLIP_GEMINI_MAX_OUTPUT_TOKENS', 'CLIP_BRAIN_TIMEOUT_MS', 'CLIP_GEMINI_RATE_IN', 'CLIP_GEMINI_RATE_OUT'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** สตับ fetch: replies = ลำดับคำตอบ ({status, body} หรือ Error หรือ {waitAbort:true}) · เก็บทุกคำขอ */
async function withGemini(replies, fn, env = {}) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { GEMINI_API_KEY: 'test-key', CLIP_GEMINI_RATE_IN: '1', CLIP_GEMINI_RATE_OUT: '2', ...env });
  const savedFetch = globalThis.fetch, savedLog = console.log, savedWarn = console.warn;
  const requests = [];
  console.log = () => {}; console.warn = () => {};
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(init.body) });
    const reply = replies.shift();
    if (reply === undefined) throw new Error('unexpected fetch');
    if (reply instanceof Error) throw reply;
    if (reply.waitAbort) {
      await new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; reject(e); }));
    }
    if (reply.delayMs) await sleep(reply.delayMs);
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  };
  try { return await fn(requests); } finally {
    globalThis.fetch = savedFetch; console.log = savedLog; console.warn = savedWarn;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    assert.equal(replies.length, 0, 'ทุกคำตอบที่เตรียมไว้ต้องถูกใช้');
  }
}
const okBody = (text, extra = {}) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra.cand }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, thoughtsTokenCount: 250, ...extra.usage }, ...extra.top });

test('gemini: คำขอถูกรูป (URL รุ่น · กุญแจใน header · JSON mode · thinkingLevel จาก effort) และผลรูปทรงเดียวกับสมอง CLI', async () => {
  await withGemini([{ status: 200, body: okBody('{"a":1}') }], async (requests) => {
    const r = await runBrain({ brain: 'gemini', prompt: 'สวัสดี', effort: 'xhigh', label: 'clip-compose-compose', timeoutMs: 5000 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', 'รุ่นเริ่มต้น 3.8 flash');
    assert.equal(requests[0].init.headers['x-goog-api-key'], 'test-key');
    assert.ok(!requests[0].url.includes('test-key'), 'ห้ามใส่กุญแจใน URL');
    assert.deepEqual(requests[0].body.contents, [{ role: 'user', parts: [{ text: 'สวัสดี' }] }]);
    assert.deepEqual(requests[0].body.generationConfig, { temperature: 0.2, maxOutputTokens: 65536, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'high' } });
    assert.ok(requests[0].init.signal instanceof AbortSignal, 'ต้องมีเพดานเวลา');
    assert.deepEqual([r.brain, r.label, r.account, r.model, r.effortApplied, r.effortIgnored], ['gemini', 'clip-compose-compose', 'api', 'gemini-3.8-flash', 'high', false]);
    assert.deepEqual(r.json, { a: 1 }); assert.equal(r.text, '{"a":1}');
    assert.equal(r.tokensUsed, 1750, 'นับ input+output+thoughts');
    assert.equal(r.costUSD, 1000 / 1e6 * 1 + 750 / 1e6 * 2, 'thoughts คิดราคาเป็น output');
    assert.deepEqual(r.usage, { input: 1000, output: 500, thoughts: 250 });
    assert.equal(r.retries, 0); assert.equal(r.truncated, false); assert.ok(r.elapsedMs >= 0);
  });
});

test('gemini: effort ต่ำ/กลาง map ตรง · ไม่ส่ง effort = ไม่มี thinkingConfig · effort ไม่รู้จัก = effortIgnored · expectJson:false = ไม่บังคับ JSON', async () => {
  await withGemini([{ status: 200, body: okBody('x') }, { status: 200, body: okBody('y') }, { status: 200, body: okBody('z') }, { status: 200, body: okBody('ข้อความล้วน') }], async (requests) => {
    const a = await runBrain({ brain: 'gemini', prompt: 'p', effort: 'low', expectJson: false });
    const b = await runBrain({ brain: 'gemini', prompt: 'p', effort: 'medium', expectJson: false });
    const c = await runBrain({ brain: 'gemini', prompt: 'p', effort: 'weird', expectJson: false });
    const d = await runBrain({ brain: 'gemini', prompt: 'p', expectJson: false, model: 'gemini-3.7-flash' });
    assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.equal(requests[1].body.generationConfig.thinkingConfig.thinkingLevel, 'medium');
    assert.equal(requests[2].body.generationConfig.thinkingConfig, undefined); assert.equal(c.effortIgnored, true);
    assert.equal(requests[3].body.generationConfig.thinkingConfig, undefined);
    assert.equal(requests[3].body.generationConfig.responseMimeType, undefined, 'expectJson:false ไม่บังคับ JSON');
    assert.ok(requests[3].url.includes('gemini-3.7-flash'));
    assert.deepEqual([a.ok, b.ok, c.ok, d.ok, d.json, d.text], [true, true, true, true, null, 'ข้อความล้วน']);
  });
});

test('gemini: ไม่มีกุญแจ = BRAIN_AUTH โดยไม่ยิง · พรอมต์ว่าง = BRAIN_EMPTY_PROMPT · ชื่อรุ่นสกปรก = BRAIN_BAD_MODEL · CLIP_GEMINI_API_KEY ชนะ', async () => {
  await withGemini([], async (requests) => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p' });
    assert.deepEqual([r.ok, r.errorType, requests.length], [false, 'BRAIN_AUTH', 0]);
  }, { GEMINI_API_KEY: '' });
  await withGemini([], async () => {
    assert.equal((await runBrain({ brain: 'gemini', prompt: '   ' })).errorType, 'BRAIN_EMPTY_PROMPT');
    assert.equal((await runBrain({ brain: 'gemini', prompt: 'p', model: '../evil; rm' })).errorType, 'BRAIN_BAD_MODEL');
  });
  await withGemini([{ status: 200, body: okBody('{}') }], async (requests) => {
    await runBrain({ brain: 'gemini', prompt: 'p' });
    assert.equal(requests[0].init.headers['x-goog-api-key'], 'clip-key');
  }, { CLIP_GEMINI_API_KEY: 'clip-key' });
});

test('gemini: 429 ยิงซ้ำ 1 ครั้งแล้วเป็น BRAIN_QUOTA · 429→200 สำเร็จพร้อม retries=1 · 401/403 = BRAIN_AUTH ไม่ยิงซ้ำ · 400 = BRAIN_API_ERROR ไม่ยิงซ้ำ · 500→200 สำเร็จ', async () => {
  const err = (status, message) => ({ status, body: { error: { code: status, message } } });
  await withGemini([err(429, 'quota'), err(429, 'quota')], async (requests) => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 30000 });
    assert.deepEqual([r.ok, r.errorType, r.httpStatus, r.retries, requests.length], [false, 'BRAIN_QUOTA', 429, 1, 2]);
  });
  await withGemini([err(429, 'quota'), { status: 200, body: okBody('{"k":2}') }], async () => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 30000 });
    assert.deepEqual([r.ok, r.retries, r.json], [true, 1, { k: 2 }]);
  });
  await withGemini([err(403, 'API key not valid')], async (requests) => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 30000 });
    assert.deepEqual([r.errorType, requests.length], ['BRAIN_AUTH', 1]);
  });
  await withGemini([err(401, 'unauthenticated')], async () => assert.equal((await runBrain({ brain: 'gemini', prompt: 'p' })).errorType, 'BRAIN_AUTH'));
  await withGemini([err(400, 'bad request')], async (requests) => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 30000 });
    assert.deepEqual([r.errorType, r.httpStatus, requests.length], ['BRAIN_API_ERROR', 400, 1]);
  });
  await withGemini([err(503, 'overloaded'), { status: 200, body: okBody('{"k":3}') }], async () => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 30000 });
    assert.deepEqual([r.ok, r.retries], [true, 1]);
  });
  // เวลาไม่พอสำหรับยิงซ้ำ (เพดาน < 3 วิ) → ไม่รอ 2 วิ ทิ้ง ตอบทันที
  await withGemini([err(429, 'quota')], async (requests) => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 2500 });
    assert.deepEqual([r.errorType, requests.length], ['BRAIN_QUOTA', 1]);
  });
});

test('gemini: เน็ตสะดุด ยิงซ้ำแล้วสำเร็จ · สะดุดสองครั้ง = BRAIN_API_ERROR · หมดเวลา = BRAIN_TIMEOUT (ไม่ยิงซ้ำ)', async () => {
  await withGemini([new TypeError('fetch failed'), { status: 200, body: okBody('{"n":1}') }], async () => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 30000 });
    assert.deepEqual([r.ok, r.retries], [true, 1]);
  });
  await withGemini([new TypeError('fetch failed'), new TypeError('fetch failed')], async () => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 30000 });
    assert.deepEqual([r.ok, r.errorType, r.retries], [false, 'BRAIN_API_ERROR', 1]);
  });
  await withGemini([{ waitAbort: true, status: 200, body: {} }], async (requests) => {
    const t0 = Date.now();
    const r = await runBrain({ brain: 'gemini', prompt: 'p', timeoutMs: 120 });
    assert.deepEqual([r.ok, r.errorType, requests.length], [false, 'BRAIN_TIMEOUT', 1]);
    assert.ok(Date.now() - t0 < 3000, 'หมดเวลาแล้วต้องไม่นั่งรอยิงซ้ำ');
  });
});

test('gemini: MAX_TOKENS = BRAIN_TRUNCATED · SAFETY/blockReason = BRAIN_BLOCKED · ว่าง = BRAIN_EMPTY_ANSWER · ไม่ใช่ JSON = BRAIN_BAD_JSON (ยังคืน usage/cost)', async () => {
  await withGemini([{ status: 200, body: okBody('{"half":', { cand: { finishReason: 'MAX_TOKENS' } }) }], async () => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p' });
    assert.deepEqual([r.errorType, r.finishReason, r.tokensUsed], ['BRAIN_TRUNCATED', 'MAX_TOKENS', 1750]);
  });
  await withGemini([{ status: 200, body: okBody('', { cand: { finishReason: 'SAFETY' } }) }], async () => assert.equal((await runBrain({ brain: 'gemini', prompt: 'p' })).errorType, 'BRAIN_BLOCKED'));
  await withGemini([{ status: 200, body: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, candidates: [] } }], async () => assert.equal((await runBrain({ brain: 'gemini', prompt: 'p' })).errorType, 'BRAIN_BLOCKED'));
  await withGemini([{ status: 200, body: okBody('   ') }], async () => assert.equal((await runBrain({ brain: 'gemini', prompt: 'p' })).errorType, 'BRAIN_EMPTY_ANSWER'));
  await withGemini([{ status: 200, body: okBody('ไม่ใช่ json เลย') }], async () => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p' });
    assert.deepEqual([r.errorType, r.costUSD > 0, r.text], ['BRAIN_BAD_JSON', true, 'ไม่ใช่ json เลย']);
  });
  // JSON ห่อ code fence ยังแกะได้
  await withGemini([{ status: 200, body: okBody('```json\n{"ok":true}\n```') }], async () => assert.deepEqual((await runBrain({ brain: 'gemini', prompt: 'p' })).json, { ok: true }));
});

test('gemini: จำกัดพร้อมกันแยกจาก CLI (CLIP_GEMINI_MAX_CONCURRENT) · ตัวที่เกิน = BRAIN_BUSY · ปล่อยแล้วใช้ต่อได้', async () => {
  await withGemini([{ status: 200, body: okBody('{"a":1}'), delayMs: 60 }, { status: 200, body: okBody('{"a":2}') }], async () => {
    const [x, y] = await Promise.all([runBrain({ brain: 'gemini', prompt: 'p' }), runBrain({ brain: 'gemini', prompt: 'p' })]);
    const busy = [x, y].filter((r) => r.errorType === 'BRAIN_BUSY');
    assert.equal(busy.length, 1, JSON.stringify([x.errorType, y.errorType]));
    const z = await runBrain({ brain: 'gemini', prompt: 'p' });
    assert.equal(z.ok, true, 'ช่องว่างแล้วต้องใช้ได้');
  }, { CLIP_GEMINI_MAX_CONCURRENT: '1' });
});

test('gemini: env รุ่น/อุณหภูมิ/เพดานคำตอบ/ราคา มีผลจริง · ไม่ตั้งราคา = ใช้ costRates (ไม่ null)', async () => {
  await withGemini([{ status: 200, body: okBody('{}') }], async (requests) => {
    const r = await runBrain({ brain: 'gemini', prompt: 'p' });
    assert.ok(requests[0].url.includes('gemini-3.7-flash'));
    assert.equal(requests[0].body.generationConfig.temperature, 0.7);
    assert.equal(requests[0].body.generationConfig.maxOutputTokens, 1234);
    assert.equal(r.costUSD, 1000 / 1e6 * 0.3 + 750 / 1e6 * 2.5, 'ไม่ตั้ง env = อัตราเริ่มต้น 0.3/2.5');
  }, { CLIP_GEMINI_MODEL: 'gemini-3.7-flash', CLIP_GEMINI_TEMPERATURE: '0.7', CLIP_GEMINI_MAX_OUTPUT_TOKENS: '1234', CLIP_GEMINI_RATE_IN: '', CLIP_GEMINI_RATE_OUT: '' });
});

test('checkBrain(gemini): พร้อมเมื่อมีกุญแจ ไม่ต้องมี CLI', async () => {
  await withGemini([], async () => assert.deepEqual(await checkBrain('gemini'), { available: true, version: 'api' }));
  await withGemini([], async () => assert.equal((await checkBrain('gemini')).available, false), { GEMINI_API_KEY: '' });
});
