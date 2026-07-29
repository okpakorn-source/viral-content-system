// ============================================================
// 🗜️ MEGA_SLOT_COLLAPSE (เฟส B-2, ข้อ 3, 29 ก.ค. 69 — เคสจริง AC-0210/MCV-ms5wwdv2sy2) — megaComposerService.js
// ------------------------------------------------------------
// "ไม่มีตัวแทน = ยุบ ไม่ใช่ปล่อยผ่าน": ช่องที่ตาสอง S6 (megaAdapters.js) หา backup ไม่เจอเลย ยังพกธง
// _secondEyeSubSlotFlag/_secondEyeWatermarkFlag ค้างอยู่บนภาพที่ใช้จริง (แม้ BS ด้านบนลองสลับสำรองแล้วก็ตาม)
// → ลองขยายเพื่อนบ้านเรขาคณิตง่าย (ชนขอบเป๊ะ แนวแกนเดียวกัน ไม่ใช่ hero/circle) ให้เต็มพื้นที่ + ลบช่องเสียทิ้ง
// → เทียบธง qc ก่อน/หลัง รับเมื่อไม่แย่ลง ไม่งั้นคืนของเดิมทุก byte (แพทเทิร์นเดียวกับ BS เป๊ะ)
//
// ★ ตรวจซ้ำ (Opus 29 ก.ค. 69): เกณฑ์รับผลรุ่นแรก เทียบ traceQcFlags "ทั้งเฟรม" ก่อน/หลัง — ธงของช่องอื่นที่ไม่
//   เกี่ยวกับการยุบเลยถูกนับปนทั้งสองฝั่ง (หักล้างกันพอดี ไม่เป็นปัญหา) แต่ "ธง S6 เดิมที่หายไปจริง" (subslot_no_face
//   ฯลฯ) ไม่เคยถูกนับเป็นเครดิตเลย (traceQcFlags ไม่รู้จักธงตระกูลนี้) → เพื่อนบ้านที่ไม่มีหน้าสมบูรณ์แบบเจอปัญหา
//   render ใหม่แม้จุดเดียว (เช่น blind_crop) ก็ถูกปฏิเสธเสมอ ทั้งที่เป็นการแลกที่คุ้ม — แก้แล้ว (ดู
//   megaComposerService.js ใกล้ MEGA_SLOT_COLLAPSE): เทียบเฉพาะธงของ {flagSlot เดิม, neighbor} จาก 2 รอบ +
//   เครดิต +1 ให้การล้างธง S6 เดิมเสมอ (หายแน่นอนเมื่อช่องถูกลบจริง)
//
// Part A: helper ล้วน (_findCollapseNeighborSlot/_unionRectXY/_slotCollapseOn) — export ตรงมาเทส pure ไม่ต้องเรนเดอร์จริง
// Part B: E2E จริงผ่าน composeAndVerify (ไม่ mock network — ภาพ noise จริงผ่าน sharp, faceDetector stub ให้คุมได้)
//   D1 พิสูจน์ "สาย revert" ทำงานจริง (เพื่อนบ้านไร้หน้า+ภาพเล็ก → เกิด blind_crop+upscale_soft 2 ธงใหม่ มากกว่า
//   เครดิต 1 ธงที่หาย → ปฏิเสธถูกต้อง คืนของเดิมทุก byte) · D1b พิสูจน์ "accept จริง" ผ่านฟังก์ชันจริงเช่นกัน
//   (เพื่อนบ้านภาพใหญ่ขึ้น → เหลือแค่ blind_crop 1 ธงใหม่ เท่ากับเครดิต 1 ที่ได้ → รับผล ยุบสำเร็จจริง)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

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

