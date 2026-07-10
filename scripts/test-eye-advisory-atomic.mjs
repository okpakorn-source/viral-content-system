// ============================================================
// 👁️⚛️ EYE ADVISORY ATOMIC — regression harness (Codex hotfix รอบ 2, 11 ก.ค.)
// ------------------------------------------------------------
// ทุกเทสเรียก transaction seam ตัวเดียวกับ production (_runEyeFixTransaction) —
// ไม่จำลอง orchestration เอง · renderCover ฉีดเฉพาะในเทสเพื่อเลี่ยง sharp/render จริง
// stub 'sharp' + '@/lib/ai/openai' เป็นระเบิด (ถูกแตะ = fail ดัง) = พิสูจน์ no network/LLM/sharp
// ข้อพิสูจน์ตามคำสั่ง Codex รอบ 2:
//   1) worsening regression → คืนครบ 6 state + container/object identities
//   2) renderer ล้าง traceSink แล้ว throw → rollback ครบ
//   3) non-regressing keep
//   4) single swap: ปล่อย old / จอง new
//   5) two swaps ใต้ REQC=0: ลำดับ candidate เท่า legacy · ไม่ reuse old index · used = ownership จริง
//   6) OFF path สำเร็จ: ไม่มี Eye QC marker ใหม่
//   7) zero applied fixes: ไม่เรียก render
//   8) source guard: composeAndVerify เรียก seam หลัง FinalCrop ด้วย buffer/cropTrace local
//   9) deterministic
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const BOMB = (name) => `data:text/javascript,${encodeURIComponent(
  `export default function(){throw new Error('${name}_FORBIDDEN')}; export function callAI(){throw new Error('${name}_FORBIDDEN')}`
)}`;
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(BOMB('SHARP'))}, shortCircuit: true };
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(BOMB('LLM'))}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const svc = await import('../src/lib/services/megaComposerService.js');
const { _runEyeFixTransaction } = svc;
assert.equal(typeof _runEyeFixTransaction, 'function', 'transaction seam ต้องถูก export');
// seam ต้องมีตัวเดียว — helper ย่อยห้ามหลุด export (คำสั่ง Codex รอบ 2)
for (const hidden of ['applyEyeFixes', '_eyeSnapshotBaseline', '_eyeTouchedSlots', '_eyeRegressionOf', '_eyeRestoreBaseline', '_eyeReqcEnabled', '_eyeTxSnapshot', '_eyeTxRestore', '_eyeTxTouched']) {
  assert.equal(svc[hidden], undefined, `${hidden} ต้องเป็น private`);
}

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };

