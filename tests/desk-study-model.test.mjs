// ============================================================
// 🔬 P5 (2 ส.ค. 69) — ปักหมุด "โมเดลที่ studyDna ใช้จริงในแต่ละรอบ"
// ------------------------------------------------------------
// เจ้าของสั่ง: บก.AI อ่านคลังด้วย "ตัวเล็ก" เพราะรอบย่อยคืองานบีบอัด ไม่ใช่งานตัดสิน
//   · รอบย่อย (อ่าน exemplar ทีละก้อน → สรุปข้อสังเกต) = DESK_MODEL_FAST
//   · รอบปิด (กลั่นธรรมนูญ)                          = DESK_MODEL_BRAIN (primary) เสมอ ห้ามเปลี่ยน
//   · kill-switch DESK_STUDY_FAST=0                  → รอบย่อยกลับไปใช้ primary เหมือนก่อนแก้
// แพทเทิร์น register-stub เดียวกับ tests/desk-pipeline-gate-reopen.test.mjs — ห้ามมี network/LLM จริง
// (editorBrain.js ใช้ relative import ล้วน → hook ดัก specifier ตรงๆ · relative ตัวไหนไม่ได้ stub = ระเบิด)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (src) => 'data:text/javascript,' + encodeURIComponent(src);

// ชื่อโมเดลปลอม — ตั้งใจให้ไม่เหมือนของจริง เทสจะได้ไม่ผ่านเพราะบังเอิญชื่อชนกัน
const PRIMARY = 'TEST-MODEL-PRIMARY';
const FAST = 'TEST-MODEL-FAST';

const STUB_DESK_MODELS = _mod(`
export const DESK_MODEL_BRAIN = ${JSON.stringify(PRIMARY)};
export const DESK_MODEL_FAST = ${JSON.stringify(FAST)};
`);

const STUB_MODEL_COSTS = _mod(`
export const MODEL_COSTS = {
  ${JSON.stringify(PRIMARY)}: { input: 5, output: 30 },
  ${JSON.stringify(FAST)}: { input: 0.5, output: 3 },
};
`);

// 🔴 หัวใจของไฟล์นี้ — บันทึกทุกครั้งที่เรียก AI ว่า "รอบไหน ใช้โมเดลอะไร"
//    แยกรอบด้วยคีย์โครงสร้างใน prompt (observationsFromChunks = รอบปิด) ไม่ผูกกับถ้อยคำไทยที่แก้ได้ง่าย
const STUB_AI = _mod(`
export async function callAI({ systemPrompt, userPrompt, model }) {
  const isConsolidate = String(userPrompt || '').includes('observationsFromChunks');
  globalThis.__STUDY.calls.push({ model, role: isConsolidate ? 'consolidate' : 'chunk' });
  if (isConsolidate) {
    return {
      topDirections: [{ name: 'คนธรรมดาทำดี', why: 'คนแชร์เยอะ', signals: ['ช่วยเหลือ'] }],
      mustHavePositive: ['มีคนจริง'],
      avoidNegative: ['ด่าทอ'],
      scoringGuide: ['ทำใหม่ได้ไหม'],
      editorNotes: 'บันทึกทดสอบ',
    };
  }
  return { observations: 'ข้อสังเกตทดสอบของก้อนนี้' };
}
`);

const STUB_STORE = _mod(`
export function createStore(name) {
  return {
    getAll: async () => (globalThis.__STUDY.stores[name] || []),
    add: async (rec) => { (globalThis.__STUDY.stores[name] ||= []).push(rec); return rec; },
    remove: async (id) => {
      const arr = globalThis.__STUDY.stores[name] || [];
      globalThis.__STUDY.stores[name] = arr.filter((r) => r.id !== id);
      return true;
    },
  };
}
`);

const STUB_DNA_CONTRACT = _mod(`
export const STORE_EXEMPLARS = 'dna-exemplars';
export const STORE_RUNS = 'dna-research-runs';
export function sanitizeText(s, max = 300) {
  return String(s ?? '').replace(/\\s+/g, ' ').trim().slice(0, max);
}
`);

const STUB_LEADS = _mod(`
export const STORE = 'research-leads';
export async function listLeads() { return []; }
export async function pushEvent() { return true; }
`);

const STUB_EXTRACT = _mod(`
export async function extractAndSend() { throw new Error('EXTRACT_FORBIDDEN_IN_TEST'); }
export function classifyExtractRoute() { return 'article'; }
export async function extractArticle() { throw new Error('EXTRACT_FORBIDDEN_IN_TEST'); }
export async function extractClip() { throw new Error('EXTRACT_FORBIDDEN_IN_TEST'); }
export async function attachExtract() { throw new Error('EXTRACT_FORBIDDEN_IN_TEST'); }
`);

const STUB_OUTBOX = _mod(`
export async function enqueueOutbox() { throw new Error('OUTBOX_FORBIDDEN_IN_TEST'); }
`);

