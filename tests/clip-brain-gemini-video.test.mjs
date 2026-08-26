/**
 * 🧪 clip-brain-gemini-video.test.mjs — ข้อสอบ clipBrain/clipGeminiVideo.js (CB-04 + CB-10 · 26 ส.ค. 69)
 * ------------------------------------------------------------------------------------------------
 * ครอบ 2 รอบซ่อม:
 *   CB-04: ด่านเช็ค finishReason ก่อนรับผล (MAX_TOKENS ต้องไม่ผ่านเป็นของสำเร็จแม้ JSON parse ได้)
 *          + ไม่มี finishReason → รับไว้แต่จด degradation + แนบ textLength ในใบรับรองเพื่อวินิจฉัย
 *   CB-10: fail-open ครบวง — fallbackModels แปลกๆ ไม่พัง (object ว่าง/string เดี่ยว), ทุก limit
 *          ถูก clamp (maxAttempts/timeoutMs/totalTimeoutMs), deadline รวมไม่ล้ำ, parsed ต้องเป็น
 *          plain object เท่านั้น (string/array/number truthy ห้ามผ่าน), ห่อ try นอกสุดกันพังหลุด
 *
 * ห้ามยิง network/AI จริง — mock global.fetch ทุกเทส คืนค่าเดิมด้วย after()
 * ฟังก์ชัน helper ภายในไฟล์เป้าหมาย (clampInt/normalizeModelList/isPlainObject) ไม่ได้ export
 * ออกมา จึงพิสูจน์ทุกจุดผ่าน "พฤติกรรมที่สังเกตได้จริง" ของ callClipGeminiVideo (receipt.limits,
 * จำนวน/ชื่อโมเดลที่ fetch ถูกเรียกจริง, ok/errorType/degradations ที่คืนกลับ) ไม่ใช่การค้นคำในซอร์ส
 */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';

const { callClipGeminiVideo, classifyFailure } = await import(
  new URL('../src/lib/services/clipBrain/clipGeminiVideo.js', import.meta.url).href
);

// รายชื่อ env ทั้งหมดที่โมดูลอ่าน — เซฟ/คืนครบทุกตัวทุกเทส กันรั่วข้ามข้อ (และกัน .env.local เครื่องจริงปน)
const ENV_KEYS = [
  'GEMINI_VIDEO_API_KEY', 'GEMINI_API_KEY',
  'CLIP_GEMINI_MAX_ATTEMPTS', 'CLIP_GEMINI_TIMEOUT_MS', 'CLIP_GEMINI_TOTAL_TIMEOUT_MS',
  'CLIP_GEMINI_FALLBACK_MODELS', 'CLIP_SAFE_TEXT',
];

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k]; // เริ่มจากสะอาดทุกครั้ง
  // ค่าเริ่มต้นกลาง: มีคีย์เสมอ (โฟกัสที่ CB-04/CB-10 ไม่ใช่ NO_KEY) + ปิดตัวกรองคำเสี่ยง (ไม่ใช่จุดที่เทสนี้ดู)
  Object.assign(process.env, { CLIP_SAFE_TEXT: '0', GEMINI_VIDEO_API_KEY: 'test-key-123' }, vars);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ABORT_TIMEOUT = AbortSignal.timeout;
after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  AbortSignal.timeout = ORIGINAL_ABORT_TIMEOUT;
});

function setFetch(fn) { globalThis.fetch = fn; }

/**
 * นาฬิกาจำลอง — ใช้เฉพาะเทส deadline/backoff ที่ไม่อยากรอเวลาจริงหลักสิบวินาที
 * เดิน Date.now() ตามที่ setTimeout ถูกขอ (ms) แต่ตัว callback จริงถูกเรียกทันที (0ms จริง)
 * scope ครอบเฉพาะช่วง await ภายใน fn แล้ว restore ใน finally เสมอ — ไม่ leak ข้ามเทส
 */