// ── fixtures: โลกจำลองรูปทรง core จริงของ composeAndVerify (spec ไม่ใช้เมื่อฉีด renderCover) ──
const FB = (cx = 0.5, cy = 0.4) => ({ x1: cx - 0.1, y1: cy - 0.1, x2: cx + 0.1, y2: cy + 0.1 });
const mkCore = () => ({
  assignments: [
    { slotId: 'main', imageIndex: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, why: 'hero' },
    { slotId: 'context_1', imageIndex: 1, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, why: 'ctx' },
    { slotId: 'circle', imageIndex: 2, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, why: 'circ' },
  ],
  used: new Set([0, 1, 2]),
  qcFlags: ['upscaled:context_1:1.30'],
  traceSink: [
    { slot: 'main', branch: 'base', region: { x: 1, y: 2 }, tighten: { share: 0.4 } },
    { slot: 'context_1', branch: 'base' },
  ],
  loaded: [
    { person: 'HERO', clean: true, url: 'u0' },
    { person: 'B', clean: true, url: 'u1' },
    { person: 'C', clean: true, url: 'u2' },
    { person: 'D', clean: true, url: 'u3' },
    { person: 'E', clean: true, url: 'u4' },
  ],
  faceBoxes: [FB(), FB(), FB(), FB(0.6, 0.5), FB(0.4, 0.5)],
  spec: null,
});
const FIXES = [
  { slot: 'context_1', action: 'shift_up' },
  { slot: 'circle', action: 'swap' },
];
const BASE_TRACE = () => [{ slot: 'main', branch: 'base', region: { x: 9 }, tighten: { share: 0.5 } }];
// renderCover จำลองสัญญาจริงของ executeCover (reset sink แล้วเขียน trace รอบใหม่) — ไม่ render จริง
const regressRender = (core, calls = { n: 0 }) => async () => {
  calls.n++;
  core.traceSink.length = 0;
  core.traceSink.push({ slot: 'context_1', branch: 'noface-top55' }); // → blind_crop ใหม่ในช่องที่ตาแตะ
  return Buffer.from('post-regress');
};
const okRender = (core, calls = { n: 0 }) => async () => {
  calls.n++;
  core.traceSink.length = 0;
  core.traceSink.push({ slot: 'context_1', branch: 'face', upscale: 1.25 }); // 1.30→1.25 = ไม่แย่ลง
  return Buffer.from('post-ok');
};
const grabIdentities = (core) => ({
  arr: core.assignments,
  objs: [...core.assignments],
  used: core.used,
  sink: core.traceSink,
  flags: core.qcFlags,
  values: JSON.parse(JSON.stringify(core.assignments)),
  usedItems: [...core.used].sort(),
  sinkItems: JSON.parse(JSON.stringify(core.traceSink)),
  flagItems: [...core.qcFlags],
});
const assertRestored = (core, id, res, buffer0, cropTrace0, reason) => {
  assert.equal(core.assignments, id.arr, 'assignments ต้องเป็น array เดิม');
  core.assignments.forEach((a, i) => assert.equal(a, id.objs[i], `assignment[${i}] ต้องเป็น object ตัวเดิม in-place`));
  assert.deepEqual(JSON.parse(JSON.stringify(core.assignments)), id.values, 'ค่า assignments กลับ baseline');
  assert.equal(core.used, id.used, 'used ต้องเป็น Set เดิม');
  assert.deepEqual([...core.used].sort(), id.usedItems, 'สมาชิก used กลับ baseline');
  assert.equal(core.traceSink, id.sink, 'traceSink ต้องเป็น array เดิม');
  assert.deepEqual(core.traceSink, id.sinkItems, 'เนื้อหา traceSink กลับ baseline');
  assert.equal(core.qcFlags, id.flags, 'qcFlags ต้องเป็น array เดิม (in-place)');
  assert.deepEqual(core.qcFlags, [...id.flagItems, `eye_fix_reverted:${reason}`], 'flags = baseline + revert marker เดียว');
  assert.equal(core.qcFlags.filter((f) => String(f).startsWith('eye_fix_reverted:')).length, 1, 'marker ต้องมีใบเดียวเป๊ะ');
  assert.equal(res.buffer, buffer0, 'buffer = ใบ baseline ตัวเดิม (reference)');
  assert.deepEqual(res.cropTrace, cropTrace0, 'cropTrace = ค่า baseline local (รวม nested)');
  assert.notEqual(res.cropTrace[0], cropTrace0[0], 'nested trace ต้องเป็น deep-clone ไม่ใช่ alias');
  assert.equal(res.fixedCount, 0);
};

delete process.env.MEGA_EYE_REQC; // default: gate เปิด

await test('1) worsening regression: revert คืนครบ 6 state + ทุก container/object identity เดิม', async () => {
  const core = mkCore();
  const id = grabIdentities(core);
  const buffer0 = Buffer.from('pre');
  const cropTrace0 = BASE_TRACE();
  const res = await _runEyeFixTransaction({ core, fixes: FIXES, buffer: buffer0, cropTrace: cropTrace0, renderCover: regressRender(core) });
  assertRestored(core, id, res, buffer0, cropTrace0, 'blind_crop_new:context_1');
  // manifest/placed อนุมานจาก assignments → source กลับเดิม (pixel/metadata lockstep)
  const placed = core.assignments.map((a) => ({ slot: a.slotId, url: core.loaded[a.imageIndex].url }));
  assert.deepEqual(placed, [
    { slot: 'main', url: 'u0' },
    { slot: 'context_1', url: 'u1' },
    { slot: 'circle', url: 'u2' },
  ]);
});