const hook = `
const MAP = {
  '../../persistStore.js': ${JSON.stringify(STUB_STORE)},
  '../../ai/openai.js': ${JSON.stringify(STUB_AI)},
  '../../ai/modelConfig.js': ${JSON.stringify(STUB_MODEL_COSTS)},
  '../deskModelConfig.js': ${JSON.stringify(STUB_DESK_MODELS)},
  './dnaContract.js': ${JSON.stringify(STUB_DNA_CONTRACT)},
  './researchLeads.js': ${JSON.stringify(STUB_LEADS)},
  './researchExtract.js': ${JSON.stringify(STUB_EXTRACT)},
  './editorOutbox.js': ${JSON.stringify(STUB_OUTBOX)},
};
export async function resolve(specifier, ctx, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  if (specifier.startsWith('.') || specifier.startsWith('@/')) {
    // ห้าม fail-open ไปโหลดโมดูลจริง (Supabase/LLM/เน็ต) — ไม่รู้จัก = ระเบิดให้คนเติม stub
    throw new Error('UNSTUBBED_IMPORT_FORBIDDEN: ' + specifier);
  }
  return next(specifier, ctx);
}
`;
register(_mod(hook));

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };

// นำเข้าเป็น file: URL — ไม่ใช่ relative specifier จะได้ไม่ชนกฎ UNSTUBBED ข้างบน
const BRAIN_URL = new URL('../src/lib/services/deskV2/editorBrain.js', import.meta.url).href;
const { studyDna } = await import(BRAIN_URL);

// คลัง exemplar ปลอม 170 ใบ → CHUNK_SIZE=80 ⇒ รอบย่อย 3 ก้อน + รอบปิด 1 = 4 ครั้ง
const EXEMPLARS = Array.from({ length: 170 }, (_, i) => ({
  id: 'ex' + i,
  reach: 10000 + i,
  tier: i % 2 ? 'S' : 'A',
  dna: {
    archetype: 'คนธรรมดาทำดี',
    category: 'บันเทิง',
    twist: 'พลิกตอนจบ',
    emotionalTriggers: ['ซึ้ง', 'ภูมิใจ'],
    hookPattern: 'ตั้งคำถาม',
    numbersUsed: true,
  },
}));

function withStudyEnv(studyFast, fn) {
  return async () => {
    const saved = process.env.DESK_STUDY_FAST;
    if (studyFast === null) delete process.env.DESK_STUDY_FAST;
    else process.env.DESK_STUDY_FAST = studyFast;
    globalThis.__STUDY = {
      calls: [],
      stores: { 'dna-exemplars': EXEMPLARS, 'dna-research-runs': [], 'editor-brain': [] },
    };
    try { return await fn(); } finally {
      if (saved === undefined) delete process.env.DESK_STUDY_FAST; else process.env.DESK_STUDY_FAST = saved;
      delete globalThis.__STUDY;
    }
  };
}

const chunkCalls = () => globalThis.__STUDY.calls.filter((c) => c.role === 'chunk');
const consolidateCalls = () => globalThis.__STUDY.calls.filter((c) => c.role === 'consolidate');

// ============================================================
// ① ค่าเริ่มต้น — รอบย่อย = ตัวเล็ก · รอบปิด = ตัวใหญ่
// ============================================================
test('ค่าเริ่มต้น: รอบย่อยทุกก้อนใช้ FAST · รอบปิดใช้ PRIMARY', withStudyEnv(null, async () => {
  const result = await studyDna({});

  const chunks = chunkCalls();
  const finals = consolidateCalls();
  assert.ok(chunks.length >= 2, 'ต้องมีรอบย่อยหลายก้อนจริง (พิสูจน์ว่าทุกก้อนใช้ตัวเล็ก ไม่ใช่ก้อนเดียวฟลุ๊ก)');
  assert.strictEqual(finals.length, 1, 'รอบปิดต้องมีครั้งเดียว');

  for (const c of chunks) {
    assert.strictEqual(c.model, FAST, '🔬 รอบย่อย = งานบีบอัด ต้องใช้ DESK_MODEL_FAST');
  }
  assert.strictEqual(finals[0].model, PRIMARY, '🔴 รอบปิด = งานตัดสิน ต้องใช้ DESK_MODEL_BRAIN');

  // ลำดับ: รอบปิดต้องเป็นครั้งสุดท้ายเสมอ
  const calls = globalThis.__STUDY.calls;
  assert.strictEqual(calls[calls.length - 1].role, 'consolidate');
  assert.strictEqual(result.aiCalls, calls.length, 'aiCalls ที่รายงานต้องตรงกับจำนวนเรียกจริง');
  assert.strictEqual(result.exemplarCount, EXEMPLARS.length);
}));

