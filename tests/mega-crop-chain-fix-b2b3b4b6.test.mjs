// ============================================================
// 🩹 เฟส B-1 (29 ก.ค. 69 — AUDIT-SELECTION-COMPOSE.md): B2 (head-safe ดันกลับทับลายน้ำ) + B3 (circle-avoid รันก่อน
//   ด่านขยับอื่น) + B4 (cropTrace วัดพิกัดเก่า) + B6/Latent (_circleZone/_vis ค้างข้ามงาน)
// ------------------------------------------------------------
// kill-switch เดียวคุมทั้งชุด: MEGA_CROP_CHAIN_FIX ('0' = พฤติกรรมเดิมทุก byte ทุกจุด)
// B2/B3/B4 พิสูจน์ผ่าน coverExecutorService.executeCover จริง (สร้างภาพ noise จริงด้วย sharp ไม่ stub การเรนเดอร์)
// B6 พิสูจน์ผ่าน megaComposerService.composeAndVerify จริง (V3_TEMPLATES fallback, refDNA:null) — ตรวจ object
//   เดียวกันที่ export จาก coverExecutorService.js ตรงๆ ว่าไม่มี _circleZone/_vis ค้างข้ามการเรียก 2 ครั้ง
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';
import sharp from 'sharp';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const FACE_DETECTOR_STUB = _mod('export async function batchDetectFaces(){ return new Map(); }');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/services/faceDetector') return { url: ${JSON.stringify(FACE_DETECTOR_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

delete process.env.MEGA_STRICT_RENDER;
delete process.env.MEGA_COVER_TESTER;
process.env.MEGA_SCENE_DEDUP = '0';

const { executeCover, V3_TEMPLATES } = await import('../src/lib/services/coverExecutorService.js');
const { composeAndVerify } = await import('../src/lib/services/megaComposerService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };
const setEnv = (key, v) => { if (v === null || v === undefined) delete process.env[key]; else process.env[key] = v; };

const RECT_SLOT = { id: 'reaction_1', x: 0, y: 0, w: 400, h: 500, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const CIRCLE_SLOT = { id: 'circle', x: 0, y: 0, w: 400, h: 400, zIndex: 4, border: null, borderWidth: 0, shape: 'circle' };
const mkTemplate = (slot) => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [slot] });

