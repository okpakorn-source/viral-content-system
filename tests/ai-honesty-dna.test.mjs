// ============================================================
// 🧬 AI Honesty DNA (การ์ดที่ 5 — เคส AC-0195 28 ก.ค. 69, เจ้าของสั่งตรง)
// ------------------------------------------------------------
// ฉีด "DNA ความซื่อสัตย์" หน้า system/prompt ของทุกโมเดล AI ในท่อปก (ไม่แตะระบบเขียนข่าว/openai.js/aiRouter/
// modelConfig/โต๊ะข่าว) — จุดกลาง: src/lib/aiClient.js::callBrain (ครอบ megaBrains 5 ตัว + gap-search) +
// helper กลาง src/lib/aiHonestyDna.js::withHonestyDna() (ใช้ที่ตาต่างๆ ที่ยิง prompt ตรงๆ ไม่ผ่าน callBrain):
//   gemini.js (7 ฟังก์ชันตาคัด/ตาต่างๆ) · geminiFrameCurator.js · faceDetector.js (2 จุด) · refCoverBrain.js
//   (2 จุด) · coverBenchmarkBrain.js::brainPromptBlock (ครอบ coverDirectorService.js 4 จุดในตัวเดียว) ·
//   megaAdapters.js::_runSecondEye (เทสอยู่ใน mega-second-eye.test.mjs แยกต่างหาก ไม่ซ้ำที่นี่)
// flag: AI_HONESTY_DNA — default ON, '0' = ไม่ฉีด (byte-parity เดิมทุกจุด)
// ไม่ยิง LLM/network จริงที่ไหนเลย — stub fetch/callAI/callGeminiVision/sharp ทุกจุด
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test as nodeTest, after } from 'node:test';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;

const { AI_HONESTY_DNA, honestyDnaOn, withHonestyDna } = await import('../src/lib/aiHonestyDna.js');

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };

// ═══════════════════ (0) aiHonestyDna.js — เนื้อหา + helper ล้วน ═══════════════════

await test('AI_HONESTY_DNA: เป็นสตริง ~500 ตัวอักษร (300-700) ครบ 5 กฎ (1)-(5)', () => {
  assert.equal(typeof AI_HONESTY_DNA, 'string');
  assert.ok(AI_HONESTY_DNA.length >= 300 && AI_HONESTY_DNA.length <= 700, `ความยาว ${AI_HONESTY_DNA.length} ควรอยู่ราว 300-700`);
  for (const n of ['(1)', '(2)', '(3)', '(4)', '(5)']) {
    assert.ok(AI_HONESTY_DNA.includes(n), `ต้องมีข้อ ${n}`);
  }
  assert.ok(/ซื่อสัตย์/.test(AI_HONESTY_DNA));
  assert.ok(/ห้ามแต่งข้อมูล|ห้ามเดา/.test(AI_HONESTY_DNA), 'ต้องพูดถึงห้ามแต่ง/ห้ามเดา');
});

await test('honestyDnaOn(): default (unset) = true, "0" = false, ค่าอื่นๆ = true', async () => {
  await withEnv({ AI_HONESTY_DNA: undefined }, async () => assert.equal(honestyDnaOn(), true));
  await withEnv({ AI_HONESTY_DNA: '0' }, async () => assert.equal(honestyDnaOn(), false));
  await withEnv({ AI_HONESTY_DNA: '1' }, async () => assert.equal(honestyDnaOn(), true));
});

await test('withHonestyDna(text): ON → prepend DNA + "\\n\\n" เป๊ะ · OFF → คืน text เดิมทุก byte', async () => {
  const sample = 'ทดสอบ prompt ตัวอย่าง';
  await withEnv({ AI_HONESTY_DNA: undefined }, async () => {
    assert.equal(withHonestyDna(sample), `${AI_HONESTY_DNA}\n\n${sample}`);
  });
  await withEnv({ AI_HONESTY_DNA: '0' }, async () => {
    assert.equal(withHonestyDna(sample), sample, 'OFF ต้อง byte-identical กับ input เดิม');
  });
});

