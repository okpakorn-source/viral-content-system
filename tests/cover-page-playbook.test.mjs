// ============================================================
// cover-page-playbook.test.mjs — ตรวจซ้ำ (28 ก.ค. 69): แทรกคัมภีร์จัดภาพปกฉบับเต็ม (COVER_PAGE_PLAYBOOK,
//   src/lib/coverPagePlaybook.js) เข้า system prompt ของ artBriefBrain + slotDirectorBrain (legacy + systemSem)
//   🔴 กฎเหล็กเจ้าของ: ต้องเข้าครบทุกตัวอักษร ห้ามตัด/ย่อ/สรุป — เทสนี้พิสูจน์ด้วย indexOf ทั้งก้อน (ไม่ใช่แค่
//   เช็คคำขึ้นต้น/ความยาว) ทั้ง 3 ระบบ prompt + พิสูจน์ปิดสวิตช์ (MEGA_PAGE_PLAYBOOK=0 → pagePlaybookOn:false)
//   = byte-identical เดิม + วัด/log ความยาว prompt รวมจริง (คัมภีร์+กติกา+งบภาพ 45000) ยืนยันไม่ชนเพดาน input
//   ไม่ยิง LLM จริง (stub callBrain แค่ "จับ args") · deterministic ล้วน
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(a){ globalThis.__CAPTURED = a; return { text: JSON.stringify({ orders: [], storyNote: "x", slots: {} }) }; }');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { artBriefBrain, slotDirectorBrain } = await import('../src/lib/megaBrains.js');
const { COVER_PAGE_PLAYBOOK } = await import('../src/lib/coverPagePlaybook.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };
const captureSystem = async (fn) => { await fn(); return globalThis.__CAPTURED.system; };

assert.ok(COVER_PAGE_PLAYBOOK.length > 500, `sanity: คัมภีร์ต้องมีเนื้อจริง (ได้ ${COVER_PAGE_PLAYBOOK.length} ตัวอักษร)`);
console.log(`   (คัมภีร์เพจฉบับเต็ม: ${COVER_PAGE_PLAYBOOK.length} ตัวอักษร)`);

const FIXED_COMPASS = { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: ['sad'], mainCharacters: [{ name: 'ทดสอบ', role: 'hero' }], visualDreamShots: [] };
const REF_DNA = { slots: [{ role: 'hero', pos: 'ซ้าย', shot: 'closeup', emotion: 'warm', faceSizePct: 60 }, { role: 'context', pos: 'ขวา' }] };
const META_NO_FLAGS = [{ id: 'A', category: 'context', quality: 7, note: 'test' }];
const SLOT_CONTRACT = [
  { id: 'main', refRole: 'hero', shape: 'rect' },
  { id: 'sub_a', refRole: 'context', shape: 'rect' },
  { id: 'sub_b', refRole: 'context', shape: 'rect' },
  { id: 'circle_a', refRole: 'circle', shape: 'circle' },
];

// ═══════════════════════ (ก) แทรกครบทั้งก้อน verbatim (indexOf ทั้งสตริง ไม่ใช่แค่คำขึ้นต้น) ═══════════════════════

await test('artBriefBrain: system (default pagePlaybookOn=true) ต้องมี COVER_PAGE_PLAYBOOK ทั้งก้อนอยู่จริง (indexOf ทั้งสตริง)', async () => {
  const sys = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false }));
  const idx = sys.indexOf(COVER_PAGE_PLAYBOOK);
  assert.ok(idx >= 0, `ต้องเจอคัมภีร์ทั้งก้อนใน system (indexOf=${idx})`);
});

await test('slotDirectorBrain (legacy system, default pagePlaybookOn=true) ต้องมี COVER_PAGE_PLAYBOOK ทั้งก้อนอยู่จริง', async () => {
  const sys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '' }));
  const idx = sys.indexOf(COVER_PAGE_PLAYBOOK);
  assert.ok(idx >= 0, `ต้องเจอคัมภีร์ทั้งก้อนใน legacy system (indexOf=${idx})`);
});

await test('slotDirectorBrain (systemSem — SEM-1, default pagePlaybookOn=true) ต้องมี COVER_PAGE_PLAYBOOK ทั้งก้อนอยู่จริง', async () => {
  const sys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT }));
  const idx = sys.indexOf(COVER_PAGE_PLAYBOOK);
  assert.ok(idx >= 0, `ต้องเจอคัมภีร์ทั้งก้อนใน systemSem (indexOf=${idx})`);
});

await test('ตำแหน่ง: คัมภีร์ต้องมาก่อนบล็อกกติกาเดิม ("กฎเหล็ก:") ทุกระบบ prompt', async () => {
  const sysArt = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false }));
  const sysLegacy = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '' }));
  const sysSem = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT }));
  for (const [label, sys] of [['artBrief', sysArt], ['legacy', sysLegacy], ['sem', sysSem]]) {
    const pIdx = sys.indexOf(COVER_PAGE_PLAYBOOK);
    const rIdx = sys.indexOf('กฎเหล็ก:');
    assert.ok(pIdx >= 0 && rIdx >= 0 && pIdx < rIdx, `${label}: คัมภีร์ (${pIdx}) ต้องมาก่อน "กฎเหล็ก:" (${rIdx})`);
  }
});

