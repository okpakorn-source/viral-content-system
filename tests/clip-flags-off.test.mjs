// 🛡️ ยามเฝ้า "สวิตช์ปิด = ของเดิมเป๊ะ" (4 ส.ค. 69)
//   ของใหม่ชุด 4 ส.ค. (metadata ต้นทาง / พรอมต์ใหม่ / ด่านตรวจกลไก) ต้องอยู่หลังสวิตช์ที่ปิดเป็นค่าเริ่มต้น
//   ไฟล์นี้รันโดย "ไม่ตั้ง env ทั้ง 3 ตัว" แล้วยืนยันว่าป้ายรุ่นพรอมต์และพรอมต์จริงยังเป็นของเดิมทุกตัวอักษรสำคัญ
//   🔴 เทสนี้แดงเมื่อไหร่ = มีของใหม่รั่วออกมานอกสวิตช์ (ผู้ใช้จริงจะโดนโดยไม่ได้สั่ง)
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';

// ── 0) ปิดสวิตช์ทั้ง 3 ก่อนโหลดโมดูลใดๆ (เผื่อมีการอ่าน env ตอน import) ──
const FLAGS = ['CLIP_SOURCE_META', 'CLIP_PROMPT_0804', 'CLIP_QC_GATES'];
const savedEnv = {};
for (const f of FLAGS) { savedEnv[f] = process.env[f]; delete process.env[f]; }
after(() => {
  for (const f of FLAGS) {
    if (savedEnv[f] === undefined) delete process.env[f];
    else process.env[f] = savedEnv[f];
  }
  delete globalThis.__flagsOffCapture;
});