// ═══════════════════ (1) aiClient.js::callBrain — จุดกลาง (Anthropic + OpenAI) ═══════════════════

{
  const ORIGINAL_FETCH = globalThis.fetch;
  after(() => { if (ORIGINAL_FETCH) globalThis.fetch = ORIGINAL_FETCH; else delete globalThis.fetch; });

  const { callBrain } = await import('../src/lib/aiClient.js');

  await test('callBrain (Anthropic): ON → payload.system ขึ้นต้นด้วย AI_HONESTY_DNA เต็มก้อน + \\n\\n + system เดิม', async () => {
    await withEnv({ AI_HONESTY_DNA: undefined, ANTHROPIC_API_KEY: 'test-key' }, async () => {
      let capturedBody = null;
      globalThis.fetch = async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-x', usage: {} }) };
      };
      await callBrain({ system: 'ระบบทดสอบ', user: 'สวัสดี', forceProvider: 'anthropic', forceModel: 'claude-test-model' });
      assert.ok(capturedBody, 'fetch ต้องถูกเรียก');
      assert.equal(capturedBody.system.indexOf(AI_HONESTY_DNA), 0, 'DNA ต้องอยู่ตำแหน่ง index 0 ของ system ที่ยิงจริง');
      assert.equal(capturedBody.system, `${AI_HONESTY_DNA}\n\nระบบทดสอบ`);
    });
  });

  await test('callBrain (Anthropic): AI_HONESTY_DNA=0 → payload.system เท่ากับ system เดิมเป๊ะ (byte-parity, ไม่ฉีด)', async () => {
    await withEnv({ AI_HONESTY_DNA: '0', ANTHROPIC_API_KEY: 'test-key' }, async () => {
      let capturedBody = null;
      globalThis.fetch = async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-x', usage: {} }) };
      };
      await callBrain({ system: 'ระบบทดสอบ', user: 'สวัสดี', forceProvider: 'anthropic', forceModel: 'claude-test-model' });
      assert.equal(capturedBody.system, 'ระบบทดสอบ', 'kill-switch ต้องคืน system เดิมทุก byte');
    });
  });

  await test('callBrain (OpenAI): ON → messages[0] (role:system).content ขึ้นต้นด้วย AI_HONESTY_DNA', async () => {
    await withEnv({ AI_HONESTY_DNA: undefined, OPENAI_API_KEY: 'test-key' }, async () => {
      let capturedBody = null;
      globalThis.fetch = async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }], model: 'gpt-x', usage: {} }) };
      };
      await callBrain({ system: 'ระบบทดสอบ openai', user: 'สวัสดี', forceProvider: 'openai', forceModel: 'gpt-test-model' });
      assert.ok(capturedBody, 'fetch ต้องถูกเรียก');
      assert.equal(capturedBody.messages[0].role, 'system');
      assert.equal(capturedBody.messages[0].content.indexOf(AI_HONESTY_DNA), 0, 'DNA ต้องอยู่ index 0 ของ system message');
    });
  });

  await test('callBrain: system ว่าง/undefined → ไม่ฉีด DNA (กันเคส system เปล่าโดยไม่ตั้งใจ)', async () => {
    await withEnv({ AI_HONESTY_DNA: undefined, ANTHROPIC_API_KEY: 'test-key' }, async () => {
      let capturedBody = null;
      globalThis.fetch = async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-x', usage: {} }) };
      };
      await callBrain({ system: '', user: 'สวัสดี', forceProvider: 'anthropic', forceModel: 'claude-test-model' });
      assert.equal(capturedBody.system, '', 'system ว่างต้องยังว่างอยู่ ไม่ฉีดอะไรเข้าไป (ไม่มี system จริงให้ห่อ)');
    });
  });
}

