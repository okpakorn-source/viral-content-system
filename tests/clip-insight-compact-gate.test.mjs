// /clip-transcript compact-prompt + enriched-pass switch regression (offline only)
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const mod = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const CLIP_SERVICE_SOURCE = await readFile(new URL('../src/lib/services/clipInsightService.js', import.meta.url), 'utf8');
const INSIGHT_ROUTE_SOURCE = await readFile(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8');

const STUB_OPENAI = mod(`export async function callAI(){ throw new Error('OPENAI_FORBIDDEN_IN_TEST'); }`);
const STUB_MODEL_CONFIG = mod(`export const MODEL_FAST = 'test-fast'; export const MODEL_NEWS_ANALYSIS = 'test-news';`);
const STUB_GEMINI = mod(`
export async function callGeminiVideo(args) { return globalThis.__clipPromptCapture(args); }
export async function callGeminiVideoFile(args) { return globalThis.__clipPromptCapture(args); }
`);
const STUB_CLIP_SERVICE = mod(`
const state = () => globalThis.__clipRouteState;
export async function extractClipInsight(args) { return state().firstPass(args); }
export async function extractInsightFromVideoBuffer(buffer, mimeType) { return state().firstPass({ buffer, mimeType }); }
export async function extractMultiTopicInsight(args) { return state().firstPass(args); }
export async function extractMultiTopicFromVideoBuffer(buffer, mimeType) { return state().firstPass({ buffer, mimeType }); }
export async function extractTranscriptQuotes(args) { return state().enrich(args); }
export async function extractTranscriptQuotesFromVideoBuffer(buffer, mimeType, topicHints, identity) {
  return state().enrich({ buffer, mimeType, topicHints, identity });
}
export function buildIdentityFromInsight(insight, caption) { return { insight, caption }; }
`);
const STUB_STORE = mod(`export function createStore(name) { return globalThis.__clipRouteState.store(name); }`);
const STUB_QUEUE = mod(`export function getClipVideoQueue() { return { run: (task) => task() }; }`);
const STUB_NEXT = mod(`export const NextResponse = { json: (body, init) => ({ _body: body, status: init?.status || 200, json: async () => body }) };`);
const STUB_FS_PROMISES = mod(`
export async function appendFile() {}
export async function readFile() { throw new Error('READ_FILE_FORBIDDEN_IN_TEST'); }
export async function unlink() {}
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(STUB_OPENAI)}, shortCircuit: true };
  if (specifier === '@/lib/ai/modelConfig') return { url: ${JSON.stringify(STUB_MODEL_CONFIG)}, shortCircuit: true };
  if (specifier === '@/lib/ai/geminiClient') return { url: ${JSON.stringify(STUB_GEMINI)}, shortCircuit: true };
  if (specifier === '@/lib/services/clipInsightService') return { url: ${JSON.stringify(STUB_CLIP_SERVICE)}, shortCircuit: true };
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/services/clipQueue') return { url: ${JSON.stringify(STUB_QUEUE)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier === 'fs/promises') return { url: ${JSON.stringify(STUB_FS_PROMISES)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const suffix = specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js');
    return nextResolve(new URL(suffix, ${JSON.stringify(SRC_ROOT)}).href, context);
  }
  return nextResolve(specifier, context);
}`;
register(mod(hook));

const originalFetch = globalThis.fetch;
after(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  else delete globalThis.fetch;
  delete globalThis.__clipPromptCapture;
  delete globalThis.__clipRouteState;
});

const clipService = await import(mod(CLIP_SERVICE_SOURCE));
const { POST } = await import(mod(INSIGHT_ROUTE_SOURCE));

test('first-pass prompt restores compact Thai rule and removes all minimum-length quotas', async () => {
  let captured;
  globalThis.__clipPromptCapture = async (args) => {
    captured = args;
    return { clipType: 'other', headline: 'หัวข้อทดสอบ', rawData: 'ก'.repeat(350), subStories: [] };
  };

  await clipService.extractClipInsight({
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    platform: 'youtube',
  });

  assert.ok(captured, 'Gemini mock must receive the first-pass request');
  assert.match(captured.prompt, /(?:^|\n)- ภาษาไทย เขียนกระชับ อ่านเข้าใจง่าย(?:\n|$)/);
  assert.doesNotMatch(captured.prompt, /600\+|1,500\+|2,500\+|ละเอียดสำคัญกว่าสั้น/);
  assert.match(captured.prompt, /★★ กฎหลักฐานตัวตน/);
  assert.match(captured.prompt, /★★ เนื้อดิบแยกประเด็น \(subStories\)/);
  assert.equal(captured.maxTokens, 32000, 'first-pass response ceiling must stay at 32000');

  // ★ 31 ก.ค. 69 (เจ้าของเคาะรอบสอง): ประเด็นย่อยต้อง "ครบในตัวเอง" ห้ามผูกกับความยาว rawData รวม
  //   (สมอเก่า "เท่า rawData รวม" ทำให้ประเด็นย่อยหดตามตอนเนื้อรวมกระชับ — ห้ามกลับมา)
  // ★ ผู้ตรวจไขว้รัด: ต้องปักหมุด "ทั้ง 2 จุด" แยกบริบท (กติกา + สคีมา JSON) — ลบทีละจุดเทสต้องแดง
  assert.match(captured.prompt, /แต่ละ subStory\.rawData ต้อง "ลึกและครบในตัวเอง"/, 'จุดที่ 1 (บล็อกกติกา SUBSTORY_RULES) ต้องอยู่');
  assert.match(captured.prompt, /ข้อเท็จจริงล้วน ลึกและครบในตัวเอง/, 'จุดที่ 2 (คำอธิบายฟิลด์ใน JSON template) ต้องอยู่');
  assert.strictEqual((captured.prompt.match(/ลึกและครบในตัวเอง/g) || []).length, 2, 'ต้องมีครบทั้ง 2 จุด ไม่ขาดไม่เกิน');
  assert.match(captured.prompt, /ใช้กับ rawData รวมเท่านั้น/, 'ต้องแยกขอบเขตกระชับ: เนื้อรวมเท่านั้น ไม่ลามประเด็นย่อย');
  assert.doesNotMatch(captured.prompt, /เท่า rawData รวม/, 'สมอผูกความยาวแบบเก่าต้องไม่กลับมา');
});

async function runInsightRoute(enrichedValue, slug) {
  const records = [];
  const calls = { firstPass: 0, enrich: 0, fetch: 0 };
  const store = {
    getAll: async () => records,
    add: async (record) => { records.push(record); return record; },
    update: async (id, updater) => {
      const index = records.findIndex((record) => record.id === id);
      if (index >= 0) records[index] = updater(records[index]);
      return index >= 0 ? records[index] : null;
    },
    remove: async (id) => {
      const index = records.findIndex((record) => record.id === id);
      if (index >= 0) records.splice(index, 1);
    },
  };
  globalThis.__clipRouteState = {
    store: () => store,
    firstPass: async () => {
      calls.firstPass++;
      return {
        engine: 'gemini-video',
        headline: `หัวข้อ ${slug}`,
        rawData: 'ข'.repeat(350),
        subStories: [{ no: 1, topic: 'ประเด็นย่อย', rawData: 'รายละเอียดประเด็นย่อย' }],
      };
    },
    enrich: async () => {
      calls.enrich++;
      return { enrichedRaw: 'ข้อมูลรอบสอง', enrichedTopics: [], punchyQuotes: [], transcript: '' };
    },
  };

  const video = new Uint8Array(12_000);
  globalThis.fetch = async (input) => {
    calls.fetch++;
    const url = String(input);
    if (url.startsWith('https://www.tikwm.com/api/')) {
      return { json: async () => ({ data: { play: 'https://video.test/mock.mp4' } }) };
    }
    if (url === 'https://video.test/mock.mp4') {
      return { arrayBuffer: async () => video.buffer };
    }
    throw new Error(`NETWORK_FORBIDDEN_IN_TEST: ${url}`);
  };

  const previous = process.env.CLIP_INSIGHT_ENRICHED;
  if (enrichedValue === undefined) delete process.env.CLIP_INSIGHT_ENRICHED;
  else process.env.CLIP_INSIGHT_ENRICHED = enrichedValue;
  try {
    const response = await POST({
      json: async () => ({ url: `https://www.tiktok.com/@unit/video/${slug}`, force: true, user: 'unit' }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    return { response, calls, records };
  } finally {
    if (previous === undefined) delete process.env.CLIP_INSIGHT_ENRICHED;
    else process.env.CLIP_INSIGHT_ENRICHED = previous;
  }
}

test('CLIP_INSIGHT_ENRICHED defaults off and never calls the second-pass service', async () => {
  const { response, calls, records } = await runInsightRoute(undefined, '7000000000000000001');
  assert.equal(response.status, 200);
  assert.equal(response._body.success, true);
  assert.equal(calls.firstPass, 1);
  assert.equal(calls.fetch, 2, 'both TikTok fetches must use the local mock');
  assert.equal(calls.enrich, 0);
  assert.equal(response._body.data.transcriptQuotes, undefined);
  assert.equal(response._body.data.rawData.length, 350);
  assert.equal(response._body.data.subStories.length, 1);
  // ★ 31 ก.ค. 69 (ผู้ตรวจเสนอแทน kill-switch): ทุก record ใหม่ต้องติดป้ายรุ่นพร้อมท์ ตรวจย้อนได้
  assert.equal(records[0]?.promptRev, 'sub-selfcontained-0801', 'record ต้องติดป้ายรุ่นพร้อมท์');
});

test("CLIP_INSIGHT_ENRICHED='1' calls the second-pass service once", async () => {
  const { response, calls } = await runInsightRoute('1', '7000000000000000002');
  assert.equal(response.status, 200);
  assert.equal(response._body.success, true);
  assert.equal(calls.firstPass, 1);
  assert.equal(calls.fetch, 2, 'both TikTok fetches must use the local mock');
  assert.equal(calls.enrich, 1);
  assert.equal(response._body.data.transcriptQuotes.enrichedRaw, 'ข้อมูลรอบสอง');
});

// ★ 31 ก.ค. 69 (ผู้ตรวจไขว้สั่งเติม): สวิตช์ต้องเข้มแบบ === '1' เท่านั้น — ค่า truthy อื่นถือว่าปิดทั้งหมด
//   ตาข่ายกัน regression: ถ้าวันหลังใครเผลอเปลี่ยนเป็น !== '0' หรือ truthy-check เทสชุดนี้ต้องแดงทันที
for (const [i, v] of [['3', 'true'], ['4', '0'], ['5', '']].entries()) {
  const [slugTail, val] = v;
  test(`CLIP_INSIGHT_ENRICHED='${val}' (ไม่ใช่ '1' เป๊ะ) → ต้องข้ามรอบ 2 เหมือนปิด`, async () => {
    const { response, calls } = await runInsightRoute(val, `700000000000000000${slugTail}`);
    assert.equal(response.status, 200);
    assert.equal(response._body.success, true);
    assert.equal(calls.enrich, 0, `ค่า "${val}" ต้องไม่เรียกรอบ 2 เลย`);
    assert.equal(response._body.data.transcriptQuotes, undefined);
  });
}