async function runExec({ slot, fb, crop = null, metaW = 2000, metaH = 1500 }) {
  const traceSink = [];
  const buf = await sharp({ create: { width: metaW, height: metaH, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).jpeg({ quality: 85 }).toBuffer();
  await executeCover({
    assignments: [{ slotId: slot.id, imageIndex: 0, crop }],
    imageBuffers: [{ buffer: buf }], templateSpec: mkTemplate(slot), faceBoxes: [fb], traceSink,
  });
  return traceSink.find((t) => t.slot === slot.id) || null;
}

// ============================================================
// B2 — head-safe ดันกลับทับลายน้ำที่เพิ่งหลบสำเร็จ
// ------------------------------------------------------------
// ฉากจริง (คาลิเบรตด้วยสคริปต์สำรวจ — ไม่เดา): ช่องไม่มีหน้า (blind-center, full-height ชนขอบบน) + fb.watermarkRegion
//   ครอบโซนบน 20% → dodgeWatermarkPx (กลไกเดิม) หดคงเดิม+เลื่อนลง top=302 (region 958x1198) → ไม่มีหน้าจริงเลย
//   ⇒ head-safe เข้ากิ่ง "blind" (_maxTopPx=imgH*0.12=180) ซึ่ง 180 < 302 → เดิมดันกลับขึ้น 180 (ทับลายน้ำที่เพิ่งหลบ)
// ============================================================
const WM_FB = { x1: 0, y1: 0, x2: 0, y2: 0, watermarkRegion: { x1: 0.1, y1: 0, x2: 0.9, y2: 0.20 } };

await test('B2: default (flag ON) — head-safe ต้องไม่ดันกลับเกินจุดที่ dodgeWatermarkPx เพิ่งหลบไปแล้ว + ติดธง watermarkKept', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const withHeadSafe = await runExec({ slot: { ...RECT_SLOT }, fb: WM_FB });
  const groundTruthNoHeadSafe = await (async () => {
    setEnv('MEGA_HEAD_SAFE', '0');
    const r = await runExec({ slot: { ...RECT_SLOT }, fb: WM_FB });
    setEnv('MEGA_HEAD_SAFE', null);
    return r;
  })();
  assert.ok(withHeadSafe.branch.includes('headsafetop'), `head-safe ต้อง engage (blind branch) ได้ "${withHeadSafe.branch}"`);
  assert.equal(withHeadSafe.region.top, groundTruthNoHeadSafe.region.top, 'region.top ต้องเท่ากับตอนไม่มี head-safe เลย (แปลว่า head-safe ไม่ได้ดันกลับ)');
  assert.equal(withHeadSafe.watermarkKept, true, 'ต้องขึ้นธง watermarkKept (ยอมกันหัวไม่เต็มที่ แทนละเมิดลายน้ำ)');
});

await test('B2: kill-switch=0 — เหมือนพฤติกรรมเดิม (head-safe ดันกลับไม่สนลายน้ำ ไม่มีธง watermarkKept จากกลไกนี้)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', '0');
  const r = await runExec({ slot: { ...RECT_SLOT }, fb: WM_FB });
  assert.ok(r.branch.includes('headsafetop'), 'head-safe ยัง engage เหมือนเดิม');
  assert.ok(!r.watermarkKept, 'flag ปิด: ต้องไม่มีธง watermarkKept จากกลไกใหม่นี้ (พฤติกรรมเดิมก่อนแก้)');
  setEnv('MEGA_CROP_CHAIN_FIX', null);
});

await test('B2 control: ไม่มีข้อมูลลายน้ำเลย (fb=null, blind-center เต็มความสูงชนขอบบนอยู่แล้ว) → เหมือนเดิมทุก byte ไม่ว่า flag เปิดปิด (ไม่ over-trigger cap)', async () => {
  const withFix = await (async () => { setEnv('MEGA_CROP_CHAIN_FIX', null); return runExec({ slot: { ...RECT_SLOT }, fb: null }); })();
  const withoutFix = await (async () => { setEnv('MEGA_CROP_CHAIN_FIX', '0'); const r = await runExec({ slot: { ...RECT_SLOT }, fb: null }); setEnv('MEGA_CROP_CHAIN_FIX', null); return r; })();
  assert.deepEqual(withFix.region, withoutFix.region, 'ไม่มีลายน้ำเลย — ผลต้องเหมือนกันทุก byte ไม่ว่า flag จะเปิดหรือปิด (cap ไม่ควร over-trigger เมื่อไม่มีอะไรให้กัน)');
  assert.ok(!withFix.watermarkKept, 'ไม่มีลายน้ำให้กันเลย — ไม่ควรมีธง watermarkKept');
});

// ============================================================
// B4 — cropTrace.region ต้องสะท้อน region สุดท้ายจริง (ไม่ใช่ snapshot ก่อน dodge/head-safe/clamp)
// ------------------------------------------------------------
// ใช้ฉากเดียวกับ B2 — ตรวจ _tr.region ตรงๆ (ไม่ใช่แค่ธง)
// ============================================================
await test('B4 (rect): default (flag ON) — _tr.region ต้องตรงกับ region สุดท้ายจริง (top=302 ไม่ใช่ 0 ที่ snapshot ไว้ก่อนหน้านี้)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const r = await runExec({ slot: { ...RECT_SLOT }, fb: WM_FB });
  assert.equal(r.region.top, 302, '_tr.region.top ต้องตรงกับค่าจริงหลัง dodge+head-safe-capped (ยืนยันเลขจริงจากสคริปต์สำรวจ)');
  assert.equal(r.region.width, 958);
  assert.equal(r.region.height, 1198);
});