await test('2) renderer ล้าง traceSink แล้ว throw: rollback ครบชุด + reason=exception deterministic', async () => {
  const core = mkCore();
  const id = grabIdentities(core);
  const buffer0 = Buffer.from('pre');
  const cropTrace0 = BASE_TRACE();
  const res = await _runEyeFixTransaction({
    core, fixes: FIXES, buffer: buffer0, cropTrace: cropTrace0,
    renderCover: async () => {
      core.traceSink.length = 0; // executor reset แล้วเขียนครึ่งเดียว
      core.traceSink.push({ slot: 'context_1', branch: 'partial' });
      throw new Error('render died mid-way');
    },
  });
  assertRestored(core, id, res, buffer0, cropTrace0, 'exception');
});

await test('3) non-regressing keep: ไม่ restore · fixed state คงอยู่ · marker kept/unverified ครบ (gate เปิด)', async () => {
  const core = mkCore();
  const flagsRefBefore = core.qcFlags;
  const buffer0 = Buffer.from('pre');
  const res = await _runEyeFixTransaction({ core, fixes: FIXES, buffer: buffer0, cropTrace: BASE_TRACE(), renderCover: okRender(core) });
  assert.equal(res.fixedCount, 2, 'shift + swap = 2 fix คงอยู่');
  assert.notEqual(res.buffer, buffer0, 'buffer = ใบ post-fix ไม่ใช่ baseline');
  assert.equal(core.assignments.find((a) => a.slotId === 'circle').imageIndex, 3, 'swap คงอยู่');
  assert.deepEqual([...core.used].sort(), [0, 1, 3], 'used = ownership หลัง swap');
  assert.deepEqual(core.qcFlags, ['upscale_soft:context_1:1.25', 'eye_fix_kept', 'person_cut_unverified'], 'ธงสะท้อนใบสุดท้าย + marker kept');
  assert.notEqual(core.qcFlags, flagsRefBefore, 'keep path แทนที่ qcFlags ตาม flow เดิม (พฤติกรรม HEAD คงไว้)');
  assert.deepEqual(res.cropTrace, [{ slot: 'context_1', branch: 'face', upscale: 1.25 }], 'cropTrace = trace รอบ post-fix');
});

await test('4) single swap: ปล่อย index เก่า + จองใหม่ · เหลือแต่คนซ้ำ hero = ไม่ swap · main โดนสั่ง = เมิน', async () => {
  const core = mkCore();
  const res = await _runEyeFixTransaction({ core, fixes: [{ slot: 'circle', action: 'swap' }], buffer: Buffer.from('pre'), cropTrace: [], renderCover: okRender(core) });
  assert.equal(res.fixedCount, 1);
  assert.equal(core.assignments.find((a) => a.slotId === 'circle').imageIndex, 3);
  assert.ok(core.used.has(3), 'index ใหม่ถูกจอง');
  assert.ok(!core.used.has(2), 'index เก่าถูกปล่อย (บั๊กเดิมค้างตลอดงาน)');
  assert.deepEqual([...core.used].sort(), [0, 1, 3], 'used = ownership ของ assignments เป๊ะ');
  // เหลือเฉพาะคนซ้ำ hero → ห้าม swap และห้ามปล่อยของเดิม
  const core2 = mkCore();
  core2.loaded[3].person = 'HERO';
  core2.loaded[4].person = 'HERO';
  const calls2 = { n: 0 };
  const res2 = await _runEyeFixTransaction({ core: core2, fixes: [{ slot: 'circle', action: 'swap' }], buffer: Buffer.from('pre'), cropTrace: [], renderCover: okRender(core2, calls2) });
  assert.equal(res2.fixedCount, 0);
  assert.equal(calls2.n, 0, '0 fix = ห้าม render');
  assert.ok(core2.used.has(2), 'ไม่ swap = ไม่ปล่อยของเดิม');
  // main ห้ามโดนคำสั่งตา
  const core3 = mkCore();
  const res3 = await _runEyeFixTransaction({ core: core3, fixes: [{ slot: 'main', action: 'swap' }], buffer: Buffer.from('pre'), cropTrace: [], renderCover: okRender(core3) });
  assert.equal(res3.fixedCount, 0);
  assert.equal(core3.assignments[0].imageIndex, 0);
});

