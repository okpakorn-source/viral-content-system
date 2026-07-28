// ============================================================
// 🧪 "วงกลมทับหน้าคน" 2 กลไก (28 ก.ค. 69, แบตช์ใหม่เจ้าของเคาะ) — src/lib/services/coverExecutorService.js +
//   src/lib/services/megaComposerService.js + src/lib/panelCropGeometry.js
// ------------------------------------------------------------
// A. ครอปหลบวงกลม — flag ใหม่ MEGA_CIRCLE_AVOID_CROP (AND กับ MEGA_CIRCLE_AVOID เดิม ใน _circleAvoidOn()
//    coverExecutorService.js) ทั้งคู่ default ON ควบคุมกลไก biasRegionFromCircleZone (Batch C เดิม, 17 ก.ค.)
//    ที่มีอยู่แล้วครบทั้ง 4 ข้อของสเปกนี้ (geometry จริง/เลื่อนคง scale/เลื่อนไม่พ้น→ธง circle_face_overlap เดิม
//    (คำนวณอิสระที่ measureTechRules ไม่เกี่ยวกับจุดนี้เลย — เห็นได้แค่ trace circleAvoidNeedsBackup ที่นี่)/
//    ไม่มี faceBox→ไม่เลื่อน) — งานนี้แค่เพิ่มชื่อ flag ใหม่ให้ rollback แยกอิสระได้ (ไม่ลบของเดิม)
// B. ตำแหน่งวงกลมยืดหยุ่น — flag ใหม่ MEGA_CIRCLE_POS_FLEX (megaComposerService.js composeCore) เรียก
//    chooseCirclePosition (panelCropGeometry.js, PURE — เทสละเอียดที่ tests/panel-crop-geometry.test.mjs C3a-*)
//    "หลัง" ④ จับคู่ภาพ→ช่องเสร็จ (ต้องรู้ faceBox จริงต่อช่อง) แล้วมิวเทต spec.slots[idx] แทนที่ทั้ง entry (ไม่แก้
//    property บน object เดิม — กันรั่วข้ามงานถ้า spec เป็น object ระดับโมดูล) → จุดคำนวณ _circleZone ของ A (relocate
//    มาอยู่ "หลัง" B) + จุดวาดป้ายชื่อวงกลม (label) + measureTechRules (circle_face_overlap) อ่าน core.spec.slots
//    สดทุกจุด (object เดียวกัน ไม่มี cache) ⇒ ตำแหน่งที่ B เลือกไหลไปถึงทุกจุดโดยอัตโนมัติ ("label ตามวง" พิสูจน์ผ่าน
//    manifest.slots[].geom.x/y ซึ่งมาจาก core.spec ตัวเดียวกันเป๊ะที่โค้ดวาดป้ายอ่าน — ดูคอมเมนต์จุดทดสอบ)
//
// ★★★ แก้ 29 ก.ค. 69 (Opus ตรวจแบตช์ A+B รอบแรก FAIL): ข้อความเดิมตรงนี้เขียนไว้ว่า "เทมเพลตจริงทุกใบใน
//   V3_TEMPLATES วางวงกลมทับเฉพาะฮีโร่ ⇒ B เป็น no-op ปลอดภัย 100% กับเทมเพลตจริงทั้งหมด" — ผิดข้อเท็จจริง
//   เพราะ "เทมเพลตจริง" ที่ระบบใช้งานจริงส่วนใหญ่มาจาก dnaToTemplateSpec(refDNA) (ref-cover-library) ไม่ใช่
//   V3_TEMPLATES (แค่ fallback เมื่อไม่มี ref/ ref ใช้ไม่ได้) — Opus สุ่มตรวจ ref จริง 33 ใบ พบ 16 ใบมีวงทับช่อง
//   non-hero จริง (ตัวอย่างยืนยันแล้ว: REF-mrbq6y74-on6u-vmirror ทับ reaction_3 เต็ม 100% — ดูเทสจริงที่
//   tests/mega-circle-realref.test.mjs ซึ่งพิสูจน์ว่า B ขยับวงจริงเมื่อช่องนั้นมีหน้า) ⇒ ข้อสรุปที่ถูกต้องคือ:
//     - B เป็น no-op เฉพาะกับ "เทมเพลต fallback ใน V3_TEMPLATES เท่านั้น" (พิสูจน์ยังคงอยู่ที่ B-3 ด้านล่าง —
//       ยังเป็นความจริงและมีประโยชน์ ไม่ได้ผิด แค่ต้อง "จำกัดขอบเขต" คำพูดให้ตรง ไม่ใช่ generalize เป็น "ทุกเทมเพลตจริง")
//     - เพราะย้ายวงกระทบ refSimilarity (ตัวชี้วัดหลัก) โดยตรงถ้าเปิดใช้กับ ref จริง — B จึงถูกเปลี่ยนเป็น "opt-in"
//       (MEGA_CIRCLE_POS_FLEX ต้อง==='1' เป๊ะเท่านั้นถึงเปิด, default OFF — เดิมเข้าใจผิดว่า default ON ปลอดภัย)
//   บทเรียน: การพิสูจน์ "no-op" ต้องเทสกับสายจริงที่ production ใช้งาน (dnaToTemplateSpec) ไม่ใช่แค่ค่าคงที่
//   fallback ในไฟล์ — เทสสายนั้นแยกไว้ที่ tests/mega-circle-realref.test.mjs (ไม่ปนกับไฟล์นี้ที่ยังทดสอบ
//   V3_TEMPLATES fallback + wiring/flag-gating เป็นหลัก)
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