await test('B4 (rect): kill-switch=0 — _tr.region ค้างที่ snapshot แรกสุด (ก่อน dodge/head-safe ทั้งหมด) = พฤติกรรมเดิมก่อนแก้', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', '0');
  const r = await runExec({ slot: { ...RECT_SLOT }, fb: WM_FB });
  assert.equal(r.region.top, 0, '🔴 flag ปิด: _tr.region ต้องค้างที่ค่า snapshot แรก (top=0, ก่อนหลบลายน้ำ) — พิสูจน์ B4 บั๊กเดิมมีจริง');
  assert.equal(r.region.width, 1200, 'width ก็ต้องค้างที่ค่าก่อน dodge เช่นกัน (1200 ไม่ใช่ 958 ที่หดจริง)');
  setEnv('MEGA_CROP_CHAIN_FIX', null);
});

await test('B4 (circle): default (flag ON) — วงกลมก็ต้องได้ _tr.region สุดท้ายจริง (หลัง dodgeWatermarkPx+clamp)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const circleWmFb = { x1: 0, y1: 0, x2: 0, y2: 0, watermarkRegion: { x1: 0.1, y1: 0, x2: 0.9, y2: 0.15 } };
  const withWm = await runExec({ slot: { ...CIRCLE_SLOT }, fb: circleWmFb, crop: { x: 0, y: 0, w: 1, h: 1 } });
  const noWm = await runExec({ slot: { ...CIRCLE_SLOT }, fb: null, crop: { x: 0, y: 0, w: 1, h: 1 } });
  assert.notEqual(withWm.region.top, noWm.region.top, '_tr.region (วงกลม) ต้องเปลี่ยนจริงเมื่อมีลายน้ำ (ไม่ใช่ snapshot นิ่งค้างที่ค่าเดิม)');
});

await test('B4 (circle): kill-switch=0 — _tr.region ค้างที่ snapshot ก่อน dodge เหมือนกัน (พฤติกรรมเดิม)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', '0');
  const circleWmFb = { x1: 0, y1: 0, x2: 0, y2: 0, watermarkRegion: { x1: 0.1, y1: 0, x2: 0.9, y2: 0.15 } };
  const withWm = await runExec({ slot: { ...CIRCLE_SLOT }, fb: circleWmFb, crop: { x: 0, y: 0, w: 1, h: 1 } });
  const noWm = await runExec({ slot: { ...CIRCLE_SLOT }, fb: null, crop: { x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(withWm.region.top, noWm.region.top, 'flag ปิด: _tr.region (วงกลม) ต้องไม่เปลี่ยนตามลายน้ำเลย (ค้างที่ snapshot เดิม — byte-parity)');
  setEnv('MEGA_CROP_CHAIN_FIX', null);
});

// ============================================================
// B3 — circle-avoid (catch-all แรกสุด) ตัดสินก่อนด่านอื่นขยับ region ต่อ → ต้อง recheck หลัง watermark/head-safe
// ------------------------------------------------------------
// ฉากจริง (คาลิเบรตด้วยสคริปต์สำรวจ): zone = บน 20% ของช่อง · หน้าอยู่ relative_y ~0.30-0.53 (พ้นโซนตอน check แรก
//   avoided=true) · slot._watermarkEdge (top,12%) ดัน region ลง 47px → หน้าเลื่อนสัมพัทธ์เข้าโซนอีกครั้ง (relative
//   y1 0.185 < 0.20) — เดิมไม่มีใคร recheck เลย
// ============================================================
await test('B3: default (flag ON) — recheck หลัง watermark-edge จับได้ว่าหน้ากลับเข้าโซนอีกครั้ง → ติดธง circleAvoidNeedsBackup', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const slot = { ...RECT_SLOT, _circleZone: { x0: 0, y0: 0, x1: 1, y1: 0.20 }, _watermarkEdge: { side: 'top', strengthPct: 12 } };
  const fb = { x1: 0.4, y1: 0.08, x2: 0.6, y2: 0.18, allFaces: [{ x1: 0.4, y1: 0.08, x2: 0.6, y2: 0.18 }] };
  const r = await runExec({ slot, fb });
  assert.ok(r.branch.includes('wmedge'), 'ต้องเห็นว่า watermark-edge ทำงานจริง (ดันภูมิภาคลง)');
  assert.equal(r.circleAvoidNeedsBackup, true, '🔴 ต้องจับได้ว่าหน้ากลับเข้าโซนหลังลายน้ำดัน region — ขึ้นธงขอภาพสำรอง');
});