test('ค่าเริ่มต้น: record ที่เก็บลงคลังแยก model (รอบปิด) กับ modelChunk (รอบย่อย)', withStudyEnv(null, async () => {
  await studyDna({});
  const brain = globalThis.__STUDY.stores['editor-brain'].find((r) => r.id === 'brain_latest');
  assert.ok(brain, 'ต้องเก็บ brain_latest จริง');
  assert.strictEqual(brain.model, PRIMARY, 'model ในบันทึก = โมเดลรอบปิด');
  assert.strictEqual(brain.modelChunk, FAST, 'modelChunk ในบันทึก = โมเดลรอบย่อย (ตามรอยค่าใช้จ่ายย้อนหลังได้)');
}));

// ============================================================
// ② kill-switch DESK_STUDY_FAST=0 → รอบย่อยกลับเป็น PRIMARY
// ============================================================
test('DESK_STUDY_FAST=0: รอบย่อยกลับไปใช้ PRIMARY (พฤติกรรมเดิมก่อนแก้)', withStudyEnv('0', async () => {
  await studyDna({});
  const chunks = chunkCalls();
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.strictEqual(c.model, PRIMARY, 'ปิดสวิตช์แล้วรอบย่อยต้องกลับเป็นตัวเดิม');
  }
  assert.strictEqual(consolidateCalls()[0].model, PRIMARY, 'รอบปิดยังเป็น PRIMARY เหมือนเดิม');
}));

test('DESK_STUDY_FAST=0: record บันทึก modelChunk = PRIMARY ตามที่ใช้จริง', withStudyEnv('0', async () => {
  await studyDna({});
  const brain = globalThis.__STUDY.stores['editor-brain'].find((r) => r.id === 'brain_latest');
  assert.strictEqual(brain.model, PRIMARY);
  assert.strictEqual(brain.modelChunk, PRIMARY);
}));

// ============================================================
// ③ เฉพาะค่า '0' เท่านั้นที่ปิด — ค่าอื่นไม่ปิดเงียบๆ
// ============================================================
test("DESK_STUDY_FAST=1 → ยังใช้ FAST (มีแค่ค่า '0' ที่ปิดสวิตช์)", withStudyEnv('1', async () => {
  await studyDna({});
  for (const c of chunkCalls()) assert.strictEqual(c.model, FAST);
  assert.strictEqual(consolidateCalls()[0].model, PRIMARY);
}));

test('DESK_STUDY_FAST=ค่าเพี้ยน (yes) → ยังใช้ FAST ไม่ปิดเงียบ', withStudyEnv('yes', async () => {
  for (const c of (await studyDna({}), chunkCalls())) assert.strictEqual(c.model, FAST);
  assert.strictEqual(consolidateCalls()[0].model, PRIMARY);
}));

// ============================================================
// ④ สัญญาเดิมของ modelKey ต้องไม่เปลี่ยน
// ============================================================
test("modelKey:'fast' (ผู้เรียกสั่งเอง) → ทั้งสองรอบเป็น FAST เหมือนสัญญาเดิม", withStudyEnv(null, async () => {
  await studyDna({ modelKey: 'fast' });
  for (const c of chunkCalls()) assert.strictEqual(c.model, FAST);
  assert.strictEqual(consolidateCalls()[0].model, FAST, "modelKey:'fast' ต้องยังกดรอบปิดเป็น fast ได้เหมือนเดิม");
}));

test("modelKey:'primary' (ระบุตรงๆ) → รอบย่อย FAST · รอบปิด PRIMARY", withStudyEnv(null, async () => {
  await studyDna({ modelKey: 'primary' });
  for (const c of chunkCalls()) assert.strictEqual(c.model, FAST);
  assert.strictEqual(consolidateCalls()[0].model, PRIMARY);
}));

test("DESK_STUDY_FAST=0 + modelKey:'fast' → ทั้งสองรอบเป็น FAST (สวิตช์ไม่ดันขึ้นเป็น primary)", withStudyEnv('0', async () => {
  await studyDna({ modelKey: 'fast' });
  for (const c of chunkCalls()) assert.strictEqual(c.model, FAST);
  assert.strictEqual(consolidateCalls()[0].model, FAST);
}));

// ============================================================
// ⑤ maxExemplars ย่อคลัง — รอบย่อยก้อนเดียวก็ยังต้องเป็นตัวเล็ก
// ============================================================
test('maxExemplars=40 (ก้อนเดียว): รอบย่อยยังเป็น FAST · รอบปิดยังเป็น PRIMARY', withStudyEnv(null, async () => {
  const result = await studyDna({ maxExemplars: 40 });
  const chunks = chunkCalls();
  assert.strictEqual(chunks.length, 1, 'ย่อคลังเหลือ 40 ใบ = รอบย่อยก้อนเดียว');
  assert.strictEqual(chunks[0].model, FAST);
  assert.strictEqual(consolidateCalls()[0].model, PRIMARY);
  assert.strictEqual(result.exemplarCount, 40);
}));