async function withFakeClock(fn) {
  const realNow = Date.now;
  const realSetTimeout = globalThis.setTimeout;
  let virtualNow = realNow();
  Date.now = () => virtualNow;
  globalThis.setTimeout = (cb, ms, ...args) => {
    if (typeof ms === 'number' && ms > 0) virtualNow += ms;
    return realSetTimeout(cb, 0, ...args);
  };
  try {
    return await fn({ advance: (ms) => { virtualNow += ms; } });
  } finally {
    Date.now = realNow;
    globalThis.setTimeout = realSetTimeout;
  }
}

/** ทรง response ที่โค้ดต้นทางอ่าน (res.ok/res.status/res.json()) เท่านั้น — ไม่ใช่ Response จริง */
function okResponse(bodyObj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => bodyObj };
}
function errResponse(status, message) {
  return { ok: false, status, json: async () => ({ error: { code: status, message } }) };
}
/** ประกอบ candidates[0] ตาม shape จริงของ Gemini — ไม่ระบุ finishReason = ไม่มี key เลย (จำลอง "ไม่มี finishReason" ของจริง) */
function geminiBody({ text, finishReason, usage = { promptTokenCount: 10, candidatesTokenCount: 5 } }) {
  const cand = { content: { parts: [{ text }] } };
  if (finishReason !== undefined) cand.finishReason = finishReason;
  return { candidates: [cand], usageMetadata: usage };
}

/** ดึงชื่อโมเดลจาก URL ที่ fetch mock ได้รับจริง — ใช้พิสูจน์ว่ายิงโมเดลไหนจริง (ไม่ใช่เดา) */
function hitModelFromUrl(url) {
  return decodeURIComponent(String(url)).split('/models/')[1].split(':')[0];
}

const BASE_OPTS = { youtubeUrl: 'https://youtube.com/watch?v=test123', prompt: 'สรุปคลิปนี้' };

// ============================================================
// A. classifyFailure — pure function พื้นฐานที่ด่าน CB-04 พึ่งพา
// ============================================================
test('classifyFailure: finishReason=MAX_TOKENS → kind=TRUNCATED, retry=false', () => {
  const r = classifyFailure({ finishReason: 'MAX_TOKENS' });
  assert.equal(r.kind, 'TRUNCATED');
  assert.equal(r.retry, false);
});

// ============================================================
// B. CB-04 — ด่านเช็ค finishReason ก่อนรับผล
// ============================================================
test('CB-04: finishReason=STOP + JSON parse ได้ → ok:true, ไม่มี degradation, receipt.finishReason=STOP', async () => {
  await withEnv({}, async () => {
    let callCount = 0;
    setFetch(async () => {
      callCount++;
      return okResponse(geminiBody({ text: JSON.stringify({ summary: 'เนื้อหาครบ' }), finishReason: 'STOP' }));
    });
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-a' });
    assert.equal(r.ok, true);
    assert.equal(callCount, 1, 'สำเร็จตั้งแต่ครั้งแรก ไม่ควรยิงซ้ำ');
    assert.deepEqual(r.data, { summary: 'เนื้อหาครบ' });
    assert.equal(r.receipt.finishReason, 'STOP');
    assert.deepEqual(r.receipt.degradations, [], 'STOP ปกติไม่ควรมี degradation ใดๆ');
  });
});

test('CB-04 [probe หลัก]: finishReason=MAX_TOKENS แม้ JSON parse ได้ครบ → ok:false, errorType=TRUNCATED, ไม่ retry', async () => {
  await withEnv({}, async () => {
    let callCount = 0;
    setFetch(async () => {
      callCount++;
      return okResponse(geminiBody({ text: JSON.stringify({ summary: 'เนื้อหาที่ขาดท้าย' }), finishReason: 'MAX_TOKENS' }));
    });
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-b', maxAttempts: 3, fallbackModels: [] });
    assert.equal(r.ok, false, 'ห้ามคืน ok:true ทั้งที่คำตอบถูกตัดกลางคัน (MAX_TOKENS) — นี่คือบั๊กเดิมที่ถูกซ่อม');
    assert.equal(r.errorType, 'TRUNCATED');
    assert.equal(callCount, 1, 'MAX_TOKENS ต้องไม่ retry (classifyFailure บอก retry:false อยู่แล้ว — ต้องใช้เส้นเดียวกัน)');
    assert.equal(r.receipt.attempts.length, 1);
    assert.equal(r.receipt.attempts[0].finishReason, 'MAX_TOKENS');
    assert.equal(r.receipt.attempts[0].errorType, 'TRUNCATED');
    assert.equal(r.data, undefined, 'ไม่ควรมี data ติดมาด้วยเมื่อ ok:false');
  });
});

