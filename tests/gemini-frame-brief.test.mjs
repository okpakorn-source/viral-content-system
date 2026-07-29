// ============================================================
// 🧪 gemini-frame-brief.test.mjs — geminiSelectFrames รับ frameBrief ใหม่ (เฟส A ข้อ 4, clip-first ชุด② dormant)
// ------------------------------------------------------------
// วิธีทดสอบ: stub globalThis.fetch (จับ prompt text ที่จะยิงจริง) + stub ./costStore.js (กันเขียนไฟล์ cost-log.json
// จริง) แล้วเรียก geminiSelectFrames ตัวจริงทั้งฟังก์ชัน — แพทเทิร์นเดียวกับ tests/gemini-busy-field.test.mjs
//
// พิสูจน์:
//   (a) dormant: ไม่ส่ง frameBrief → prompt ไม่มีบล็อกใบสั่งเฟรมเลย
//   (b) เปิดใช้จริง: ส่ง frameBrief → prompt มีบล็อกใบสั่ง + เนื้อ frameBrief ปรากฏ
//   (c) additive-only พิสูจน์เข้ม: ตัดบล็อกใบสั่ง (คำนวณ expected string ตรงจากซอร์ส) ออกจาก prompt-ที่มี-brief
//       แล้วต้องเท่ากับ prompt-ที่ไม่มี-brief เป๊ะ (ไม่ใช่แค่ "มี substring" — พิสูจน์ว่าไม่ได้แก้อย่างอื่นเลย)
//   (d) frameBrief ยาวเกิน 800 ตัวอักษร → ถูกตัด (ป้องกัน payload บวม)
//   (e) wiring: youtubePipeline.js ต้องรับ+ส่งต่อ frameBrief ครบสาย (runYouTubePipeline → selectWithGemini →
//       geminiSelectFrames) — ตรวจด้วย source grep (การรันจริงต้องมี yt-dlp/ffmpeg เครื่องทีมเท่านั้น นอกสโคปเทสนี้)
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const { geminiSelectFrames } = await import('../src/lib/gemini.js');

const ORIGINAL_FETCH = globalThis.fetch;
after(() => {
  if (ORIGINAL_FETCH) globalThis.fetch = ORIGINAL_FETCH;
  else delete globalThis.fetch;
});

function makeFetchStub(capture) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    capture.prompt = body.contents[0].parts[0].text;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ selected: [] }) }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    };
  };
}

const FRAMES = [{ index: 0, base64: 'AAAA' }];
const SUBJECTS = [{ name: 'ทดสอบ' }];

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('dormant: ไม่ส่ง frameBrief → prompt ไม่มีบล็อกใบสั่งเฟรมเลย', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key' }, async () => {
    const capture = {};
    globalThis.fetch = makeFetchStub(capture);
    await geminiSelectFrames({ frames: FRAMES, subjects: SUBJECTS, caseId: 'TEST' });
    assert.ok(!capture.prompt.includes('ใบสั่งเฟรม'), 'ไม่ส่ง frameBrief ต้องไม่มีบล็อกนี้เลย');
  });
});

test('เปิดใช้จริง: ส่ง frameBrief → prompt มีบล็อกใบสั่ง + เนื้อ frameBrief ปรากฏ', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key' }, async () => {
    const capture = {};
    globalThis.fetch = makeFetchStub(capture);
    await geminiSelectFrames({
      frames: FRAMES,
      subjects: SUBJECTS,
      caseId: 'TEST',
      frameBrief: 'หาเฟรมที่เห็นหน้ายิ้มขณะเดินเข้าบ้านเก่า',
    });
    assert.ok(capture.prompt.includes('ใบสั่งเฟรม'), 'ต้องมีบล็อกใบสั่งเฟรม');
    assert.ok(capture.prompt.includes('หาเฟรมที่เห็นหน้ายิ้มขณะเดินเข้าบ้านเก่า'));
  });
});

test('additive-only: ตัดบล็อกใบสั่งออกจาก prompt-มี-brief แล้วต้องเท่ากับ prompt-ไม่มี-brief เป๊ะ', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key' }, async () => {
    const captureNo = {};
    globalThis.fetch = makeFetchStub(captureNo);
    await geminiSelectFrames({ frames: FRAMES, subjects: SUBJECTS, caseId: 'TEST' });

    const frameBrief = 'หาเฟรมที่เห็นหน้ายิ้มขณะเดินเข้าบ้านเก่า';
    const captureYes = {};
    globalThis.fetch = makeFetchStub(captureYes);
    await geminiSelectFrames({ frames: FRAMES, subjects: SUBJECTS, caseId: 'TEST', frameBrief });

    const briefBlock = `\n🎯 ใบสั่งเฟรมที่ต้องหาเป็นพิเศษ (ให้น้ำหนักเฟรมที่ตรงกับใบสั่งนี้ก่อนเป็นอันดับแรกเมื่อมีให้เลือกหลายเฟรมใกล้เคียงกัน แต่ยังต้องผ่านเกณฑ์คุณภาพด้านล่างเสมอ — ไม่ใช่เลือกแทนเกณฑ์):\n${frameBrief}\n`;
    assert.equal(
      captureYes.prompt.replace(briefBlock, ''),
      captureNo.prompt,
      'ตัดบล็อกใบสั่งออกแล้วต้องเหลือ prompt เดิมเป๊ะ (พิสูจน์ additive-only ไม่แตะจุดอื่น)'
    );
  });
});

test('frameBrief ยาวเกิน 800 ตัวอักษร → ถูกตัด (กัน payload บวม)', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key' }, async () => {
    const capture = {};
    globalThis.fetch = makeFetchStub(capture);
    const longBrief = 'ก'.repeat(1000);
    await geminiSelectFrames({ frames: FRAMES, subjects: SUBJECTS, caseId: 'TEST', frameBrief: longBrief });
    assert.ok(!capture.prompt.includes('ก'.repeat(801)), 'ต้องไม่มี 801 ตัวอักษรติดกัน (พิสูจน์ตัดที่ 800)');
    assert.ok(capture.prompt.includes('ก'.repeat(800)), 'ต้องยังมี 800 ตัวแรกอยู่');
  });
});

test('wiring: youtubePipeline.js ต่อสาย frameBrief ครบ (runYouTubePipeline → selectWithGemini → geminiSelectFrames)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'youtubePipeline.js'), 'utf8');
  assert.match(
    src,
    /export async function runYouTubePipeline\(\{\s*caseId,\s*keywords,\s*progress,\s*clipUrls,\s*newsGist,\s*frameBrief\s*\}\)/,
    'runYouTubePipeline ต้อง destructure frameBrief จาก options'
  );
  assert.match(
    src,
    /selectWithGemini\(cand,\s*subjects,\s*P\.onRetry,\s*caseId,\s*newsGist,\s*pinpoint,\s*frameBrief\)/,
    'ต้องส่ง frameBrief ต่อให้ selectWithGemini'
  );
  assert.match(
    src,
    /async function selectWithGemini\(cand,\s*subjects,\s*onRetry,\s*caseId,\s*newsGist,\s*pinpoint,\s*frameBrief\)/,
    'selectWithGemini ต้องรับ frameBrief เป็นพารามิเตอร์'
  );
  assert.match(
    src,
    /geminiSelectFrames\(\{\s*frames,\s*subjects,\s*onRetry,\s*caseId,\s*newsGist,\s*pinpoint,\s*model:\s*COVER_GEMINI_MODEL,\s*frameBrief\s*\}\)/,
    'ต้องส่ง frameBrief ต่อให้ geminiSelectFrames'
  );
});