// ═══════════════════ (2) coverBenchmarkBrain.js::brainPromptBlock — pure function ═══════════════════

{
  const hookAt = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
  register('data:text/javascript,' + encodeURIComponent(hookAt));
}

await test('brainPromptBlock: ON → indexOf(AI_HONESTY_DNA)===0 ทั้ง 3 stage (judge/director/qc) · OFF → เนื้อหาเดิมเป๊ะ ไม่มี DNA', async () => {
  const { brainPromptBlock } = await import('../src/lib/services/coverBenchmarkBrain.js');
  await withEnv({ AI_HONESTY_DNA: undefined }, async () => {
    for (const stage of ['judge', 'director', 'qc']) {
      const block = brainPromptBlock(stage);
      assert.equal(block.indexOf(AI_HONESTY_DNA), 0, `stage=${stage} ต้องขึ้นต้นด้วย DNA`);
      assert.ok(block.includes('ปกต้นแบบ 3 ใบ'), `stage=${stage} เนื้อหาเดิมต้องยังอยู่`);
    }
  });
  await withEnv({ AI_HONESTY_DNA: '0' }, async () => {
    const block = brainPromptBlock('qc');
    assert.ok(!block.includes(AI_HONESTY_DNA), 'OFF ต้องไม่มี DNA เลย');
    assert.ok(block.startsWith('📀 ปกต้นแบบ 3 ใบ'), 'OFF ต้องขึ้นต้นด้วยเนื้อหาเดิมเป๊ะ (byte-parity)');
  });
});

// ═══════════════════ (3) gemini.js::geminiClassifyFrames — fetch-stub (รูปแบบเดียวกับ gemini-busy-field.test.mjs) ═══════════════════

{
  const GEMINI_URL = new URL('../src/lib/gemini.js', import.meta.url).href;
  const STUB_COST = MOD(`export async function recordLLM() { return null; }`);
  const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './costStore.js' && context.parentURL === ${JSON.stringify(GEMINI_URL)}) {
    return { url: ${JSON.stringify(STUB_COST)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
  register('data:text/javascript,' + encodeURIComponent(hook));
  const { geminiClassifyFrames, resolveGeminiClassifierPin } = await import('../src/lib/gemini.js');

  const ORIGINAL_FETCH2 = globalThis.fetch;
  after(() => { if (ORIGINAL_FETCH2) globalThis.fetch = ORIGINAL_FETCH2; else delete globalThis.fetch; });

  const makeFetchStub = (capture, items) => async (url, opts) => {
    const body = JSON.parse(opts.body);
    capture.prompt = body.contents[0].parts[0].text;
    const pinModel = new URL(url).pathname.split('/models/')[1].split(':')[0];
    return { ok: true, status: 200, json: async () => ({ modelVersion: pinModel, candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }], usageMetadata: {} }) };
  };

  const oneItem = () => [{
    index: 0, category: 'context', quality: 7, relevant: true,
    person: null, persons: [], emotion: 'none', clean: true,
    faceCount: 0, faceBox: null, peopleBox: null, note: '',
  }];

  await test('gemini.js::geminiClassifyFrames (triage — "ตาคัด"): ON → prompt ที่ยิงจริงขึ้นต้นด้วย AI_HONESTY_DNA', async () => {
    await withEnv({ AI_HONESTY_DNA: undefined, GEMINI_API_KEY: 'test-key', GEMINI_MODEL: undefined, MEGA_CLUTTER_GUARD: '0', FILE_SHOT_TAG: '0' }, async () => {
      const capture = {};
      globalThis.fetch = makeFetchStub(capture, oneItem());
      const pin = resolveGeminiClassifierPin();
      await geminiClassifyFrames({ frames: [{ index: 0, base64: 'AAAA' }], subjects: [{ name: 'ทดสอบ' }], newsGist: null, caseId: 'TEST', pin });
      assert.equal(capture.prompt.indexOf(AI_HONESTY_DNA), 0, 'prompt จริงต้องขึ้นต้นด้วย DNA');
    });
  });

  await test('gemini.js::geminiClassifyFrames: AI_HONESTY_DNA=0 → prompt ไม่มี DNA เลย (byte-parity)', async () => {
    await withEnv({ AI_HONESTY_DNA: '0', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: undefined, MEGA_CLUTTER_GUARD: '0', FILE_SHOT_TAG: '0' }, async () => {
      const capture = {};
      globalThis.fetch = makeFetchStub(capture, oneItem());
      const pin = resolveGeminiClassifierPin();
      await geminiClassifyFrames({ frames: [{ index: 0, base64: 'AAAA' }], subjects: [{ name: 'ทดสอบ' }], newsGist: null, caseId: 'TEST', pin });
      assert.ok(!capture.prompt.includes(AI_HONESTY_DNA), 'OFF ต้องไม่มี DNA');
      assert.ok(capture.prompt.startsWith('จำแนกภาพแต่ละรูป'), 'OFF ต้องขึ้นต้นด้วยเนื้อหาเดิมเป๊ะ');
    });
  });
}