test('CB-04: ไม่มี finishReason เลย (key หาย) + JSON parse ได้ → ok:true แต่จด degradation no-finish-reason', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: JSON.stringify({ summary: 'โอเค' }) }))); // ไม่ระบุ finishReason
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-c' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { summary: 'โอเค' });
    assert.equal(r.receipt.finishReason, null);
    const deg = r.receipt.degradations.find((d) => d.type === 'no-finish-reason');
    assert.ok(deg, 'ต้องมี degradation type=no-finish-reason เมื่อไม่มี finishReason กลับมา');
  });
});

test('CB-04: textLength ถูกแนบทั้ง receipt.attempts[].textLength และ receipt.textLength (กรณีสำเร็จ)', async () => {
  await withEnv({}, async () => {
    const text = JSON.stringify({ a: 1, b: 'ทดสอบ' });
    setFetch(async () => okResponse(geminiBody({ text, finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-d' });
    assert.equal(r.ok, true);
    assert.equal(r.receipt.attempts[0].textLength, text.length);
    assert.equal(r.receipt.textLength, text.length);
  });
});

test('CB-04: textLength ถูกแนบใน receipt.attempts[].textLength แม้ตอนคำตอบถูกตัด (TRUNCATED)', async () => {
  await withEnv({}, async () => {
    const text = JSON.stringify({ a: 1 });
    setFetch(async () => okResponse(geminiBody({ text, finishReason: 'MAX_TOKENS' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-e', fallbackModels: [] });
    assert.equal(r.ok, false);
    assert.equal(r.receipt.attempts[0].textLength, text.length, 'ต้องวินิจฉัยได้ว่าได้เนื้อมากี่ตัวอักษรแม้ตัดกลางคัน');
  });
});

// ============================================================
// C. CB-10 — normalizeModelList: fallbackModels แปลกๆ ไม่พัง/ไม่ spread รายตัวอักษร
// ============================================================
test('CB-10: fallbackModels={} (plain object ว่าง) ไม่โยน TypeError — ทำงานต่อได้ด้วย model หลักเพียงตัวเดียว', async () => {
  await withEnv({}, async () => {
    const hitModels = [];
    setFetch(async (url) => {
      hitModels.push(hitModelFromUrl(url));
      return okResponse(geminiBody({ text: JSON.stringify({ ok: 1 }), finishReason: 'STOP' }));
    });
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-main-x', fallbackModels: {} });
    assert.equal(r.ok, true, 'fallbackModels={} ต้องไม่ทำให้ throw หลุดออกมา');
    assert.deepEqual(hitModels, ['gemini-main-x']);
  });
});

test('CB-10: fallbackModels เป็น string "model-fb-a,model-fb-b" ต้อง split ด้วย comma ไม่ spread รายตัวอักษร', async () => {
  await withEnv({}, async () => {
    const hitModels = [];
    setFetch(async (url) => {
      const m = hitModelFromUrl(url);
      hitModels.push(m);
      if (m === 'gemini-main-y') return errResponse(400, 'bad request'); // BAD_REQUEST retry:false → ไปตัวถัดไปทันที
      return okResponse(geminiBody({ text: JSON.stringify({ ok: 1 }), finishReason: 'STOP' }));
    });
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-main-y', fallbackModels: 'model-fb-a,model-fb-b' });
    assert.equal(r.ok, true);
    assert.equal(r.receipt.model, 'model-fb-a', 'ต้องยิง fallback ตัวแรกเป็นชื่อเต็ม ไม่ใช่ตัวอักษรเดี่ยว');
    assert.deepEqual(hitModels, ['gemini-main-y', 'model-fb-a'], 'ต้องไม่มีการยิงชื่อโมเดล 1 ตัวอักษร (m,o,d,e,l,...) ปนมา');
    assert.ok(hitModels.every((m) => m.length > 1));
    const deg = r.receipt.degradations.find((d) => d.type === 'model-fallback');
    assert.ok(deg && deg.from === 'gemini-main-y' && deg.to === 'model-fb-a');
  });
});

test('CB-10: fallbackModels string เดี่ยวไม่มี comma "model-solo-fb" ต้องกลายเป็น candidate ชื่อเต็ม 1 ตัว', async () => {
  await withEnv({}, async () => {
    const hitModels = [];
    setFetch(async (url) => {
      const m = hitModelFromUrl(url);
      hitModels.push(m);
      if (m === 'gemini-main-z') return errResponse(400, 'bad request');
      return okResponse(geminiBody({ text: JSON.stringify({ ok: 1 }), finishReason: 'STOP' }));
    });
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-main-z', fallbackModels: 'model-solo-fb' });
    assert.equal(r.ok, true);
    assert.equal(r.receipt.model, 'model-solo-fb');
    assert.ok(hitModels.every((m) => m.length > 1), `ไม่ควรมีชื่อโมเดล 1 ตัวอักษรปนมา ได้ ${JSON.stringify(hitModels)}`);
  });
});

test('CB-10: model หลักว่างเปล่าและไม่มี fallback ที่ใช้ได้ → BAD_INPUT (ไม่เหลือชื่อโมเดล)', async () => {
  await withEnv({}, async () => {
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: '', fallbackModels: [] });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BAD_INPUT');
  });
});

// ============================================================
// D. CB-10 — clampInt: maxAttempts (1-5)
// ============================================================
test('CB-10: maxAttempts=999 ถูก clamp เหลือ 5 — ยิงไม่เกิน 5 ครั้งแม้ error retry ได้ตลอด (BUSY 503)', async () => {
  await withEnv({}, async () => {
    await withFakeClock(async () => {
      let callCount = 0;
      setFetch(async () => { callCount++; return errResponse(503, 'overload'); });
      const r = await callClipGeminiVideo({
        ...BASE_OPTS, model: 'gemini-test-acap', maxAttempts: 999, fallbackModels: [],
        totalTimeoutMs: 3600000, // เพดานบนสุด กัน deadline มาตัดจบก่อนถึง attemptsCap
      });
      assert.equal(r.ok, false);
      assert.equal(r.receipt.limits.maxAttempts, 5);
      assert.equal(callCount, 5, 'ต้องยิงไม่เกิน 5 ครั้ง (999 ต้องถูกกดเพดาน ไม่ใช่เกือบไม่จำกัด = ลูปไม่จบ)');
    });
  });
});

test('CB-10: maxAttempts=0 (และค่าติดลบ) ถูก clamp เป็น 1 (ต้องยิงอย่างน้อย 1 ครั้ง ไม่ใช่ 0 ครั้ง)', async () => {
  await withEnv({}, async () => {
    let callCount = 0;
    setFetch(async () => { callCount++; return errResponse(400, 'x'); });
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-azero', maxAttempts: 0, fallbackModels: [] });
    assert.equal(r.receipt.limits.maxAttempts, 1);
    assert.equal(callCount, 1);
  });
});

test('CB-10: maxAttempts=Infinity ไม่ทำให้ลูปไม่จบ — clampInt คืนค่า default (3) เพราะ Infinity ไม่ finite', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: JSON.stringify({ x: 1 }), finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-ainf', maxAttempts: Infinity });
    assert.equal(r.receipt.limits.maxAttempts, 3);
  });
});

// ============================================================
// E. CB-10 — clampInt: timeoutMs ต่อครั้ง (5s-600s)
// ============================================================
test('CB-10: timeoutMs ต่ำกว่าเพดานล่าง (1ms) ถูก clamp เป็น 5000ms', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: JSON.stringify({ x: 1 }), finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-tmin', timeoutMs: 1 });
    assert.equal(r.receipt.limits.timeoutMs, 5000);
  });
});

