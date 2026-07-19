// ============================================================
// 🧪 MEGA_CLUTTER_GUARD — มือ A: gemini.js triage schema (busy + peopleCount)
// ------------------------------------------------------------
// สเปกกลาง: scratchpad/CLUTTER_GUARD_SPEC.md — kill-switch เดียว
//   process.env.MEGA_CLUTTER_GUARD !== '0' (default ON — 20 ก.ค. ผู้ใช้เลือกเปิด; '0'=ปิด=byte-parity)
//
// พิสูจน์:
//   (a) OFF (unset/'0'/อะไรก็ตามที่ไม่ใช่ '1') → prompt ที่ยิงจริงไปหา Gemini ไม่มีคำว่า "busy"/"peopleCount"
//       เลย + item ที่ parse กลับมาไม่มี field busy/peopleCount (byte-parity กับพฤติกรรมเดิม)
//   (b) ON ('1') → prompt มี busy 0-2 + peopleCount ในทั้ง JSON template และคำอธิบาย + item ที่ผ่าน schema
//       มี .busy/.peopleCount ตามที่ Gemini ตอบมาจริง
//   (c) validation ของ field busy: ยอมรับเฉพาะ integer 0-2 เท่านั้น (ปฏิเสธ -1/3/1.5/"2"/null ทั้งหมด — ไม่ clamp
//       สอดคล้องปรัชญาไฟล์นี้ที่ reject ทั้งก้อนเสมอ ไม่มี default-positive/coerce ที่ไหนเลย)
//   (d) validation ของ peopleCount: nullable integer 0-64 (เลียนแบบ faceBox/peopleBox ที่ nullable) — ปฏิเสธ
//       ค่านอกช่วง/ไม่ใช่ integer แต่ยอมรับ null
//   (e) sanitizeStrictClassifierItem (exported, ใช้ซ้ำใน libraryTriage.js) เรียกแบบ 2 args เดิม (ไม่ส่ง busyOn)
//       ต้องได้พฤติกรรมเดิมเป๊ะแม้ item มี field แถมมาก็ตาม (extra key = reject เหมือนเดิม, ไม่ใช่ auto-accept)
//
// วิธีทดสอบ prompt จริง: gemini.js ไม่มี "buildPrompt" แยกออกมา — promptText ถูกประกอบอยู่ใน geminiClassifyFrames
// เท่านั้น ดังนั้นเทสนี้ stub globalThis.fetch (จับ request body ที่จะยิงจริง) + stub ./costStore.js (กันเขียนไฟล์
// data/cost-log.json จริงตอนเทส) แล้วเรียก geminiClassifyFrames ตัวจริงทั้งฟังก์ชัน ไม่มี network จริงเกิดขึ้น
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const GEMINI_URL = new URL('../src/lib/gemini.js', import.meta.url).href;
const STUB_COST = 'data:text/javascript,' + encodeURIComponent(`
export async function recordLLM() { return null; }
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './costStore.js' && context.parentURL === ${JSON.stringify(GEMINI_URL)}) {
    return { url: ${JSON.stringify(STUB_COST)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const {
  geminiClassifyFrames,
  resolveGeminiClassifierPin,
  sanitizeStrictClassifierItem,
} = await import('../src/lib/gemini.js');

// ── env helper (คืนค่าเดิมเสมอ กันเทสอื่นเพี้ยน) ──
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

const ORIGINAL_FETCH = globalThis.fetch;
after(() => {
  if (ORIGINAL_FETCH) globalThis.fetch = ORIGINAL_FETCH;
  else delete globalThis.fetch;
});

// สร้าง fetch stub: จับ prompt text (parts[0].text) ไว้ใน capture.prompt แล้วตอบกลับ items ที่กำหนด
// modelVersion = pin.model เป๊ะ (ผ่าน classifyIdentity 'exact' — ไม่งั้น MODEL_PIN_MISMATCH)
function makeFetchStub(capture, items) {
  return async (url, opts) => {
    capture.url = url;
    const body = JSON.parse(opts.body);
    capture.prompt = body.contents[0].parts[0].text;
    const pinModel = new URL(url).pathname.split('/models/')[1].split(':')[0];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        modelVersion: pinModel,
        candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    };
  };
}

const FRAMES = [{ index: 0, base64: 'AAAA' }];
const SUBJECTS = [{ name: 'ทดสอบ' }];

// item รูปแบบ BASE (fileTagOn=false เพราะเทสนี้ set FILE_SHOT_TAG='0' กัน newsScene มากวนใจ)
function baseItemFields() {
  return {
    index: 0, category: 'context', quality: 7, relevant: true,
    person: null, persons: [], emotion: 'none', clean: true,
    faceCount: 0, faceBox: null, peopleBox: null, note: '',
  };
}

test('default (unset) = ON: prompt มี busy/peopleCount + item ผ่าน schema (unset → เปิด, !== "0" semantics)', async () => {
  await withEnv({ MEGA_CLUTTER_GUARD: undefined, FILE_SHOT_TAG: '0', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: undefined }, async () => {
    const capture = {};
    globalThis.fetch = makeFetchStub(capture, [{ ...baseItemFields(), busy: 1, peopleCount: 4 }]);
    const pin = resolveGeminiClassifierPin();
    const result = await geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: null, caseId: 'TEST', pin });
    assert.ok(/busy/i.test(capture.prompt), 'default ON (unset): prompt ต้องมีคำว่า busy');
    assert.ok(/peopleCount/i.test(capture.prompt), 'default ON (unset): prompt ต้องมี peopleCount');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].busy, 1, 'default ON (unset): item.busy ต้องมี');
  });
});

test("OFF ('0' ชัดเจน): พฤติกรรมเดิมเป๊ะ (byte-parity — kill-switch '0'=ปิด, ไม่มี busy)", async () => {
  await withEnv({ MEGA_CLUTTER_GUARD: '0', FILE_SHOT_TAG: '0', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: undefined }, async () => {
    const capture = {};
    globalThis.fetch = makeFetchStub(capture, [baseItemFields()]);
    const pin = resolveGeminiClassifierPin();
    const result = await geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: null, caseId: 'TEST', pin });
    assert.ok(!/busy/i.test(capture.prompt), "MEGA_CLUTTER_GUARD='0' ต้องยังปิดอยู่ (ไม่ใช่ !== '0' semantics)");
    assert.ok(!Object.prototype.hasOwnProperty.call(result.items[0], 'busy'));
  });
});

test("ON ('1'): prompt มี busy 0-2 + peopleCount ทั้ง JSON template และคำอธิบาย + item ที่ตอบกลับผ่าน schema จริง", async () => {
  await withEnv({ MEGA_CLUTTER_GUARD: '1', FILE_SHOT_TAG: '0', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: undefined }, async () => {
    const capture = {};
    const items = [{ ...baseItemFields(), busy: 2, peopleCount: 12 }];
    globalThis.fetch = makeFetchStub(capture, items);
    const pin = resolveGeminiClassifierPin();
    const result = await geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: null, caseId: 'TEST', pin });
    assert.match(capture.prompt, /"busy":\s*<0-2>/, 'JSON template ต้องขอ busy 0-2');
    assert.match(capture.prompt, /"peopleCount":/, 'JSON template ต้องขอ peopleCount');
    assert.match(capture.prompt, /ลายตา/, 'คำอธิบาย busy ต้องพูดถึง "ลายตา"');
    assert.equal(result.items[0].busy, 2, 'item.busy ต้องตรงกับที่ Gemini ตอบมา');
    assert.equal(result.items[0].peopleCount, 12, 'item.peopleCount ต้องตรงกับที่ Gemini ตอบมา');
  });
});

test('ON: Gemini ตอบ busy นอกช่วง (3) → ทั้งแบตช์ถูกปฏิเสธ (SCHEMA_VALIDATION_FAILED, ไม่ clamp ไม่ default)', async () => {
  await withEnv({ MEGA_CLUTTER_GUARD: '1', FILE_SHOT_TAG: '0', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: undefined }, async () => {
    const capture = {};
    const items = [{ ...baseItemFields(), busy: 3, peopleCount: null }];
    globalThis.fetch = makeFetchStub(capture, items);
    const pin = resolveGeminiClassifierPin();
    await assert.rejects(
      geminiClassifyFrames({ frames: FRAMES, subjects: SUBJECTS, newsGist: null, caseId: 'TEST', pin }),
      (err) => err.errorType === 'SCHEMA_VALIDATION_FAILED',
      'busy=3 (นอกช่วง 0-2) ต้องทำให้ทั้งแบตช์ตกที่ schema validation',
    );
  });
});

// ── validation หน่วยล่าง: sanitizeStrictClassifierItem(it, fileTagOn, busyOn) ──
test('sanitizeStrictClassifierItem: ON (busyOn=true) ยอมรับ busy=0,1,2 + peopleCount null/integer', () => {
  for (const busy of [0, 1, 2]) {
    const it = { ...baseItemFields(), busy, peopleCount: null };
    const out = sanitizeStrictClassifierItem(it, false, true);
    assert.ok(out !== null, `busy=${busy} ต้องผ่าน`);
    assert.equal(out.busy, busy);
    assert.equal(out.peopleCount, null);
  }
  const it2 = { ...baseItemFields(), busy: 2, peopleCount: 40 };
  const out2 = sanitizeStrictClassifierItem(it2, false, true);
  assert.ok(out2 !== null);
  assert.equal(out2.peopleCount, 40);
});

test('sanitizeStrictClassifierItem: ON ปฏิเสธ busy นอกช่วง/ผิดชนิด (-1, 3, 1.5, "2", null) — ไม่ clamp', () => {
  for (const busy of [-1, 3, 1.5, '2', null, undefined, true]) {
    const it = { ...baseItemFields(), busy, peopleCount: null };
    const out = sanitizeStrictClassifierItem(it, false, true);
    assert.equal(out, null, `busy=${JSON.stringify(busy)} ต้องถูกปฏิเสธ (ไม่ใช่ clamp เป็น 0/2)`);
  }
});

test('sanitizeStrictClassifierItem: ON ปฏิเสธ peopleCount นอกช่วง/ผิดชนิด (ไม่ nullable-invalid)', () => {
  for (const peopleCount of [-1, 65, 2.5, '5']) {
    const it = { ...baseItemFields(), busy: 1, peopleCount };
    const out = sanitizeStrictClassifierItem(it, false, true);
    assert.equal(out, null, `peopleCount=${JSON.stringify(peopleCount)} ต้องถูกปฏิเสธ`);
  }
});

test('sanitizeStrictClassifierItem: เรียกแบบ 2 args เดิม (ไม่ส่ง busyOn) = พฤติกรรมเดิมเป๊ะ — item ธรรมดาผ่าน, item มี busy แถมมา (ไม่ได้ขอ) ต้องถูกปฏิเสธเป็น extra key เหมือนเดิม', () => {
  const plain = baseItemFields();
  const outPlain = sanitizeStrictClassifierItem(plain, false);
  assert.ok(outPlain !== null, 'item ปกติ (ไม่มี busy) ต้องผ่านเหมือนเดิมทุกประการ');
  assert.ok(!Object.prototype.hasOwnProperty.call(outPlain, 'busy'));

  const withExtraBusy = { ...baseItemFields(), busy: 1, peopleCount: 3 };
  const outExtra = sanitizeStrictClassifierItem(withExtraBusy, false); // busyOn ไม่ถูกส่ง = false (เดิม)
  assert.equal(outExtra, null, 'caller เดิมที่ไม่รู้จัก busyOn ต้องยัง reject item ที่มี key แถม (guardExactObject exact-match เดิม)');
});

test('sanitizeStrictClassifierItem: fileTagOn=true (SCENE) + busyOn=true ทำงานร่วมกันได้ (2 flag อิสระกัน)', () => {
  const it = { ...baseItemFields(), newsScene: true, busy: 0, peopleCount: 1 };
  const out = sanitizeStrictClassifierItem(it, true, true);
  assert.ok(out !== null);
  assert.equal(out.newsScene, true);
  assert.equal(out.busy, 0);
});