await test('5) two swaps ใต้ REQC=0: ลำดับ candidate เท่า legacy · ไม่ reuse old index · used สุดท้าย = ownership', async () => {
  const prev = process.env.MEGA_EYE_REQC;
  try {
    process.env.MEGA_EYE_REQC = '0';
    const core = mkCore();
    const res = await _runEyeFixTransaction({
      core,
      fixes: [{ slot: 'context_1', action: 'swap' }, { slot: 'circle', action: 'swap' }],
      buffer: Buffer.from('pre'), cropTrace: [], renderCover: okRender(core),
    });
    assert.equal(res.fixedCount, 2);
    const ctx = core.assignments.find((a) => a.slotId === 'context_1');
    const cir = core.assignments.find((a) => a.slotId === 'circle');
    // legacy order (HEAD ไม่เคยปล่อย old): context ได้ 3, circle ได้ 4 — ต้องตรงเป๊ะ
    assert.equal(ctx.imageIndex, 3, 'context_1 ต้องได้ candidate ตัวแรกตามลำดับ legacy');
    assert.equal(cir.imageIndex, 4, 'circle ต้องได้ตัวถัดไปตาม legacy');
    assert.notEqual(cir.imageIndex, 1, '🔴 ห้าม reuse index เก่าของช่องก่อนหน้า (P0-A: old ยัง reserved ตลอด call)');
    assert.deepEqual([...core.used].sort(), [0, 3, 4], 'used สุดท้าย = ownership จริง (0,3,4) ไม่ใช่ legacy stale (0..4)');
  } finally {
    if (prev === undefined) delete process.env.MEGA_EYE_REQC; else process.env.MEGA_EYE_REQC = prev;
  }
});

await test('6) OFF path (REQC=0) สำเร็จ: apply+render ครั้งเดียว · fixedCount คงอยู่ · ไม่มี Eye QC marker ใหม่', async () => {
  const prev = process.env.MEGA_EYE_REQC;
  try {
    process.env.MEGA_EYE_REQC = '0';
    const core = mkCore();
    const calls = { n: 0 };
    const res = await _runEyeFixTransaction({ core, fixes: FIXES, buffer: Buffer.from('pre'), cropTrace: BASE_TRACE(), renderCover: okRender(core, calls) });
    assert.equal(calls.n, 1, 'render ครั้งเดียวเป๊ะ');
    assert.equal(res.fixedCount, 2, 'fixedCount คงอยู่');
    assert.deepEqual(core.qcFlags, ['upscale_soft:context_1:1.25'], 'ไม่มี eye_fix_kept/person_cut_unverified/eye_fix_reverted');
    // regression compare ถูกข้ามจริง: render ที่แย่ลงก็ยังรับ (พฤติกรรมเดิมของ switch ปิด)
    const coreR = mkCore();
    const resR = await _runEyeFixTransaction({ core: coreR, fixes: FIXES, buffer: Buffer.from('pre'), cropTrace: [], renderCover: regressRender(coreR) });
    assert.equal(resR.fixedCount, 2, 'แย่ลงแค่ไหนก็รับเมื่อ gate ปิด');
    assert.deepEqual(coreR.qcFlags, ['blind_crop:context_1'], 'ธงสะท้อนใบจริง แต่ไม่มี marker ตัดสิน');
  } finally {
    if (prev === undefined) delete process.env.MEGA_EYE_REQC; else process.env.MEGA_EYE_REQC = prev;
  }
});