test('CB-10: timeoutMs เกินเพดานบน (999999999ms) ถูก clamp เป็น 600000ms', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: JSON.stringify({ x: 1 }), finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-tmax', timeoutMs: 999999999 });
    assert.equal(r.receipt.limits.timeoutMs, 600000);
  });
});

// ============================================================
// F. CB-10 — clampInt: totalTimeoutMs (เพดานรวมทั้ง call) + deadline logic
// ============================================================
test('CB-10: totalTimeoutMs ต่ำกว่าเพดานล่าง (1ms) ถูก clamp เป็น 10000ms (floor)', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: JSON.stringify({ x: 1 }), finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-ttmin', totalTimeoutMs: 1 });
    assert.equal(r.receipt.limits.totalTimeoutMs, 10000);
  });
});

test('CB-10: totalTimeoutMs เกินเพดานบน (99999999999ms) ถูก clamp เป็น 3600000ms (ceiling)', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: JSON.stringify({ x: 1 }), finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-ttmax', totalTimeoutMs: 99999999999 });
    assert.equal(r.receipt.limits.totalTimeoutMs, 3600000);
  });
});

test('CB-10: deadline รวมหมดกลาง loop → หยุดทุกโมเดลทันที จด degradation total-deadline, errorType=TIMEOUT', async () => {
  await withEnv({}, async () => {
    await withFakeClock(async (clock) => {
      let callCount = 0;
      setFetch(async () => {
        callCount++;
        clock.advance(9500); // จำลองแต่ละ attempt กินเวลาไปเกือบหมด deadline (floor=10000ms)
        return errResponse(503, 'overload');
      });
      const r = await callClipGeminiVideo({
        ...BASE_OPTS, model: 'gemini-test-deadline',
        totalTimeoutMs: 1, // ถูก clamp เป็น floor 10000
        maxAttempts: 5, fallbackModels: [],
      });
      assert.equal(r.ok, false);
      assert.equal(r.receipt.limits.totalTimeoutMs, 10000);
      assert.equal(callCount, 1, 'ต้องหยุดหลัง attempt แรกเพราะเวลาที่เหลือ <=1000ms ไม่ยิงต่อ');
      assert.equal(r.errorType, 'TIMEOUT');
      const deg = r.receipt.degradations.find((d) => d.type === 'total-deadline');
      assert.ok(deg, 'ต้องมี degradation type=total-deadline');
    });
  });
});