// ═══════════════════ (4) geminiFrameCurator.js::curateFrames — module-hook stub callGeminiVision ═══════════════════

{
  let capturedPrompt = null;
  const STUB_GEMINI_CLIENT = MOD(`
export async function callGeminiVision({ prompt }) {
  globalThis.__CURATOR_CAPTURED_PROMPT = prompt;
  return { hero: 0, context: [], reject: [], reason: 'x' };
}`);
  const hook2 = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/geminiClient') return { url: ${JSON.stringify(STUB_GEMINI_CLIENT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
  register('data:text/javascript,' + encodeURIComponent(hook2));
  const { curateFrames } = await import('../src/lib/services/geminiFrameCurator.js');
  const FRAME = 'data:image/jpeg;base64,QUJD';

  await test('geminiFrameCurator.js::curateFrames: ON → prompt ที่ส่งไป callGeminiVision ขึ้นต้นด้วย AI_HONESTY_DNA', async () => {
    await withEnv({ AI_HONESTY_DNA: undefined }, async () => {
      globalThis.__CURATOR_CAPTURED_PROMPT = null;
      await curateFrames([FRAME, FRAME], 'ข่าวทดสอบ');
      assert.equal(globalThis.__CURATOR_CAPTURED_PROMPT.indexOf(AI_HONESTY_DNA), 0);
    });
  });

  await test('geminiFrameCurator.js::curateFrames: AI_HONESTY_DNA=0 → prompt ไม่มี DNA (byte-parity)', async () => {
    await withEnv({ AI_HONESTY_DNA: '0' }, async () => {
      globalThis.__CURATOR_CAPTURED_PROMPT = null;
      await curateFrames([FRAME, FRAME], 'ข่าวทดสอบ');
      assert.ok(!globalThis.__CURATOR_CAPTURED_PROMPT.includes(AI_HONESTY_DNA));
      assert.ok(globalThis.__CURATOR_CAPTURED_PROMPT.startsWith('คุณเป็นบรรณาธิการภาพข่าวมือโปร'));
    });
  });
}

// ═══════════════════ (5) faceDetector.js::detectFaces — module-hook stub sharp + callAI, FACE_CACHE=0 ═══════════════════