const { composeAndVerify } = await import('../src/lib/services/megaComposerService.js');
const { executeCover } = await import('../src/lib/services/coverExecutorService.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };
const setEnv = (key, v) => { if (v === null) delete process.env[key]; else process.env[key] = v; };

// ═══════════════════════════════ A: coverExecutorService.js — executor-level (full branch control) ═══════════════════════════════
// ★ fixture คาลิเบรตด้วยสคริปต์สำรวจจริง (ไม่ได้เดา) — หน้าแคบ (10% กว้าง) ที่ x:0.62-0.72 (ครึ่งขวาของ region เริ่มต้น)
//   กับโซนหลบครึ่งขวา (x0:0.5-x1:1.0) → ภาพต้นทางกว้าง (2000px) มีที่ให้เลื่อนพ้น / ภาพแคบ (700px) เลื่อนไม่พ้น

const SECONDARY_SLOT_BASE = { id: 'reaction_1', x: 0, y: 0, w: 400, h: 500, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' };
const ZONE_RIGHT_HALF = { x0: 0.5, y0: 0.0, x1: 1.0, y1: 1.0 };
const FB_NARROW = { x1: 0.62, y1: 0.30, x2: 0.72, y2: 0.55, count: 1 };
const mkTemplate = (slot) => ({ id: 'geo', canvasW: 1080, canvasH: 1350, feather: 0, slots: [slot] });

async function runExec({ metaW, metaH, fb, zone, crop = null }) {
  const slot = zone ? { ...SECONDARY_SLOT_BASE, _circleZone: zone } : { ...SECONDARY_SLOT_BASE };
  const traceSink = [];
  // ใช้ sharp จริง (ไม่ stub) — decode ภาพจริงเพื่อ metadata ถูกต้อง → สร้าง noise buffer ขนาดที่สั่งจริง
  const buf = await sharp({ create: { width: metaW, height: metaH, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).jpeg({ quality: 85 }).toBuffer();
  await executeCover({
    assignments: [{ slotId: slot.id, imageIndex: 0, crop }],
    imageBuffers: [{ buffer: buf }],
    templateSpec: mkTemplate(slot), faceBoxes: [fb], traceSink,
  });
  return traceSink.find((t) => t.slot === slot.id) || null;
}

// ★★★ แก้ 29 ก.ค. 69 (Opus แบตช์ A+B รอบ 2): A-1 เดิมยืนยันว่า "ไม่มีหน้า = zone ไม่มีผลเลย" — ผิดตั้งแต่แบตช์
//   "ขยายการหลบให้ครบทุกกิ่งครอป" (ข้อ 3 ของผลตรวจ Opus) เพิ่ม biasRegionFromCircleZoneBlind มาอุดกิ่ง "ไม่มีข้อมูล
//   หน้าเลย" (blind-center/final-cropper) ที่เดิมไม่เคยหลบวงเลย — สาเหตุที่น่าจะใช่ที่สุดของเคส AC-0202 (วงทับแค่
//   ~3% แต่ไม่มีใครหลบ) กิ่งนี้ "ยึดจุดกึ่งกลางภาพต้นทาง" แทนหน้า (ไม่มีหน้าให้ยึด) — เพราะงั้น "ไม่มีหน้า" ไม่ได้แปลว่า
//   "zone ไม่มีผล" อีกต่อไป — ทดสอบใหม่: ต้องมี "กิ่งที่มีข้อมูลจริง" ให้เห็นก่อน (ทั้ง blind-center และ final-cropper)
await test('A-1: ไม่มี faceBox + ไม่มี crop (blind-center) + มี zone → กิ่งใหม่ biasRegionFromCircleZoneBlind หลบจริง (branch +circavoidblind, region.left เปลี่ยน)', async () => {
  setEnv('MEGA_CIRCLE_AVOID_CROP', null); setEnv('MEGA_CIRCLE_AVOID', null); // ทั้งคู่ default ON
  const withZoneNoFace = await runExec({ metaW: 2000, metaH: 1500, fb: null, zone: ZONE_RIGHT_HALF });
  const noZoneNoFace = await runExec({ metaW: 2000, metaH: 1500, fb: null, zone: null });
  assert.ok(withZoneNoFace.branch.includes('circavoidblind'), `ต้องเห็น branch +circavoidblind (ได้ "${withZoneNoFace.branch}")`);
  assert.ok(!noZoneNoFace.branch.includes('circavoidblind'), `ไม่มี zone = ไม่มีทางเข้ากิ่งหลบ (ได้ "${noZoneNoFace.branch}")`);
  assert.notEqual(withZoneNoFace.region.left, noZoneNoFace.region.left, 'มี zone ต้องดัน region.left ให้ต่างจากไม่มี zone (จุดสนใจ = กึ่งกลางภาพต้นทาง ถูกดันออกนอกโซน)');
  assert.equal(withZoneNoFace.region.width, noZoneNoFace.region.width, 'เลื่อนอย่างเดียว — width ต้องคง scale เดิม');
  assert.equal(withZoneNoFace.region.height, noZoneNoFace.region.height, 'เลื่อนอย่างเดียว — height ต้องคง scale เดิม');
});

await test('A-1b: crop._final (final-cropper, S6) + ไม่มี faceBox + มี zone → กิ่งใหม่หลบจริงเช่นกัน (กิ่งที่ AC-0202 ระบุว่าไม่เคยหลบเลย)', async () => {
  setEnv('MEGA_CIRCLE_AVOID_CROP', null); setEnv('MEGA_CIRCLE_AVOID', null);
  const finalCrop = { x: 0.15, y: 0.1, w: 0.5, h: 0.5, _final: true }; // ★ คาลิเบรตจริง: x:0.1 ตกขอบ zone พอดี (score=0, ไม่ขยับ — by design) ต้อง 0.15 ให้ชัดเจนว่าอยู่ในโซน
  const withZone = await runExec({ metaW: 2000, metaH: 1500, fb: null, zone: ZONE_RIGHT_HALF, crop: finalCrop });
  const noZone = await runExec({ metaW: 2000, metaH: 1500, fb: null, zone: null, crop: finalCrop });
  assert.ok(withZone.branch.includes('final-cropper'), `ต้องยังอยู่กิ่ง final-cropper (ได้ "${withZone.branch}")`);
  assert.ok(withZone.branch.includes('circavoidblind'), `ต้องเห็น branch +circavoidblind ต่อท้าย final-cropper (ได้ "${withZone.branch}")`);
  assert.ok(!noZone.branch.includes('circavoidblind'), `ไม่มี zone = ไม่มีทางเข้ากิ่งหลบ (ได้ "${noZone.branch}")`);
  assert.notEqual(withZone.region.left, noZone.region.left, 'มี zone ต้องดัน region.left ต่างจากไม่มี zone แม้เป็นครอป _final จาก S6 ก็ตาม');
  assert.equal(withZone.region.width, noZone.region.width, 'เลื่อนอย่างเดียว — width ต้องคง scale เดิม');
  assert.equal(withZone.region.height, noZone.region.height, 'เลื่อนอย่างเดียว — height ต้องคง scale เดิม');
});

await test('A-1c parity: MEGA_CIRCLE_AVOID_CROP=0 → กิ่งใหม่ (blind/final-cropper) ก็ต้องปิดด้วย (ประตูเดียวกับกิ่งเดิม, ไม่มี "หลุดประตู")', async () => {
  setEnv('MEGA_CIRCLE_AVOID_CROP', '0'); setEnv('MEGA_CIRCLE_AVOID', null);
  const withZone = await runExec({ metaW: 2000, metaH: 1500, fb: null, zone: ZONE_RIGHT_HALF });
  const noZone = await runExec({ metaW: 2000, metaH: 1500, fb: null, zone: null });
  assert.ok(!withZone.branch.includes('circavoidblind'), `ปิด flag ต้องไม่มี branch +circavoidblind เลย (ได้ "${withZone.branch}")`);
  assert.deepEqual(withZone.region, noZone.region, 'ปิด flag ใหม่ → กิ่ง blind-center ต้อง byte-parity กับไม่มี zone เลย');
});

await test('A-2: ทับโซน + ภาพต้นทางกว้างพอเลื่อน → region เลื่อนพ้นจริง (branch +circavoid, ไม่ติดธง)', async () => {
  setEnv('MEGA_CIRCLE_AVOID_CROP', null); setEnv('MEGA_CIRCLE_AVOID', null);
  const baseline = await runExec({ metaW: 2000, metaH: 1500, fb: FB_NARROW, zone: null });
  const avoided = await runExec({ metaW: 2000, metaH: 1500, fb: FB_NARROW, zone: ZONE_RIGHT_HALF });
  assert.ok(avoided.branch.includes('+circavoid'), `ต้องเห็น branch +circavoid (ได้ "${avoided.branch}")`);
  assert.ok(!avoided.circleAvoidNeedsBackup, 'เลื่อนสำเร็จ = ไม่ติดธง circleAvoidNeedsBackup');
  assert.notEqual(avoided.region.left, baseline.region.left, 'region.left ต้องเปลี่ยนจริง (เลื่อนพ้นโซนแล้ว)');
  assert.equal(avoided.region.width, baseline.region.width, 'เลื่อนอย่างเดียว — width ต้องคง scale เดิม (ห้าม zoom เพิ่ม)');
  assert.equal(avoided.region.height, baseline.region.height, 'เลื่อนอย่างเดียว — height ต้องคง scale เดิมเช่นกัน');
});

await test('A-3: ทับโซน + ภาพต้นทางแคบเกิน (เลื่อนไม่พ้น) → คงครอปเดิม + ติดธง circleAvoidNeedsBackup (สัญญาณเดียวกับที่ทำให้ composer ลองภาพสำรอง/QC เจอ circle_face_overlap ทีหลัง)', async () => {
  setEnv('MEGA_CIRCLE_AVOID_CROP', null); setEnv('MEGA_CIRCLE_AVOID', null);
  const baseline = await runExec({ metaW: 700, metaH: 1500, fb: FB_NARROW, zone: null });
  const stuck = await runExec({ metaW: 700, metaH: 1500, fb: FB_NARROW, zone: ZONE_RIGHT_HALF });
  assert.ok(!stuck.branch.includes('circavoid'), `เลื่อนไม่พ้น = ต้องไม่มี branch +circavoid (ได้ "${stuck.branch}")`);
  assert.equal(stuck.circleAvoidNeedsBackup, true, 'เลื่อนไม่พ้น = ต้องติดธง circleAvoidNeedsBackup');
  assert.deepEqual(stuck.region, baseline.region, 'เลื่อนไม่พ้น = ต้องคงครอปเดิมเป๊ะ (ไม่ใช่ครอปพังๆ ครึ่งๆ กลางๆ)');
});

await test('A-4 parity: MEGA_CIRCLE_AVOID_CROP=0 → เหมือนไม่มี zone เลย (byte-parity) แม้ MEGA_CIRCLE_AVOID ยังเปิดอยู่', async () => {
  setEnv('MEGA_CIRCLE_AVOID_CROP', '0'); setEnv('MEGA_CIRCLE_AVOID', null);
  const off = await runExec({ metaW: 2000, metaH: 1500, fb: FB_NARROW, zone: ZONE_RIGHT_HALF });
  const noZone = await runExec({ metaW: 2000, metaH: 1500, fb: FB_NARROW, zone: null });
  assert.deepEqual(off.region, noZone.region, 'flag ใหม่ปิด (แม้ค่าเดิมยังเปิด) ต้องได้ผลเหมือนไม่มี zone เลย');
  assert.ok(!off.branch.includes('circavoid'));
});

await test('A-5 parity: MEGA_CIRCLE_AVOID=0 (ชื่อเดิม) → ปิดกลไกเหมือนกัน แม้ MEGA_CIRCLE_AVOID_CROP ใหม่ยังเปิดอยู่ (ไม่ลบของเดิม)', async () => {
  setEnv('MEGA_CIRCLE_AVOID_CROP', null); setEnv('MEGA_CIRCLE_AVOID', '0');
  const off = await runExec({ metaW: 2000, metaH: 1500, fb: FB_NARROW, zone: ZONE_RIGHT_HALF });
  const noZone = await runExec({ metaW: 2000, metaH: 1500, fb: FB_NARROW, zone: null });
  assert.deepEqual(off.region, noZone.region, 'ชื่อ flag เดิมยังต้องปิดกลไกได้เหมือนเดิมทุกประการ');
  setEnv('MEGA_CIRCLE_AVOID', null);
});

// ═══════════════════════════════ B: megaComposerService.js composeCore — wiring + flag gating (real templates) ═══════════════════════════════

async function makeDataUri(seed) {
  const buf = await sharp({ create: { width: 800, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128 + seed, sigma: 40 } } }).jpeg({ quality: 90 }).toBuffer();
  assert.ok(buf.length > 5000, `fixture ต้อง >5000 bytes (ได้ ${buf.length})`);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
async function buildSlotPlan() {
  const urls = await Promise.all([0, 1, 2, 3].map((i) => makeDataUri(i * 10)));
  return urls.map((url, i) => ({ url, thumbnailUrl: '', isHero: i === 0, person: null, clean: true, newsScene: true, faces: 0, slot: null }));
}

// ★★★ แก้ 29 ก.ค. 69 (Opus แบตช์ A+B รอบ 2, ข้อ 2 บังคับ): B-1/B-2/B-3 เดิมทั้งชุดสมมติว่า default = ON
//   (ไม่ตั้ง env = เรียก chooseCirclePosition จริง) — ตอนนี้กลับขั้วเป็น opt-in (===\'1\' เป๊ะเท่านั้นถึงเปิด,
//   default OFF) เพราะย้ายวงกระทบ refSimilarity บนสาย ref จริง (ดูเทสจริงที่ mega-circle-realref.test.mjs) —
//   B-1/B-2 เขียนใหม่ให้ตรงขั้วใหม่ · B-3 คงไว้ (แต่เปลี่ยนมาทดสอบ '1' แทน — จุดที่ยังมีประโยชน์จริงคือพิสูจน์ว่า
//   "V3_TEMPLATES fallback ปลอดภัยแม้เปิด B ตรงๆ" ซึ่งเป็นข้อเท็จจริงที่ถูกต้อง แค่ต้อง "จำกัดขอบเขต" คำพูดให้ตรง
//   (ไม่ใช่ "เทมเพลตจริงทุกใบ" แบบเดิมที่ Opus ชี้ว่าผิด)
await test('B-1: default (ไม่ตั้ง env) → opt-in OFF — ไม่เรียก chooseCirclePosition เลย (ไม่มี log, ตำแหน่งวงเดิม)', async () => {
  setEnv('MEGA_CIRCLE_POS_FLEX', null);
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); origLog(...a); };
  try {
    const slotPlan = await buildSlotPlan();
    const out = await composeAndVerify({ newsTitle: 'ข่าวทดสอบวงกลมยืดหยุ่น', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
    assert.equal(out.success, true, `compose ต้องสำเร็จ (error: ${out.error || '-'})`);
    const circleGeom = (out.manifest?.slots || []).find((s) => s.shape === 'circle');
    assert.ok(circleGeom, 'ต้องมีช่องวงกลมในโครงที่เลือก');
    assert.ok(!logs.some((l) => l.includes('🞅 วงกลม: ตำแหน่ง')), 'default ต้อง OFF (opt-in) — ไม่ตั้ง env ต้องไม่เรียก chooseCirclePosition เลย');
  } finally { console.log = origLog; }
});

await test('B-2 parity: MEGA_CIRCLE_POS_FLEX=\'0\' กับไม่ตั้งค่า (default) → output เหมือนกันเป๊ะทุก byte (ทั้งคู่คือ "ปิด" — opt-in ต้อง===\'1\'เท่านั้น)', async () => {
  const slotPlan = await buildSlotPlan(); // สร้างครั้งเดียว reuse ทั้งสองรอบ (ภาพต้นทางต้องเหมือนกันทุก byte)
  setEnv('MEGA_CIRCLE_POS_FLEX', '0');
  const outZero = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  setEnv('MEGA_CIRCLE_POS_FLEX', null);
  const outUnset = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(outZero.success, true);
  assert.equal(outUnset.success, true);
  assert.equal(outUnset.manifest.outputHash, outZero.manifest.outputHash, "'0' และไม่ตั้งค่า ต้องเป็น 'ปิด' เหมือนกันเป๊ะ (opt-in ต้อง==='1' เท่านั้นถึงเปิด)");
});

await test('B-3: MEGA_CIRCLE_POS_FLEX=\'1\' (เปิดจริง) + เทมเพลต fallback V3_TEMPLATES (ไม่มี refDNA) → เรียกฟังก์ชันจริง (มี log) แต่ตำแหน่งไม่ขยับ (ขอบเขตแคบ: เฉพาะ V3_TEMPLATES ที่วงทับแต่ฮีโร่ — ไม่ generalize ไปสาย ref จริง ดู mega-circle-realref.test.mjs)', async () => {
  const slotPlan = await buildSlotPlan();
  setEnv('MEGA_CIRCLE_POS_FLEX', '1');
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); origLog(...a); };
  let out;
  try { out = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true }); }
  finally { console.log = origLog; setEnv('MEGA_CIRCLE_POS_FLEX', null); }
  assert.equal(out.success, true, `compose ต้องสำเร็จ (error: ${out.error || '-'})`);
  assert.ok(logs.some((l) => l.includes('🞅 วงกลม: ตำแหน่ง') && l.includes('ทับหน้า') && l.includes('ครอปหลบ')), 'เปิดจริงต้องเรียก chooseCirclePosition (เห็น log ตามสเปก)');
  assert.ok(logs.some((l) => l.includes('🞅 วงกลม: ตำแหน่ง เดิม')), 'V3_TEMPLATES fallback: วงทับแต่ฮีโร่ (ยกเว้นจากคะแนน) ⇒ ทุกตำแหน่งคะแนนเท่ากัน (0) ⇒ tie-break เลือก "เดิม" เสมอ');
});