test('CB-10: per-attempt timeout = min(timeoutMs, เวลาที่เหลือ) — attempt ถัดไปได้ timeout สั้นลงเมื่อ deadline ใกล้หมด', async () => {
  await withEnv({}, async () => {
    const capturedTimeouts = [];
    const realAbortTimeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms) => { capturedTimeouts.push(ms); return realAbortTimeout.call(AbortSignal, ms); };
    try {
      await withFakeClock(async (clock) => {
        let callCount = 0;
        setFetch(async () => {
          callCount++;
          if (callCount === 1) clock.advance(6000); // กิน 6s จาก deadline 10s แรก
          return errResponse(503, 'overload');
        });
        await callClipGeminiVideo({
          ...BASE_OPTS, model: 'gemini-test-mintimeout',
          timeoutMs: 600000,      // เพดานบนสุด — ต้องถูกจำกัดด้วยเวลาที่เหลือแทน ไม่ใช่ค่านี้เต็มๆ
          totalTimeoutMs: 1,      // clamp -> floor 10000
          maxAttempts: 5, fallbackModels: [],
        });
      });
    } finally {
      AbortSignal.timeout = realAbortTimeout;
    }
    assert.equal(capturedTimeouts.length, 2, `ต้องมี 2 attempt ก่อน deadline หมด ได้ ${JSON.stringify(capturedTimeouts)}`);
    assert.equal(capturedTimeouts[0], 10000, 'attempt แรก: min(600000, เวลาที่เหลือ=10000) = 10000');
    assert.equal(capturedTimeouts[1], 2000, 'attempt สอง: min(600000, เวลาที่เหลือ≈2000) = 2000 (ไม่ใช่ 600000 เต็ม)');
  });
});