// ── 1) hook resolve '@/...' + ปลอมตัวเรียก AI (ห้ามยิงจริงเด็ดขาด) ──
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const mod = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUB_OPENAI = mod(`export async function callAI(){ throw new Error('OPENAI_FORBIDDEN_IN_TEST'); }`);
const STUB_MODEL_CONFIG = mod(`export const MODEL_FAST = 'test-fast'; export const MODEL_NEWS_ANALYSIS = 'test-news';`);
const STUB_GEMINI = mod(`
export async function callGeminiVideo(args) { globalThis.__flagsOffCapture = args; return { rawStory: 'เนื้อทดสอบ', topics: [] }; }
export async function callGeminiVideoFile(args) { globalThis.__flagsOffCapture = args; return { rawStory: 'เนื้อทดสอบ', topics: [] }; }
`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(STUB_OPENAI)}, shortCircuit: true };
  if (specifier === '@/lib/ai/modelConfig') return { url: ${JSON.stringify(STUB_MODEL_CONFIG)}, shortCircuit: true };
  if (specifier === '@/lib/ai/geminiClient') return { url: ${JSON.stringify(STUB_GEMINI)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const suffix = specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js');
    return nextResolve(new URL(suffix, ${JSON.stringify(SRC_ROOT)}).href, context);
  }
  return nextResolve(specifier, context);
}`;
register(mod(hook));

const rawStoryService = await import('../src/lib/services/clipRawStoryService.js');
const insightService = await import('../src/lib/services/clipInsightService.js');

const readSrc = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const RAWSTORY_SRC = await readSrc('../src/lib/services/clipRawStoryService.js');
const INSIGHT_SRC = await readSrc('../src/lib/services/clipInsightService.js');
const ROUTE_SRC = await readSrc('../src/app/api/clip-transcript/insight/route.js');

// บล็อก metadata ต้นทางตามข้อตกลงกลาง — ปิดสวิตช์แล้วห้ามโผล่ในพรอมต์ใดๆ
const META_BLOCK_MARK = '📎 ข้อมูลจากโพสต์ต้นทาง';

// ───────────── 1) ป้ายรุ่นพรอมต์ต้องเป็นค่าเดิมเป๊ะ ─────────────

test('สวิตช์ปิด: RAWSTORY_PROMPT_REV ต้องเป็น rawstory-v2-0803 (ห้ามเป็นรุ่น 0804)', () => {
  assert.equal(rawStoryService.RAWSTORY_PROMPT_REV, 'rawstory-v2-0803');
  assert.equal(rawStoryService.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803');
});

test('สวิตช์ปิด: promptRev ของสมองรอบแรกต้องยังเป็น raw-depth2legs-0801', () => {
  // ★ 4 ส.ค. (ผู้ตรวจไขว้ #6): route เลิก hardcode — ใช้ currentInsightPromptRev() จาก service เป็นความจริงแหล่งเดียว
  //   ยามจึงเฝ้า 2 ชั้น: (ก) ค่า runtime ตอนสวิตช์ปิดต้องเป็นค่าเดิมเป๊ะ (ข) route ต้องเรียกฟังก์ชันนี้จริง ไม่เขียนค่าเอง
  assert.equal(insightService.currentInsightPromptRev(), 'raw-depth2legs-0801',
    'ขาปิดของ currentInsightPromptRev ต้องเป็นค่าเดิมเป๊ะ');
  assert.match(ROUTE_SRC, /promptRev:\s*currentInsightPromptRev\(\)/,
    'route ต้องใช้ currentInsightPromptRev() — ห้ามกลับไป hardcode (ความจริง 2 แหล่งทำป้ายผิดเงียบ)');
  // 🔴 กันเคสที่กลัวจริง: ใครใส่รุ่นใหม่แบบตายตัว (ไม่มีประตู) → ผู้ใช้โดนทุกคนโดยไม่ได้สั่ง
  assert.doesNotMatch(ROUTE_SRC, /promptRev:\s*'[^']*0804[^']*'/,
    "ห้ามกำหนด promptRev รุ่น 0804 แบบไม่มีประตู (ต้องผ่านการเช็ค CLIP_PROMPT_0804 === '1' เสมอ)");
});

test('ด่านคำพูดต้องได้เห็น note ของ v2 เสมอ (ผู้ตรวจไขว้ #1 — กันคลิปเงียบโดนยิงซ้ำ+นั่งเทียน)', () => {
  // insight รอบแรกไม่มีฟิลด์ note — ถ้า route ส่ง insight ล้วนเข้า lintQuotePresence ทางหนี "คลิปเงียบ" จะไม่มีวันทำงาน
  assert.match(ROUTE_SRC, /_safeLintQuote\(\{\s*\.\.\.insight,\s*note:\s*rs\?\.note\s*\}/,
    'รอบแรกของด่านคำพูดต้องผสม note จาก rs (ผล v2) เข้า insight ก่อนส่งตรวจ');
  assert.match(ROUTE_SRC, /_safeLintQuote\(\{\s*\.\.\.insight,\s*note:\s*rs2\?\.note\s*\}/,
    'รอบยิงซ้ำต้องผสม note จาก rs2 เข้า insight ก่อนส่งตรวจ');
});

// ───────────── 2) พรอมต์จริงต้องไม่มีของใหม่ปน ─────────────

test('สวิตช์ปิด: พรอมต์เนื้อดิบ v2 ต้องไม่มีบล็อกข้อมูลต้นทาง และไม่มีร่องรอยรุ่น 0804', async () => {
  delete globalThis.__flagsOffCapture;
  const out = await rawStoryService.extractRawStoryV2({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const captured = globalThis.__flagsOffCapture;
  assert.ok(captured?.prompt, 'ต้องมีพรอมต์ส่งถึงตัวเรียก Gemini ปลอม');
  assert.ok(!captured.prompt.includes(META_BLOCK_MARK), 'บล็อกข้อมูลต้นทางต้องไม่ถูกฉีดตอนสวิตช์ปิด');
  assert.doesNotMatch(captured.prompt, /0804|rawstory-v3/, 'ห้ามมีร่องรอยพรอมต์รุ่นใหม่');
  assert.equal(out.promptRev, 'rawstory-v2-0803');
});

test('สวิตช์ปิด: พรอมต์รอบแรก (insight) ต้องไม่มีบล็อกข้อมูลต้นทาง', async () => {
  delete globalThis.__flagsOffCapture;
  await insightService.extractClipInsight({ url: 'https://www.youtube.com/watch?v=abcdefghijk', platform: 'youtube' });
  const captured = globalThis.__flagsOffCapture;
  assert.ok(captured?.prompt, 'ต้องมีพรอมต์ส่งถึงตัวเรียก Gemini ปลอม');
  assert.ok(!captured.prompt.includes(META_BLOCK_MARK), 'บล็อกข้อมูลต้นทางต้องไม่ถูกฉีดตอนสวิตช์ปิด');
  assert.doesNotMatch(captured.prompt, /0804/, 'ห้ามมีร่องรอยพรอมต์รุ่นใหม่');
  assert.equal(captured.maxTokens, 32000, 'เพดานโทเคนรอบแรกต้องเป็นค่าเดิม');
});

// ───────────── 3) ผลลัพธ์ต้องไม่มีฟิลด์ใหม่งอกตอนสวิตช์ปิด ─────────────

test('สวิตช์ปิด: ผลเนื้อดิบ v2 ต้องไม่มี sourceMeta / qualityFlags / rawStoryV2Error งอกมาเอง', () => {
  const out = rawStoryService.normalizeRawStory({ rawStory: 'เนื้อ', topics: [] });
  for (const field of ['sourceMeta', 'qualityFlags', 'rawStoryV2Error']) {
    assert.equal(Object.hasOwn(out, field), false, `ฟิลด์ ${field} ต้องไม่โผล่ตอนสวิตช์ปิด`);
  }
});

// ───────────── 4) รูปแบบการใช้สวิตช์: ต้องเทียบ '1' เป๊ะเสมอ ─────────────

test("ทุกจุดที่อ่านสวิตช์ 3 ตัว ต้องเทียบกับ '1' เป๊ะ (ห้าม truthy-check / ห้ามใส่ค่าเริ่มต้นเป็นเปิด)", async () => {
  const files = {
    'clipRawStoryService.js': RAWSTORY_SRC,
    'clipInsightService.js': INSIGHT_SRC,
    'insight/route.js': ROUTE_SRC,
    'clipSourceMetaService.js': await readSrc('../src/lib/services/clipSourceMetaService.js'),
    'clipQualityLint.js': await readSrc('../src/lib/services/clipQualityLint.js'),
  };
  const anyUse = /process\.env\.CLIP_(?:SOURCE_META|PROMPT_0804|QC_GATES)/g;
  const guarded = /process\.env\.CLIP_(?:SOURCE_META|PROMPT_0804|QC_GATES)\s*[!=]==\s*'1'/g;
  for (const [name, src] of Object.entries(files)) {
    const total = (src.match(anyUse) || []).length;
    const ok = (src.match(guarded) || []).length;
    assert.equal(ok, total, `${name}: มีจุดอ่านสวิตช์ที่ไม่ได้เทียบ '1' เป๊ะ (${total - ok} จุด)`);
  }
});

test('ด่านตรวจกลไกต้องเป็นฟังก์ชันบริสุทธิ์: ห้ามอ่าน env ห้ามเรียก AI ห้ามยิงเน็ตในไฟล์ lint', async () => {
  const src = await readSrc('../src/lib/services/clipQualityLint.js');
  assert.doesNotMatch(src, /process\.env/, 'lint ห้ามอ่าน env (ประตูอยู่ฝั่งผู้เรียก)');
  assert.doesNotMatch(src, /\bfetch\(|callAI|callGemini/, 'lint ห้ามเรียกเน็ต/AI');
});