await test('7) zero applied fixes: ไม่เรียก render · buffer/cropTrace identity เดิม · state ไม่ขยับ', async () => {
  const core = mkCore();
  const id = grabIdentities(core);
  const buffer0 = Buffer.from('pre');
  const cropTrace0 = BASE_TRACE();
  const calls = { n: 0 };
  const res = await _runEyeFixTransaction({ core, fixes: [{ slot: 'main', action: 'swap' }, { slot: 'ghost', action: 'zoom_in' }], buffer: buffer0, cropTrace: cropTrace0, renderCover: okRender(core, calls) });
  assert.equal(calls.n, 0, 'ห้ามแตะ render');
  assert.equal(res.fixedCount, 0);
  assert.equal(res.buffer, buffer0, 'buffer ตัวเดิมส่งผ่าน (identity)');
  assert.equal(res.cropTrace, cropTrace0, 'cropTrace ตัวเดิมส่งผ่าน (identity)');
  assert.deepEqual(JSON.parse(JSON.stringify(core.assignments)), id.values, 'assignments ไม่ขยับ');
  assert.deepEqual([...core.used].sort(), id.usedItems);
  assert.deepEqual(core.qcFlags, id.flagItems, 'ไม่มี marker ใดๆ');
});

await test('8) source guard: composeAndVerify เรียก transaction seam หลัง FinalCrop ด้วย local buffer/cropTrace', async () => {
  const src = readFileSync(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');
  const iCompose = src.indexOf('export async function composeAndVerify');
  const iHeroKept = src.indexOf("'hero_ref_recrop_kept'");
  const call = '_runEyeFixTransaction({ core, fixes: eye.fixes, buffer, cropTrace })';
  const iTx = src.indexOf(call);
  assert.ok(iCompose > 0 && iHeroKept > iCompose, 'โครง composeAndVerify/FinalCrop ต้องอยู่');
  assert.ok(iTx > iHeroKept, 'transaction ต้องถูกเรียก "หลัง" บล็อก Hero FinalCrop (ใช้ buffer/cropTrace ที่อัปเดตแล้ว)');
  assert.ok(!src.slice(iTx, iTx + call.length + 40).includes('renderCover'), 'production ห้ามฉีด renderCover');
  const tail = src.slice(iTx, iTx + 400);
  for (const line of ['buffer = _tx.buffer', 'cropTrace = _tx.cropTrace', 'fixedCount = _tx.fixedCount']) {
    assert.ok(tail.includes(line), `ผลธุรกรรมต้องถูก assign กลับ: ${line}`);
  }
  assert.equal((src.match(/await _runEyeFixTransaction\(\{/g) || []).length, 1, 'callsite production มีจุดเดียว (ไม่นับบรรทัด definition)');
});

await test('9) deterministic: โลกเดิม 2 รอบ → ผลลัพธ์+state byte-identical', async () => {
  const runOnce = async () => {
    const core = mkCore();
    const res = await _runEyeFixTransaction({ core, fixes: FIXES, buffer: Buffer.from('pre'), cropTrace: BASE_TRACE(), renderCover: regressRender(core) });
    return JSON.stringify({ fixedCount: res.fixedCount, cropTrace: res.cropTrace, assignments: core.assignments, used: [...core.used].sort(), qcFlags: core.qcFlags, sink: core.traceSink });
  };
  assert.equal(await runOnce(), await runOnce());
});

console.log(`1..${passed}`);