// ============================================================
// G. CB-10 — isPlainObject: string/array/number truthy ห้ามผ่านเป็น ok:true
// ============================================================
test('CB-10: Gemini ตอบ JSON ที่ parse ได้เป็น array ("[1,2,3]") → ไม่ผ่านเป็น ok:true', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: '[1,2,3]', finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-arr', maxAttempts: 1, fallbackModels: [] });
    assert.equal(r.ok, false, 'array ที่ parse ได้สำเร็จต้องไม่นับเป็นของสำเร็จ');
  });
});

test('CB-10: Gemini ตอบ JSON ที่ parse ได้เป็น string (\'"hello"\') → ไม่ผ่านเป็น ok:true', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: '"hello"', finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-str', maxAttempts: 1, fallbackModels: [] });
    assert.equal(r.ok, false);
  });
});

test('CB-10: Gemini ตอบ JSON ที่ parse ได้เป็น number ("42") → ไม่ผ่านเป็น ok:true', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: '42', finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({ ...BASE_OPTS, model: 'gemini-test-num', maxAttempts: 1, fallbackModels: [] });
    assert.equal(r.ok, false);
  });
});

// ============================================================
// H. CB-10 — ห่อทั้งฟังก์ชันด้วย try นอกสุด: เรียกด้วย null/getter พังก็ไม่โยน
// ============================================================
test('CB-10: ตัวเลือกที่ getter throw ตอน destructure → ไม่โยน exception หลุด คืน CLIP_GEMINI_INTERNAL', async () => {
  await withEnv({}, async () => {
    const evilOpts = {};
    Object.defineProperty(evilOpts, 'prompt', {
      get() { throw new Error('boom-getter-throws'); },
      enumerable: true,
    });
    const r = await callClipGeminiVideo(evilOpts);
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'CLIP_GEMINI_INTERNAL');
    assert.ok(r.error.includes('boom-getter-throws'));
    assert.ok(r.receipt, 'ต้องยังมี receipt กลับมาแม้พังตั้งแต่ destructure');
  });
});

test('CB-10: เรียกด้วย null ตรงๆ ไม่โยน exception (destructure fallback เป็น {})', async () => {
  await withEnv({}, async () => {
    const r = await callClipGeminiVideo(null);
    assert.equal(typeof r, 'object');
    assert.equal(r.ok, false);
    assert.notEqual(r.errorType, 'CLIP_GEMINI_INTERNAL', 'null ควร handle ได้ปกติ ไม่ควรพังลึกถึงชั้น catch นอกสุด');
  });
});

// ============================================================
// I. receipt.limits — ฟิลด์วินิจฉัยใหม่
// ============================================================
test('receipt.limits มีครบ {maxAttempts,timeoutMs,totalTimeoutMs} ตรงกับค่าที่ clamp แล้ว', async () => {
  await withEnv({}, async () => {
    setFetch(async () => okResponse(geminiBody({ text: JSON.stringify({ x: 1 }), finishReason: 'STOP' })));
    const r = await callClipGeminiVideo({
      ...BASE_OPTS, model: 'gemini-test-limits',
      maxAttempts: 2, timeoutMs: 8000, totalTimeoutMs: 20000,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.receipt.limits, { maxAttempts: 2, timeoutMs: 8000, totalTimeoutMs: 20000 });
  });
});