{
  const SHARP_STUB = MOD(`
export default function sharp(input){
  const meta = { width: 400, height: 400 };
  const chain = {
    metadata: async () => meta,
    resize(){ return chain; }, jpeg(){ return chain; },
    toBuffer: async () => Buffer.alloc(64, 1),
  };
  return chain;
}`);
  let capturedGptPrompt = null;
  const STUB_OPENAI = MOD(`
export async function callAI({ prompt }) {
  globalThis.__FD_CAPTURED_PROMPT = prompt;
  return { faces: [], has_faces: false, face_count: 0 };
}`);
  const FD_SRC = new URL('../src/', import.meta.url).href;
  const hook3 = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(STUB_OPENAI)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(FD_SRC)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
  register('data:text/javascript,' + encodeURIComponent(hook3));
  const { detectFaces } = await import('../src/lib/services/faceDetector.js');

  await test('faceDetector.js::detectFaces (GPT tier): ON → prompt ที่ส่งไป callAI ขึ้นต้นด้วย AI_HONESTY_DNA', async () => {
    await withEnv({ AI_HONESTY_DNA: undefined, FACE_CACHE: '0' }, async () => {
      globalThis.__FD_CAPTURED_PROMPT = null;
      await detectFaces(Buffer.alloc(64, 1));
      assert.ok(globalThis.__FD_CAPTURED_PROMPT, 'prompt ต้องถูกจับ');
      assert.equal(globalThis.__FD_CAPTURED_PROMPT.indexOf(AI_HONESTY_DNA), 0);
    });
  });

  await test('faceDetector.js::detectFaces (GPT tier): AI_HONESTY_DNA=0 → prompt ไม่มี DNA (byte-parity)', async () => {
    await withEnv({ AI_HONESTY_DNA: '0', FACE_CACHE: '0' }, async () => {
      globalThis.__FD_CAPTURED_PROMPT = null;
      await detectFaces(Buffer.alloc(64, 1));
      assert.ok(!globalThis.__FD_CAPTURED_PROMPT.includes(AI_HONESTY_DNA));
      assert.ok(globalThis.__FD_CAPTURED_PROMPT.startsWith('Analyze this image for face detection'));
    });
  });
}

// ═══════════════════ (6) refCoverBrain.js::extractCoverDNA — module-hook stub callAI ═══════════════════

{
  let capturedSystemPrompts = [];
  const STUB_OPENAI2 = MOD(`
export async function callAI({ systemPrompt }) {
  globalThis.__RCB_CAPTURED = globalThis.__RCB_CAPTURED || [];
  globalThis.__RCB_CAPTURED.push(systemPrompt);
  return { layoutType: 'x', template: { slots: [] }, layout: {} };
}`);
  const RCB_SRC = new URL('../src/', import.meta.url).href;
  const hook4 = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(STUB_OPENAI2)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(RCB_SRC)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
  register('data:text/javascript,' + encodeURIComponent(hook4));
  const { extractCoverDNA } = await import('../src/lib/refCoverBrain.js');

  await test('refCoverBrain.js::extractCoverDNA: ON → systemPrompt (SYSTEM) ที่ส่งไป callAI ขึ้นต้นด้วย AI_HONESTY_DNA', async () => {
    await withEnv({ AI_HONESTY_DNA: undefined }, async () => {
      globalThis.__RCB_CAPTURED = [];
      await extractCoverDNA('data:image/jpeg;base64,QUJD');
      assert.ok(globalThis.__RCB_CAPTURED.length >= 1, 'callAI ต้องถูกเรียกอย่างน้อย 1 ครั้ง');
      assert.equal(globalThis.__RCB_CAPTURED[0].indexOf(AI_HONESTY_DNA), 0, 'SYSTEM prompt แรกต้องขึ้นต้นด้วย DNA');
    });
  });

  await test('refCoverBrain.js::extractCoverDNA: AI_HONESTY_DNA=0 → systemPrompt ไม่มี DNA (byte-parity)', async () => {
    await withEnv({ AI_HONESTY_DNA: '0' }, async () => {
      globalThis.__RCB_CAPTURED = [];
      await extractCoverDNA('data:image/jpeg;base64,QUJD');
      assert.ok(!globalThis.__RCB_CAPTURED[0].includes(AI_HONESTY_DNA));
      assert.ok(globalThis.__RCB_CAPTURED[0].startsWith('คุณคือผู้เชี่ยวชาญออกแบบ'));
    });
  });
}

console.log(`\n# ai-honesty-dna: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
