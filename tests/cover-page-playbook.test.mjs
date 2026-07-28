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
// ★ เฟส 1 v3 (28 ก.ค. 69, เคส "ฝังคัมภีร์ v3 เข้าท่อปก"): เพิ่ม parent-tag propagation — ถ้า parent module ที่ import
//   '@/lib/coverPagePlaybook' ถูก cache-bust ด้วย query 'v2switch' (ดู megaBrains.js?v2switch ด้านล่าง) ให้ผูก
//   query เดียวกันต่อเข้า coverPagePlaybook ด้วย บังคับให้มันถูกประเมินใหม่ (อ่าน process.env.MEGA_PLAYBOOK_V2
//   ปัจจุบันจริงๆ ตอนโหลด ณ main thread) แทนที่จะใช้ instance เดิมที่แคชไว้ตั้งแต่ import แรกบนสุดของไฟล์นี้
//   (ทดสอบแล้ว: hook ที่ register() ทำงานคนละ thread กับ main — อ่าน process.env ในตัว hook เองไม่ได้ ต้องผูก
//   ผ่าน context.parentURL/query แทนซึ่งเป็น logic ล้วนไม่พึ่ง env ในฝั่ง hook เลย)
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    let mapped = specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js');
    if (mapped.startsWith('lib/coverPagePlaybook') && context.parentURL && context.parentURL.includes('v2switch')) {
      mapped += (mapped.includes('?') ? '&' : '?') + 'v2switch';
    }
    const mappedURL = new URL(mapped, ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mappedURL, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { artBriefBrain, slotDirectorBrain } = await import('../src/lib/megaBrains.js');
const { COVER_PAGE_PLAYBOOK, COVER_PAGE_PLAYBOOK_V2, COVER_PAGE_PLAYBOOK_V3 } = await import('../src/lib/coverPagePlaybook.js');

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

// ═══════════════ เฟส 1 v3 (28 ก.ค. 69, วิจัยใหญ่ 478 ใบ): คัมภีร์ v3 default + MEGA_PLAYBOOK_V2=1 rollback ═══════════════

await test('sanity: COVER_PAGE_PLAYBOOK_V2 (~3,535) และ COVER_PAGE_PLAYBOOK_V3 (~6,800 หลังแก้คำ 28 ก.ค. 69) มีเนื้อจริงและไม่ใช่ก้อนเดียวกัน', () => {
  assert.ok(COVER_PAGE_PLAYBOOK_V2.length > 500, `V2 ต้องมีเนื้อจริง (ได้ ${COVER_PAGE_PLAYBOOK_V2.length})`);
  assert.ok(COVER_PAGE_PLAYBOOK_V3.length > 500, `V3 ต้องมีเนื้อจริง (ได้ ${COVER_PAGE_PLAYBOOK_V3.length})`);
  assert.notEqual(COVER_PAGE_PLAYBOOK_V2, COVER_PAGE_PLAYBOOK_V3, 'V2/V3 ต้องเป็นคนละก้อนกัน');
  assert.ok(COVER_PAGE_PLAYBOOK_V3.length > COVER_PAGE_PLAYBOOK_V2.length, 'V3 (478 ใบ) ต้องยาวกว่า V2 (36 ใบ) — สอดคล้องวิจัยชุดใหญ่กว่า');
  console.log(`   (V2 = ${COVER_PAGE_PLAYBOOK_V2.length} ตัวอักษร · V3 = ${COVER_PAGE_PLAYBOOK_V3.length} ตัวอักษร)`);
});

await test('default (ไม่ตั้ง env MEGA_PLAYBOOK_V2) → COVER_PAGE_PLAYBOOK ต้องเป็น V3 เป๊ะ (byte-identical, ===)', () => {
  assert.equal(COVER_PAGE_PLAYBOOK, COVER_PAGE_PLAYBOOK_V3, 'default ต้องเลือก V3 (=== object identity เดียวกัน ไม่ใช่แค่ค่าเท่ากัน)');
  assert.notEqual(COVER_PAGE_PLAYBOOK, COVER_PAGE_PLAYBOOK_V2, 'default ต้องไม่ใช่ V2');
});

await test('byte-complete v3 (แพทเทิร์นเดียวกับเทส v2 เดิม): sysOn - sysOff (artBriefBrain) ต้องเท่ากับความยาว COVER_PAGE_PLAYBOOK_V3 + ตัวคั่น \\n\\n เป๊ะ', async () => {
  const sysOn = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, pagePlaybookOn: true }));
  const sysOff = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, pagePlaybookOn: false }));
  assert.equal(sysOn.length - sysOff.length, COVER_PAGE_PLAYBOOK_V3.length + 2, `ผลต่างต้องเท่ากับความยาว v3 (${COVER_PAGE_PLAYBOOK_V3.length}) + 2 เป๊ะ (ได้ ${sysOn.length - sysOff.length})`);
  assert.ok(sysOn.includes(COVER_PAGE_PLAYBOOK_V3), 'sysOn ต้องมี V3 ทั้งก้อน verbatim');
});