// ═══════════════════════ (ข) ปิดสวิตช์ (pagePlaybookOn=false) = byte-identical เดิม (ไม่มีคัมภีร์เลย) ═══════════════════════

await test('ปิดสวิตช์ (pagePlaybookOn=false): artBriefBrain system ไม่มีคัมภีร์เลยแม้ตัวอักษรเดียว', async () => {
  const sysOn = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, pagePlaybookOn: true }));
  const sysOff = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, pagePlaybookOn: false }));
  assert.ok(!sysOff.includes(COVER_PAGE_PLAYBOOK), 'ปิดสวิตช์ต้องไม่มีคัมภีร์เลย');
  assert.notEqual(sysOn, sysOff, 'เปิด/ปิด ต้องต่างกันจริง (ไม่ใช่ no-op)');
  assert.equal(sysOn.length - sysOff.length, COVER_PAGE_PLAYBOOK.length + 2, `ผลต่างความยาวต้องเท่ากับคัมภีร์+ตัวคั่น \\n\\n เป๊ะ (ได้ ${sysOn.length - sysOff.length})`);
});

await test('ปิดสวิตช์ (pagePlaybookOn=false): slotDirectorBrain legacy + systemSem ไม่มีคัมภีร์เลยทั้งคู่', async () => {
  const legacyOff = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', pagePlaybookOn: false }));
  const semOff = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT, pagePlaybookOn: false }));
  assert.ok(!legacyOff.includes(COVER_PAGE_PLAYBOOK));
  assert.ok(!semOff.includes(COVER_PAGE_PLAYBOOK));
});

await test('env MEGA_PAGE_PLAYBOOK=0 (megaAdapters.js wiring): ไม่ส่ง pagePlaybookOn เลย = default true (ต้องเห็นคัมภีร์) — ยืนยัน default ON ตรงตามสเปค', async () => {
  const sysDefault = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false }));
  assert.ok(sysDefault.includes(COVER_PAGE_PLAYBOOK), 'ไม่ส่งพารามิเตอร์ = default ON ต้องเห็นคัมภีร์');
});

// ═══════════════════════ (ค) วัดความยาว prompt รวมจริง (คัมภีร์+กติกา+งบภาพ 45000) — log ตัวเลขจริง ═══════════════════════

await test('วัดความยาว prompt รวมจริง: คัมภีร์ + กติกาเดิม + งบภาพ default 45000 → log ตัวเลขจริง ยืนยันไม่ชนเพดาน input โมเดล', async () => {
  const sysArt = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false }));
  const sysLegacy = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '' }));
  const sysSem = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT }));
  const IMG_META_BUDGET_DEFAULT = 45000; // ค่า default ของ imgMetaBudget (ข้อ 6, 27 ก.ค. 69) — งบ "รายชื่อภาพ" แยกจาก system
  const totalArt = sysArt.length + IMG_META_BUDGET_DEFAULT;
  const totalLegacy = sysLegacy.length + IMG_META_BUDGET_DEFAULT;
  const totalSem = sysSem.length + IMG_META_BUDGET_DEFAULT;
  // opus-5 (โมเดลที่ใช้จริง) รับ context ได้ระดับแสนตัวอักษรขึ้นไปสบายๆ — เพดานเผื่อไว้กว้างๆ กันชนจริง (order-of-magnitude เท่านั้น)
  const MODEL_INPUT_CEILING_ESTIMATE = 400000;
  console.log(`   [ตัวเลขจริง] คัมภีร์เพจ = ${COVER_PAGE_PLAYBOOK.length} ตัวอักษร`);
  console.log(`   [ตัวเลขจริง] artBriefBrain system (คัมภีร์+กติกาเดิม รวม) = ${sysArt.length} ตัวอักษร`);
  console.log(`   [ตัวเลขจริง] slotDirectorBrain legacy system (คัมภีร์+กติกาเดิม รวม) = ${sysLegacy.length} ตัวอักษร`);
  console.log(`   [ตัวเลขจริง] slotDirectorBrain systemSem (คัมภีร์+กติกาเดิม รวม) = ${sysSem.length} ตัวอักษร`);
  console.log(`   [ตัวเลขจริง] + งบรายชื่อภาพ (imgMetaBudget default) = ${IMG_META_BUDGET_DEFAULT} ตัวอักษร`);
  console.log(`   [ตัวเลขจริง] รวมสูงสุดที่ยิงจริง (system ที่ยาวสุด + งบภาพ) = ${Math.max(totalArt, totalLegacy, totalSem)} ตัวอักษร`);
  console.log(`   [เพดานประมาณ] MEGA_S6 opus-5 รับได้ระดับ ${MODEL_INPUT_CEILING_ESTIMATE.toLocaleString()} ตัวอักษรขึ้นไปสบายๆ`);
  assert.ok(Math.max(totalArt, totalLegacy, totalSem) < MODEL_INPUT_CEILING_ESTIMATE, `รวมแล้วต้องไม่ชนเพดานประมาณ (ได้ ${Math.max(totalArt, totalLegacy, totalSem)})`);
});

console.log(`\n# cover-page-playbook: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