const { composeAndVerify, _findCollapseNeighborSlot, _unionRectXY, _slotCollapseOn } = await import('../src/lib/services/megaComposerService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };
const setEnv = (key, v) => { if (v === null || v === undefined) delete process.env[key]; else process.env[key] = v; };

// ═══════════════════════════ Part A: helper ล้วน ═══════════════════════════

const RIGHT_TOP = { id: 'right_top', x: 616, y: 0, w: 464, h: 540 };
const RIGHT_BOTTOM = { id: 'right_bottom', x: 616, y: 540, w: 464, h: 810 };
const MAIN = { id: 'main', x: 0, y: 0, w: 616, h: 1350 };
const CIRCLE = { id: 'circle', shape: 'circle', x: 34, y: 940, w: 380, h: 380 };
const SLOTS = [MAIN, RIGHT_TOP, RIGHT_BOTTOM, CIRCLE];

await test('A1: right_top ชนขอบล่างพอดีกับ right_bottom (แนวตั้ง คอลัมน์เดียวกัน) → เจอเพื่อนบ้าน', () => {
  const n = _findCollapseNeighborSlot(RIGHT_TOP, SLOTS);
  assert.equal(n?.id, 'right_bottom');
});

await test('A2: right_bottom ก็เจอ right_top กลับกัน (สมมาตร)', () => {
  const n = _findCollapseNeighborSlot(RIGHT_BOTTOM, SLOTS);
  assert.equal(n?.id, 'right_top');
});

await test('A3: เพื่อนบ้านแนวนอน (ชิดกันซ้าย-ขวา แถวเดียวกัน สูงเท่ากัน) ก็หาเจอ', () => {
  const left = { id: 'left', x: 0, y: 0, w: 400, h: 500 };
  const right = { id: 'right', x: 400, y: 0, w: 400, h: 500 };
  assert.equal(_findCollapseNeighborSlot(left, [left, right])?.id, 'right');
  assert.equal(_findCollapseNeighborSlot(right, [left, right])?.id, 'left');
});

await test('A4: main/hero (regex main|hero) ไม่ถูกเสนอเป็น flagSlot หรือเพื่อนบ้านเลย', () => {
  assert.equal(_findCollapseNeighborSlot(MAIN, SLOTS), null, 'main ห้ามเป็น flagSlot');
  const near = { id: 'near', x: 616, y: -540, w: 464, h: 540 }; // ชนขอบบน right_top พอดี แต่ตัวเองชื่อ 'hero_extra'
  const heroNamed = { id: 'hero_extra', x: 616, y: -540, w: 464, h: 540 };
  assert.equal(_findCollapseNeighborSlot(RIGHT_TOP, [RIGHT_TOP, heroNamed])?.id, undefined, 'ห้ามเลือกช่องชื่อมี hero เป็นเพื่อนบ้าน');
});

await test('A5: circle ไม่ถูกเสนอเป็น flagSlot หรือเพื่อนบ้านเลย (เรขาคณิตทับซ้อน ซับซ้อนเกินไป)', () => {
  assert.equal(_findCollapseNeighborSlot(CIRCLE, SLOTS), null, 'circle ห้ามเป็น flagSlot');
  const rectNextToCircleOnly = [RIGHT_TOP, CIRCLE];
  assert.equal(_findCollapseNeighborSlot(RIGHT_TOP, rectNextToCircleOnly), null, 'มีแค่ circle ให้เลือก = ไม่มีเพื่อนบ้านที่ใช้ได้');
});

await test('A6: ไม่มีเพื่อนบ้านชนขอบเป๊ะเลย (ห่างกัน/ไม่ตรงมิติ) → null', () => {
  const far = { id: 'far', x: 900, y: 900, w: 100, h: 100 };
  assert.equal(_findCollapseNeighborSlot(RIGHT_TOP, [RIGHT_TOP, far]), null);
});

await test('A7: EPS (±2px) ยอมรับคลาดเคลื่อนเล็กน้อยจากการปัดเศษ แต่เกิน EPS ต้องไม่นับ', () => {
  const almostTouch = { id: 'rb2', x: 616, y: 541.5, w: 464, h: 810 }; // ห่าง 1.5px (<=EPS)
  assert.equal(_findCollapseNeighborSlot(RIGHT_TOP, [RIGHT_TOP, almostTouch])?.id, 'rb2', 'คลาดเคลื่อน 1.5px ยังนับว่าชนขอบ');
  const gapTooBig = { id: 'rb3', x: 616, y: 545, w: 464, h: 810 }; // ห่าง 5px (>EPS)
  assert.equal(_findCollapseNeighborSlot(RIGHT_TOP, [RIGHT_TOP, gapTooBig]), null, 'ห่างเกิน EPS ต้องไม่นับว่าชนขอบ');
});

await test('B1 (union): สองช่องชนขอบแนวตั้ง → กรอบรวมพอดี (ไม่มีช่องว่าง ไม่ล้นเกิน)', () => {
  const u = _unionRectXY(RIGHT_TOP, RIGHT_BOTTOM);
  assert.deepEqual(u, { x: 616, y: 0, w: 464, h: 1350 }, 'รวม right_top+right_bottom ต้องได้เต็มความสูงขวาพอดี (1350 = ผืนเต็ม)');
});

await test('B2 (union): สลับลำดับ argument ต้องได้ผลเดียวกัน (commutative)', () => {
  const u1 = _unionRectXY(RIGHT_TOP, RIGHT_BOTTOM);
  const u2 = _unionRectXY(RIGHT_BOTTOM, RIGHT_TOP);
  assert.deepEqual(u1, u2);
});

await test('C1 (kill-switch): _slotCollapseOn() default true (ไม่ตั้ง env)', () => {
  setEnv('MEGA_SLOT_COLLAPSE', null);
  assert.equal(_slotCollapseOn(), true);
});

await test('C2 (kill-switch): _slotCollapseOn() = false เมื่อ MEGA_SLOT_COLLAPSE="0"', () => {
  setEnv('MEGA_SLOT_COLLAPSE', '0');
  assert.equal(_slotCollapseOn(), false);
  setEnv('MEGA_SLOT_COLLAPSE', null);
});

await test('C3 (kill-switch): ค่าอื่นที่ไม่ใช่ "0" (เช่น "1"/undefined ที่ตั้งเป็น string อื่น) ยังคงเปิด', () => {
  setEnv('MEGA_SLOT_COLLAPSE', '1');
  assert.equal(_slotCollapseOn(), true);
  setEnv('MEGA_SLOT_COLLAPSE', null);
});

// ═══════════════════════════ Part B: E2E จริงผ่าน composeAndVerify ═══════════════════════════
// fixture: 4 ภาพ noise จริง (ไร้หน้าทั้งชุด — faceDetector stub คืน Map ว่างเสมอ) เข้า vt_ref_5x4 (auto-pick
// เพราะ refDNA=null + 4 รูปพอดี 4 ช่อง) · index0=hero(isHero) · index1=throwaway(circle แย่งไปเสมอเพราะไร้ป้าย
// คัดแยก+ไร้หน้าทุกใบ = "unused แรก" ชนะ) · index2=slot:'reaction' (→ right_top, พกธง _secondEyeSubSlotFlag)
// · index3=slot:'action' (→ right_bottom, สะอาดไม่มีธง) — ลำดับ assignment ยืนยันแล้วด้วยสคริปต์วินิจฉัยจริง
// (ลบทิ้งแล้ว) ก่อนเขียนเทสนี้ ไม่ได้เดา

async function makeDataUri(seed) {
  const buf = await sharp({
    create: { width: 800, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128 + seed, sigma: 40 } },
  }).jpeg({ quality: 90 }).toBuffer();
  assert.ok(buf.length > 5000, `fixture ต้อง >5000 bytes (ได้ ${buf.length})`);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function buildSlotPlan(subFlag) {
  const urls = await Promise.all([0, 1, 2, 3].map((i) => makeDataUri(i * 10)));
  return urls.map((url, i) => ({
    url, thumbnailUrl: '', isHero: i === 0, person: null,
    clean: true, newsScene: true, faces: 0,
    slot: i === 2 ? 'reaction' : i === 3 ? 'action' : null,
    ...(i === 2 && subFlag ? { _secondEyeSubSlotFlag: subFlag } : {}),
  }));
}

await test('D1 (E2E, kill-switch ON default): ช่อง right_top พกธง subslot_no_face ค้าง — ลองยุบจริง (พบเพื่อนบ้านไร้หน้า → recompute ตกสาขา noface-top55 → ติด blind_crop ใหม่ → แย่ลง) → คืนของเดิมทุก byte (ตาข่ายนิรภัย ไม่ทำให้แย่ลง)', async () => {
  setEnv('MEGA_SLOT_COLLAPSE', null);
  const slotPlan = await buildSlotPlan('subslot_no_face');
  const out = await composeAndVerify({ newsTitle: 'ทดสอบยุบช่อง', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.ok(out.success, 'compose ต้องสำเร็จ (เดิม/หลังลองยุบก็ตาม)');
  assert.ok(out.qcFlags.includes('subslot_no_face'), `ธงเดิมต้องยังอยู่ (ยุบไม่สำเร็จ = ไม่ลบ) ได้ ${JSON.stringify(out.qcFlags)}`);
  assert.ok(!out.qcFlags.some((f) => String(f).startsWith('slot_collapsed:')), 'ต้องไม่มี slot_collapsed ค้าง (ไม่ควรรับผลที่แย่ลง)');
});

// ★ ตรวจซ้ำ (Opus 29 ก.ค. 69): เกณฑ์รับเดิม (traceQcFlags ทั้งเฟรม) นับธงช่องอื่น (เช่น main) ปนด้วย และไม่เคย
//   เครดิตการล้างธง S6 เดิมเลย → D1 ด้านบน "เสมอเป็น reject" แม้เพื่อนบ้านจะดีพอ (blind_crop+upscale_soft 2 ธงใหม่
//   บนภาพ noise 800x1000 เดิม) เพราะเกณฑ์เก่ามองไม่เห็นว่าธง subslot_no_face หายไปเลย — แก้เป็นเทียบเฉพาะ
//   {flagSlot,neighbor} + เครดิต +1 (ดู megaComposerService.js บรรทัดใกล้ MEGA_SLOT_COLLAPSE) — เทสนี้พิสูจน์ "accept
//   จริง" ผ่านฟังก์ชันจริง (composeAndVerify ไม่ mock อะไรเพิ่มจาก D1 เลย นอกจากขนาดภาพเพื่อนบ้านใหญ่ขึ้น — ยืนยันด้วย
//   สคริปต์สำรวจจริงก่อนเขียนเทส ไม่ใช่เดา): ภาพ right_bottom ใหญ่กว่าเดิม (1600x2000 แทน 800x1000) → recompute
//   หลังยุบยังติด blind_crop (หลีกเลี่ยงไม่ได้ตราบใดที่ไร้หน้า) แต่ไม่ติด upscale_soft เพิ่ม (ภาพใหญ่พอไม่ต้องยืด) →
//   ธงช่องเกี่ยวข้อง 1(เดิม, เครดิต)→1(ใหม่) เท่ากัน = รับผล
await test('D1b (E2E, accept จริง): เพื่อนบ้าน (right_bottom) ใหญ่พอ (1600x2000) — ยุบสำเร็จจริงผ่านเกณฑ์ใหม่ (ธงช่องเกี่ยวข้อง 1→1, ไม่ใช่ทั้งเฟรม) → subslot_no_face หาย + slot_collapsed ปรากฏ + assignments เหลือ 3 ช่อง', async () => {
  setEnv('MEGA_SLOT_COLLAPSE', null);
  const urls = await Promise.all([
    makeDataUri(0), makeDataUri(10), makeDataUri(20),
    (async () => {
      const buf = await sharp({ create: { width: 1600, height: 2000, channels: 3, noise: { type: 'gaussian', mean: 158, sigma: 40 } } }).jpeg({ quality: 90 }).toBuffer();
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    })(),
  ]);
  const slotPlan = urls.map((url, i) => ({
    url, thumbnailUrl: '', isHero: i === 0, person: null,
    clean: true, newsScene: true, faces: 0,
    slot: i === 2 ? 'reaction' : i === 3 ? 'action' : null,
    ...(i === 2 ? { _secondEyeSubSlotFlag: 'subslot_no_face' } : {}),
  }));
  const out = await composeAndVerify({ newsTitle: 'ทดสอบยุบช่อง (เพื่อนบ้านใหญ่)', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.ok(out.success, 'compose ต้องสำเร็จ');
  assert.ok(!out.qcFlags.includes('subslot_no_face'), `ธงเดิมต้องหายไป (ยุบสำเร็จ) ได้ ${JSON.stringify(out.qcFlags)}`);
  assert.ok(out.qcFlags.some((f) => String(f).startsWith('slot_collapsed:right_top->right_bottom')), `ต้องมี slot_collapsed ระบุช่องที่ยุบ ได้ ${JSON.stringify(out.qcFlags)}`);
});

await test('D2 (E2E, kill-switch OFF): MEGA_SLOT_COLLAPSE="0" — ผลลัพธ์ต้องเหมือน D1 เป๊ะ (byte-parity — ไม่ลองยุบเลยตั้งแต่ต้น แต่ D1 ก็ revert อยู่แล้วดังนั้นผลสังเกตได้ต้องตรงกัน)', async () => {
  setEnv('MEGA_SLOT_COLLAPSE', '0');
  const slotPlan = await buildSlotPlan('subslot_no_face');
  const out = await composeAndVerify({ newsTitle: 'ทดสอบยุบช่อง', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  setEnv('MEGA_SLOT_COLLAPSE', null);
  assert.ok(out.success);
  assert.ok(out.qcFlags.includes('subslot_no_face'));
  assert.ok(!out.qcFlags.some((f) => String(f).startsWith('slot_collapsed:')));
});

await test('D3 (control, E2E): ไม่มีธงค้างเลย (ปกติ) → ไม่มีการลองยุบ ไม่มี slot_collapsed มั่ว', async () => {
  setEnv('MEGA_SLOT_COLLAPSE', null);
  const slotPlan = await buildSlotPlan(null);
  const out = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.ok(out.success);
  assert.ok(!out.qcFlags.some((f) => String(f).startsWith('slot_collapsed:')));
});

// ═══════════════════════════ Part C: source-assertion (accept-path wiring) ═══════════════════════════
// D1b (Part B) พิสูจน์ "accept จริง" ผ่าน E2E เต็มรูปแบบแล้ว — ชุดนี้ยืนยันเพิ่มว่าโค้ดจริงมีรูปร่างตามที่ออกแบบ
// (เทียบเฉพาะช่องที่เกี่ยวข้อง + เครดิตธงที่หาย) ไม่ใช่แค่ "บังเอิญผ่านเทส"
const _srcComposer = readFileSync(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');

await test('E1: accept-path มีเงื่อนไข gate _newRelevantFlagN <= _preRelevantFlagN ก่อนรับผล (เทียบเฉพาะช่องที่เกี่ยวข้อง ไม่ใช่ทั้งเฟรม)', () => {
  assert.ok(/if \(_newRelevantFlagN <= _preRelevantFlagN\) \{/.test(_srcComposer), 'ต้องเทียบธงก่อน/หลัง (scoped) แล้วรับเฉพาะไม่แย่ลง');
});

await test('E1b: เกณฑ์ "ก่อน" กรองเฉพาะ {flagSlot, neighbor} + เครดิต +1 ให้ธง S6 เดิม — ไม่ใช่ traceQcFlags ทั้งเฟรม', () => {
  assert.ok(/_preRelevantTrace = _preTrace3\.filter\(\(t\) => t && \(String\(t\.slot\) === slotId \|\| String\(t\.slot\) === neighbor\.id\)\)/.test(_srcComposer), 'ต้องกรองเฉพาะช่องที่เกี่ยวข้องก่อนนับธง');
  assert.ok(/traceQcFlags\(_preRelevantTrace\)\.length \+ 1/.test(_srcComposer), 'ต้องเครดิต +1 ให้ธง S6 เดิมที่จะหายแน่นอนเมื่อช่องถูกลบ');
});

await test('E1c: เกณฑ์ "หลัง" กรองเฉพาะ neighbor เท่านั้น (flagSlot ไม่มีอยู่แล้วจริง ไม่ต้องกรองแยก)', () => {
  assert.ok(/_newRelevantTrace = \[\.\.\.traceSink\]\.filter\(\(t\) => t && String\(t\.slot\) === neighbor\.id\)/.test(_srcComposer), 'ต้องกรองเฉพาะ neighbor จากรอบใหม่');
});

await test('E2: accept-path ลบธงเดิม (qcFlags.splice) + ผลัก slot_collapsed:<from>-><to> เข้า qcFlags (ไม่ใช่ปล่อยผ่านเงียบๆ)', () => {
  assert.ok(/qcFlags\.splice\(fi, 1\)/.test(_srcComposer), 'ต้องลบธงเก่าที่ resolve แล้วออกจาก qcFlags');
  assert.ok(/qcFlags\.push\(`slot_collapsed:\$\{slotId\}->\$\{neighbor\.id\}`\)/.test(_srcComposer), 'ต้องผลักธงใหม่บอกว่ายุบช่องไหนไปช่องไหน');
});

await test('E3: reject-path คืนของเดิมครบ (assignments + buffer + traceSink) เมื่อไม่ผ่านเกณฑ์รับ', () => {
  assert.ok(/assignments\.length = 0; for \(const a of _preAssignSnap\) assignments\.push\(a\);/.test(_srcComposer));
  assert.ok(/traceSink\.length = 0; for \(const t of _preTrace3\) traceSink\.push\(t\);/.test(_srcComposer));
});

console.log(`\n# mega-slot-collapse-b2: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