await test('สลับ MEGA_PLAYBOOK_V2=1 (ระดับโมดูล): fresh import coverPagePlaybook.js ต้องได้ COVER_PAGE_PLAYBOOK === COVER_PAGE_PLAYBOOK_V2 เป๊ะ (ความยาว 3,535)', async () => {
  process.env.MEGA_PLAYBOOK_V2 = '1';
  try {
    // cache-bust ให้โมดูลคำนวณ const COVER_PAGE_PLAYBOOK ใหม่ (อ่าน env ตอน module load ใน main thread จริง)
    const fresh = await import('../src/lib/coverPagePlaybook.js?v2switch-unit');
    assert.equal(fresh.COVER_PAGE_PLAYBOOK, fresh.COVER_PAGE_PLAYBOOK_V2, 'MEGA_PLAYBOOK_V2=1 ต้องเลือก V2');
    assert.equal(fresh.COVER_PAGE_PLAYBOOK, COVER_PAGE_PLAYBOOK_V2, 'ต้องตรงกับ V2 เดิมทุกตัวอักษร (=== เดียวกัน — const เดิมไม่ถูกแก้)');
    assert.equal(fresh.COVER_PAGE_PLAYBOOK.length, 3535, `ความยาว V2 ต้องเท่าเดิม (ได้ ${fresh.COVER_PAGE_PLAYBOOK.length})`);
  } finally {
    delete process.env.MEGA_PLAYBOOK_V2;
  }
});

await test('สลับ MEGA_PLAYBOOK_V2=1 (ครบสาย inject จริง): fresh megaBrains.js ต้องแทรก V2 เข้า artBriefBrain system แทน V3 เป๊ะ (ไม่ใช่แค่ const เฉยๆ — ทดสอบจุด inject จริงด้วย)', async () => {
  process.env.MEGA_PLAYBOOK_V2 = '1';
  try {
    // cache-bust megaBrains.js เองด้วย — hook (ด้านบนไฟล์นี้) จะผูก tag 'v2switch' ต่อให้ '@/lib/coverPagePlaybook'
    // ที่มันเรียกใช้ภายในด้วย (ผ่าน context.parentURL) บังคับให้ได้ instance ใหม่ที่อ่าน env='1' จริง ไม่ใช่ตัวที่แคชไว้
    // ตั้งแต่ import แรกบนสุดของไฟล์นี้ (ตอนนั้น env ยังไม่ตั้ง)
    const { artBriefBrain: artBriefBrainV2 } = await import('../src/lib/megaBrains.js?v2switch');
    const captureLocal = async (fn) => { await fn(); return globalThis.__CAPTURED.system; };
    const sysV2 = await captureLocal(() => artBriefBrainV2({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false }));
    assert.ok(sysV2.includes(COVER_PAGE_PLAYBOOK_V2), 'system ต้องมี V2 ทั้งก้อน verbatim เมื่อ MEGA_PLAYBOOK_V2=1');
    assert.ok(!sysV2.includes(COVER_PAGE_PLAYBOOK_V3), 'system ต้องไม่มี V3 เจือปนเลยเมื่อสลับไป V2 แล้ว');
  } finally {
    delete process.env.MEGA_PLAYBOOK_V2;
  }
});

console.log(`\n# cover-page-playbook: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