// ═══════════════════════════════ C: parity ทั้งระบบ (composeAndVerify) — คอมโบทั้ง 4 ของสองแฟล็ก (เทมเพลต fallback) ═══════════════════════════════
// ★★★ แก้ 29 ก.ค. 69: C-1 เดิมเทียบ "ปิดทั้งคู่" กับ "default ON ทั้งคู่" — ตอนนี้ POS_FLEX default เป็น OFF แล้ว
//   (เหมือนปิด) ⇒ "ปิดทั้งคู่" กับ "default" ไม่ต่างกันอีกต่อไปสำหรับ POS_FLEX (เทสเดิมจะ trivial ไม่มีความหมาย)
//   เขียนใหม่เป็น "parity ทุกคอมโบ" ของทั้ง 2 แฟล็ก (2×2 = 4 สถานะ) ยืนยันไม่มี interaction แปลกระหว่างสองแฟล็ก
//   (AVOID_CROP คุมกิ่งครอปที่ executor, POS_FLEX คุมตำแหน่งวงที่ composer — คนละจุด ไม่ควรกระทบกัน)
await test('C-1: parity ทุกคอมโบ (AVOID_CROP × POS_FLEX) — V3_TEMPLATES ทุกคอมโบต้อง byte-identical กัน (วงทับแต่ฮีโร่ ⇒ ไม่มีกลไกไหนมีผลจริงเลยในเทมเพลตกลุ่มนี้)', async () => {
  const slotPlan = await buildSlotPlan();
  const combos = [
    ['0', '0'], ['0', '1'], ['0', null],
    [null, '0'], [null, '1'], [null, null],
    ['1', '0'], ['1', '1'], ['1', null],
  ];
  const results = [];
  for (const [avoidCrop, posFlex] of combos) {
    setEnv('MEGA_CIRCLE_AVOID_CROP', avoidCrop);
    setEnv('MEGA_CIRCLE_POS_FLEX', posFlex);
    const out = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
    assert.equal(out.success, true, `คอมโบ AVOID_CROP=${avoidCrop} POS_FLEX=${posFlex} ต้องสำเร็จ (error: ${out.error || '-'})`);
    results.push({ combo: `AVOID_CROP=${avoidCrop},POS_FLEX=${posFlex}`, hash: out.manifest.outputHash });
  }
  setEnv('MEGA_CIRCLE_AVOID_CROP', null); setEnv('MEGA_CIRCLE_POS_FLEX', null);
  const baseHash = results[0].hash;
  for (const r of results) {
    assert.equal(r.hash, baseHash, `คอมโบ ${r.combo} ต้อง byte-identical กับ ${results[0].combo} (ได้ ${r.hash} vs ${baseHash}) — เทมเพลต fallback V3_TEMPLATES ไม่มีคอมโบไหนควรมีผลจริง`);
  }
});

console.log(`\n# mega-circle-position-avoid: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