await test('B3: kill-switch=0 — ไม่มี recheck เลย แม้หน้ากลับเข้าโซนจริง (พฤติกรรมเดิมก่อนแก้ — บั๊กมีจริง)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', '0');
  const slot = { ...RECT_SLOT, _circleZone: { x0: 0, y0: 0, x1: 1, y1: 0.20 }, _watermarkEdge: { side: 'top', strengthPct: 12 } };
  const fb = { x1: 0.4, y1: 0.08, x2: 0.6, y2: 0.18, allFaces: [{ x1: 0.4, y1: 0.08, x2: 0.6, y2: 0.18 }] };
  const r = await runExec({ slot, fb });
  assert.ok(r.branch.includes('wmedge'), 'watermark-edge ยัง engage เหมือนเดิม (ไม่เกี่ยวกับ flag นี้)');
  assert.ok(!r.circleAvoidNeedsBackup, '🔴 flag ปิด: ต้องไม่มี recheck เลย — พิสูจน์ว่าบั๊กเดิม (ไม่มีใครจับการกลับเข้าโซน) มีจริง');
  setEnv('MEGA_CROP_CHAIN_FIX', null);
});

await test('B3 control: ไม่มี watermark-edge (ไม่มีอะไรมาเลื่อน region ทีหลัง) → circle-avoid แรกสุดหลบสำเร็จ ไม่ต้อง recheck ก็ไม่มีธงอยู่แล้ว', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  const slot = { ...RECT_SLOT, _circleZone: { x0: 0, y0: 0, x1: 1, y1: 0.20 } }; // ไม่มี _watermarkEdge
  const fb = { x1: 0.4, y1: 0.08, x2: 0.6, y2: 0.18, allFaces: [{ x1: 0.4, y1: 0.08, x2: 0.6, y2: 0.18 }] };
  const r = await runExec({ slot, fb });
  assert.ok(!r.branch.includes('wmedge'));
  assert.ok(!r.circleAvoidNeedsBackup, 'ไม่มีอะไรเลื่อน region ทีหลังเลย — ไม่ควรมีธงตั้งแต่แรก');
});

