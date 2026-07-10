// ============================================================
// ✂️ HOTFIX regression — finalCrop slot filter (pure mocked, ไม่ยิง LLM/network/sharp จริง)
// ------------------------------------------------------------
// stub ผ่าน ESM loader (data:URL — ไม่มีไฟล์ loader แยก):
//   'sharp' → chain ปลอม metadata/resize/jpeg/toBuffer
//   '@/lib/ai/openai' → callAI คืน crops ของ main+context_1 + นับจำนวน call ผ่าน globalThis
//   '@/lib/services/coverBenchmarkBrain' → brainPromptBlock คงที่
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const SHARP_STUB = `data:text/javascript,${encodeURIComponent(`
const chain = {
  metadata: async () => ({ width: 1000, height: 1250 }),
  resize: () => chain,
  jpeg: () => chain,
  toBuffer: async () => Buffer.from('stub-image'),
};
export default function sharp() { return chain; }
`)}`;
const OPENAI_STUB = `data:text/javascript,${encodeURIComponent(`
export async function callAI() {
  globalThis.__FC_CALLS = (globalThis.__FC_CALLS || 0) + 1;
  return {
    crops: [
      { slot: 'main', x: 0.10, y: 0.05, w: 0.50, h: 0.70, fx: 0.35, fy: 0.25, fw: 0.18, fh: 0.24 },
      { slot: 'context_1', x: 0.20, y: 0.10, w: 0.60, h: 0.60, fx: 0.60, fy: 0.30, fw: 0.16, fh: 0.20 },
    ],
  };
}
`)}`;
const BRAIN_STUB = `data:text/javascript,${encodeURIComponent('export function brainPromptBlock() { return "BRAIN-STUB"; }')}`;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(OPENAI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/coverBenchmarkBrain') return { url: ${JSON.stringify(BRAIN_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/aiClient') return { url: 'data:text/javascript,export function callBrain(){throw new Error("LLM_FORBIDDEN")}', shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { finalCrop } = await import('../src/lib/services/coverDirectorService.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };

const mkFixture = () => ({
  assignments: [
    { slotId: 'main', imageIndex: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, why: 'why-main' },
    { slotId: 'context_1', imageIndex: 1, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, why: 'why-context' },
  ],
  imageBuffers: [{ buffer: Buffer.from('a') }, { buffer: Buffer.from('b') }],
  templateSpec: {
    canvasW: 1080, canvasH: 1350,
    slots: [
      { id: 'main', x: 0, y: 0, w: 600, h: 1350, shape: 'rect' },
      { id: 'context_1', x: 600, y: 0, w: 480, h: 675, shape: 'rect' },
    ],
  },
  identity: { mainCharacter: 'ตัวเอกทดสอบ' },
  newsTitle: 'ข่าวทดสอบ slot filter',
  faceBoxes: [],
});
const snap = (a) => JSON.parse(JSON.stringify(a));
const calls = () => globalThis.__FC_CALLS || 0;

await test('default (ไม่ส่ง slotIds): ประมวลผลทุกช่อง — ครอปเปลี่ยนทั้ง main/context, imageIndex/slotId ไม่ขยับ', async () => {
  const f = mkFixture();
  const before = snap(f.assignments);
  const c0 = calls();
  const r = await finalCrop(f);
  assert.equal(r.applied, 2);
  assert.equal(calls(), c0 + 1, 'LLM ถูกเรียก 1 ครั้ง');
  assert.notDeepStrictEqual(f.assignments[0].crop, before[0].crop, 'main ต้องถูกครอปใหม่');
  assert.notDeepStrictEqual(f.assignments[1].crop, before[1].crop, 'context ต้องถูกครอปใหม่');
  assert.ok(f.assignments[0].why.includes('[FaceLock]') && f.assignments[1].why.includes('[FaceLock]'));
  for (let i = 0; i < 2; i++) {
    assert.equal(f.assignments[i].imageIndex, before[i].imageIndex);
    assert.equal(f.assignments[i].slotId, before[i].slotId);
  }
});

await test("slotIds:['main']: applied=1 — main เปลี่ยน, context crop/why byte-identical, index/slotId ทุกตัวเดิม", async () => {
  const f = mkFixture();
  const before = snap(f.assignments);
  const c0 = calls();
  const r = await finalCrop({ ...f, slotIds: ['main'] });
  assert.equal(r.applied, 1);
  assert.equal(calls(), c0 + 1);
  assert.notDeepStrictEqual(f.assignments[0].crop, before[0].crop, 'main ต้องถูกครอปใหม่');
  assert.equal(JSON.stringify(f.assignments[1].crop), JSON.stringify(before[1].crop), 'context crop ต้อง byte-identical');
  assert.equal(f.assignments[1].why, before[1].why, 'context why ต้องไม่ถูกแตะ');
  for (let i = 0; i < 2; i++) {
    assert.equal(f.assignments[i].imageIndex, before[i].imageIndex);
    assert.equal(f.assignments[i].slotId, before[i].slotId);
  }
});

await test("slotIds unknown (['nope']): คืน null · ไม่ mutate ใดๆ · ไม่เรียก LLM เลย", async () => {
  const f = mkFixture();
  const before = snap(f.assignments);
  const c0 = calls();
  const r = await finalCrop({ ...f, slotIds: ['nope'] });
  assert.equal(r, null);
  assert.equal(calls(), c0, 'ห้ามมี LLM call');
  assert.equal(JSON.stringify(f.assignments), JSON.stringify(before), 'ห้าม mutate แม้ field เดียว');
});

await test('slotIds:[] = parity กับ default — ประมวลผลทุกช่องเหมือนเดิม (ว่าง ≠ กรอง)', async () => {
  const f = mkFixture();
  const before = snap(f.assignments);
  const r = await finalCrop({ ...f, slotIds: [] });
  assert.equal(r.applied, 2);
  assert.notDeepStrictEqual(f.assignments[0].crop, before[0].crop);
  assert.notDeepStrictEqual(f.assignments[1].crop, before[1].crop);
});

console.log(`1..${passed}`);