// ============================================================
// B6/Latent — _circleZone/_vis เขียนลง V3_TEMPLATES (object ระดับโมดูล ไม่ clone) ไม่มี else delete → ค้างข้ามงาน
// ------------------------------------------------------------
// เรียก composeAndVerify(refDNA:null) 2 ครั้งติดกัน (บังคับ V3_TEMPLATES fallback) — ปลอมค่า _circleZone/_vis
// ค้างไว้บน slot object ของเทมเพลตที่ระบบเลือกจริง (อ่านจาก out.template) แล้วเรียกซ้ำ ตรวจว่าค่าปลอมถูกล้างไหม
// (V3_TEMPLATES ทุกใบวงกลมทับแค่ฮีโร่ตามข้อเท็จจริงที่ยืนยันแล้วในคลังเทส — ช่องอื่นได้ zone=null เสมอบนสายนี้
// ⇒ กิ่ง else ทำงานทุกครั้งที่ผ่านโค้ดนี้ ใช้พิสูจน์ else-delete ได้ตรงๆ โดยไม่ต้องพึ่งเรขาคณิตพิเศษ)
// ============================================================
async function makeDataUri(seed) {
  const buf = await sharp({ create: { width: 800, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128 + seed, sigma: 40 } } }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
async function buildSlotPlan() {
  const urls = await Promise.all([0, 1, 2, 3].map((i) => makeDataUri(i * 10)));
  return urls.map((url, i) => ({ url, thumbnailUrl: '', isHero: i === 0, person: null, clean: true, newsScene: true, faces: 0, slot: null }));
}

await test('B6: default (flag ON) — _circleZone/_vis ปลอมที่ค้างบน V3_TEMPLATES slot object ต้องถูกล้างหลังเรียก composeAndVerify ครั้งถัดไป', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', null);
  setEnv('MEGA_CIRCLE_AVOID', null); setEnv('MEGA_CIRCLE_AVOID_CROP', null); // ต้องเปิด (default) ให้โค้ด _circleZone ทำงานถึงจะมีจุดให้ else ทำงาน
  const slotPlan = await buildSlotPlan();
  const out1 = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(out1.success, true, `รอบแรกต้องสำเร็จ (error: ${out1.error || '-'})`);
  const tpl = V3_TEMPLATES[out1.template];
  assert.ok(tpl, `ต้องหาเทมเพลต V3_TEMPLATES.${out1.template} เจอ (fallback path)`);
  const targetSlot = tpl.slots.find((s) => s.shape !== 'circle' && !/main|hero/i.test(String(s.id)));
  assert.ok(targetSlot, 'ต้องมีช่องรอง (ไม่ใช่ hero/circle) ในเทมเพลตนี้');
  // ปลอมค่าค้างจาก "งานก่อนหน้า" ไว้บน object เดียวกับที่ระบบจะใช้จริงรอบถัดไป
  targetSlot._circleZone = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
  targetSlot._vis = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
  const slotPlan2 = await buildSlotPlan();
  const out2 = await composeAndVerify({ newsTitle: 'x2', slotPlan: slotPlan2, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(out2.success, true, `รอบสองต้องสำเร็จ (error: ${out2.error || '-'})`);
  assert.ok(!('_circleZone' in targetSlot), '🔴 หัวใจ B6: _circleZone ปลอมที่ค้างจากงานก่อนต้องถูกลบทิ้ง (V3_TEMPLATES วงทับแค่ฮีโร่เสมอ ⇒ ช่องนี้ต้องได้ zone=null ทุกรอบ)');
  assert.ok(!('_vis' in targetSlot), '🔴 _vis ปลอมที่ค้างจากงานก่อนต้องถูกลบทิ้งด้วยเช่นกัน');
});

await test('B6: kill-switch=0 — _circleZone/_vis ปลอมยังค้างอยู่ (ไม่มี else delete — พฤติกรรมเดิมก่อนแก้)', async () => {
  setEnv('MEGA_CROP_CHAIN_FIX', '0');
  setEnv('MEGA_CIRCLE_AVOID', null); setEnv('MEGA_CIRCLE_AVOID_CROP', null);
  const slotPlan = await buildSlotPlan();
  const out1 = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(out1.success, true);
  const tpl = V3_TEMPLATES[out1.template];
  const targetSlot = tpl.slots.find((s) => s.shape !== 'circle' && !/main|hero/i.test(String(s.id)));
  targetSlot._circleZone = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
  targetSlot._vis = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
  const slotPlan2 = await buildSlotPlan();
  const out2 = await composeAndVerify({ newsTitle: 'x2', slotPlan: slotPlan2, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(out2.success, true);
  assert.deepEqual(targetSlot._circleZone, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, '🔴 flag ปิด: _circleZone ปลอมต้องยังค้างอยู่เป๊ะ — พิสูจน์บั๊กเดิม (ไม่มี else delete) มีจริง');
  assert.deepEqual(targetSlot._vis, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, 'flag ปิด: _vis ปลอมก็ต้องยังค้างอยู่เช่นกัน');
  delete targetSlot._circleZone; delete targetSlot._vis; // ล้างมือ ไม่ให้เทสอื่นในไฟล์ปนเปื้อน
  setEnv('MEGA_CROP_CHAIN_FIX', null);
});

console.log(`\n# mega-crop-chain-fix-b2b3b4b6: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
