// ============================================================
// 🧪 MEGA_CIRCLE_POS_FLEX — สาย "ref จริง" (29 ก.ค. 69, ผลตรวจ Opus แบตช์ "วงกลมทับหน้าคน" รอบ 2)
// ------------------------------------------------------------
// เทสเดิม (mega-circle-position-avoid.test.mjs B-1/B-2/B-3/C-1) ใช้แต่ V3_TEMPLATES คงที่ในไฟล์ ซึ่งวงกลม
// ทุกใบทับ "เฉพาะฮีโร่" เท่านั้น → ไม่เคยพิสูจน์ว่า chooseCirclePosition ทำงานจริงผ่านสาย ref (dnaToTemplateSpec)
// Opus ตรวจพบว่า ref จริง 16/33 ใบสุ่มมีวงทับช่อง non-hero จริง (เช่น REF-mrbq6y74-on6u-vmirror ทับ reaction_3
// เต็ม 100%) — ไฟล์นี้เทสสายนั้นตรงๆ ด้วย composeAndVerify + refDNA จริง (embed literal, ไม่อ่านจาก .bak รันไทม์
// ตามกฎ anti-loop "ห้ามเทสพึ่งไฟล์ที่ไม่ได้อยู่ถาวรในคลัง")
//
// DNA ต้นทาง: REF-mrbq6y74-on6u-vmirror (พบใน _ref-backup-redesign/ref-cover-library.json.bak บรรทัด 6212 —
// แถวฐาน REF-mrbq6y74-on6u ที่ไม่มี -vmirror ยังเป็น ref จริงในประวัติศาสตร์ระบบ ถูกอ้างถึงใน data/mega-cover-runs.json
// + data/cover-technique-library.json + คอมเมนต์ dnaToTemplateSpec เอง บรรทัด "②b REF-mrbq6y74") — 5 ช่อง
// hero/context/action(กรอบเขียว)/reaction(แถบเต็มความกว้างล่างสุด)/moment(วงกลม) — ยืนยันด้วยสคริปต์สำรวจจริง
// (dnaToTemplateSpec ตรงๆ) ว่าหลัง snap ได้ spec.slots: main / context_1 / action_2 / reaction_3 / circle
// ที่ x=560,y=822,w=386,h=386 — bbox วงกลม (560-946, 822-1208) ตกอยู่ "ในรูป reaction_3" (x:0-1080,y:783-1350)
// เต็มร้อย ไม่แตะ action_2 (y:459-783 ไม่ overlap วงเลย) — ตรงกับที่ Opus ระบุ 100% เป๊ะ
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
const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 8).join('\n  ')}`); } };
const setEnv = (key, v) => { if (v === null) delete process.env[key]; else process.env[key] = v; };

// ── DNA จริง (embed literal — ค่า xPct/yPct/wPct/hPct ตรงจาก _ref-backup-redesign/ref-cover-library.json.bak
//    บรรทัด 6212, REF-mrbq6y74-on6u-vmirror.template.slots) ──
const REAL_REF_DNA_MRBQ = {
  template: {
    slots: [
      { xPct: 41.6574, yPct: 0, wPct: 58.3426, hPct: 60.2667, role: 'hero' },
      { xPct: 0, yPct: 0, wPct: 41.6574, hPct: 60.2667, role: 'context' },
      { xPct: 3, yPct: 33.9852, wPct: 48.7685, hPct: 22.2815, zIndex: 3, border: true, borderColor: '#00FF00', role: 'action' },
      { xPct: 0, yPct: 60.2667, wPct: 100, hPct: 39.7333, role: 'reaction' },
      { shape: 'circle', xPct: 51.8802, yPct: 60.8858, wPct: 35.7226, hPct: 28.5781, zIndex: 4, border: true, borderColor: '#FFFFFF', role: 'moment' },
    ],
  },
  _contentSanitized: true, // geometry ล้วน — เทสนี้สนใจตำแหน่งวงกลม ไม่สนเนื้อหา note
};

// ยืนยันครั้งเดียวตอนโหลดไฟล์: DNA นี้ผ่าน dnaToTemplateSpec แล้วได้ช่อง reaction_3 ทับวงกลม 100% จริง
// (คำนวณจาก spec.slots ตรงๆ ไม่เดา — สคริปต์สำรวจยืนยันค่าตายตัวชุดนี้แล้วก่อนล็อกเข้าเทส)
const _baseSpecCheck = dnaToTemplateSpec(REAL_REF_DNA_MRBQ);
const _circleCheck = _baseSpecCheck.slots.find((s) => s.shape === 'circle');
const _reactionCheck = _baseSpecCheck.slots.find((s) => /^reaction/.test(s.id));
if (!_circleCheck || !_reactionCheck) throw new Error('DNA fixture พัง — ไม่มีช่อง circle/reaction หลัง dnaToTemplateSpec');
{
  const cx0 = _circleCheck.x, cy0 = _circleCheck.y, cx1 = cx0 + _circleCheck.w, cy1 = cy0 + _circleCheck.h;
  const rx0 = _reactionCheck.x, ry0 = _reactionCheck.y, rx1 = rx0 + _reactionCheck.w, ry1 = ry0 + _reactionCheck.h;
  const fullyInside = cx0 >= rx0 && cx1 <= rx1 && cy0 >= ry0 && cy1 <= ry1;
  if (!fullyInside) throw new Error(`DNA fixture ไม่ตรงสมมติฐาน — วงกลม (${cx0},${cy0},${cx1},${cy1}) ไม่ได้ทับ reaction_3 เต็ม (${rx0},${ry0},${rx1},${ry1}) เหมือนที่สำรวจไว้`);
}
const TEMPLATE_CIRCLE_X = _circleCheck.x; // 560 (แคชไว้ใช้เทียบ — ไม่ hardcode เผื่อ dnaToTemplateSpec เปลี่ยนอัลกอริทึม snap ในอนาคต)
const TEMPLATE_CIRCLE_Y = _circleCheck.y; // 822

// ── slotPlan ควบคุมเต็ม 5 ใบ: hero/context/action/reaction/circle-content แท็ก slot ตรงตัว
//    ใช้ _secondEyeFaceBox (กลไก "ตาสอง" มีอยู่แล้ว MEGA_SECOND_EYE default ON) ฉีดกล่องหน้าที่ควบคุมได้เต็มที่
//    แทนการยุ่งกับ stub batchDetectFaces ส่วนกลาง (คุมเฉพาะภาพต่อใบ ไม่กระทบเทสอื่นในไฟล์)
async function mkImg(seed) {
  const buf = await sharp({ create: { width: 800, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128 + seed, sigma: 40 } } }).jpeg({ quality: 90 }).toBuffer();
  assert.ok(buf.length > 5000, `fixture ต้อง >5000 bytes (ได้ ${buf.length})`);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
const BIG_FACE_HERO = { x1: 0.30, y1: 0.10, x2: 0.70, y2: 0.55 };
const BIG_FACE_CIRCLE_CONTENT = { x1: 0.32, y1: 0.12, x2: 0.68, y2: 0.50 };
// ★ คาลิเบรตด้วยสคริปต์สำรวจจริง (ไม่ได้เดา): หน้าเบี่ยงขวาของภาพต้นทาง (x1:0.60-0.90) → หลัง cropFromFace
//   แม็ปเข้าช่อง reaction_3 (เต็มความกว้าง canvas) แล้วตกอยู่ใต้ footprint ของวงกลมตำแหน่ง "เดิม" พอดี (คะแนนเดิม>0)
//   แต่ตกนอก footprint ของตำแหน่ง "สะท้อน" สนิท (คะแนน=0) — บังคับให้ B ต้องเลือก "สะท้อน" ชนะจริง (ไม่ใช่เดา)
const BIG_FACE_REACTION_OFFSIDE = { x1: 0.60, y1: 0.15, x2: 0.90, y2: 0.55 };

async function buildSlotPlan({ reactionHasFace }) {
  const urls = await Promise.all([0, 1, 2, 3, 4].map((i) => mkImg(i * 10)));
  return [
    { url: urls[0], thumbnailUrl: '', isHero: true, person: null, clean: true, newsScene: true, slot: null, _secondEyeFaceBox: BIG_FACE_HERO },
    { url: urls[1], thumbnailUrl: '', isHero: false, person: null, clean: true, newsScene: true, slot: 'context' },
    { url: urls[2], thumbnailUrl: '', isHero: false, person: null, clean: true, newsScene: true, slot: 'action' },
    { url: urls[3], thumbnailUrl: '', isHero: false, person: null, clean: true, newsScene: true, slot: 'reaction', ...(reactionHasFace ? { _secondEyeFaceBox: BIG_FACE_REACTION_OFFSIDE } : {}) },
    { url: urls[4], thumbnailUrl: '', isHero: false, person: null, clean: true, newsScene: true, slot: 'circle', _secondEyeFaceBox: BIG_FACE_CIRCLE_CONTENT },
  ];
}

function findCircle(manifest) { return (manifest?.slots || []).find((s) => s.shape === 'circle'); }

await test('real-ref A: MEGA_CIRCLE_POS_FLEX=1 + ช่อง reaction_3 มีหน้าจริง (ตกใต้วงตำแหน่งเดิม) → วงขยับจริง (สะท้อนข้าม, x เปลี่ยน, y/w/h เดิม)', async () => {
  setEnv('MEGA_CIRCLE_POS_FLEX', '1');
  const slotPlan = await buildSlotPlan({ reactionHasFace: true });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  let out;
  try { out = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: REAL_REF_DNA_MRBQ, refImagePath: null, stableOrder: true }); }
  finally { console.log = origLog; }
  assert.equal(out.success, true, `compose ต้องสำเร็จ (error: ${out.error || '-'})`);
  // ยืนยันว่าเดิน "สาย ref จริง" (dnaToTemplateSpec) ไม่ใช่ fallback V3_TEMPLATES — id ต้องมี reaction_3/context_1/action_2
  assert.ok(out.placed.some((p) => p.slot === 'reaction_3'), `ต้องเดินสาย ref จริง (dnaToTemplateSpec ID) ได้ placed=${JSON.stringify(out.placed)}`);
  const circle = findCircle(out.manifest);
  assert.ok(circle, 'ต้องมีช่องวงกลมใน manifest');
  assert.notEqual(circle.x, TEMPLATE_CIRCLE_X, `วงต้องขยับจริง (ห้ามค้างที่ตำแหน่งเทมเพลตเดิม x=${TEMPLATE_CIRCLE_X})`);
  assert.equal(circle.y, TEMPLATE_CIRCLE_Y, 'ผู้สมัครทั้ง 3 อยู่บนแนว cy เดียวกันตามสเปก — y ห้ามเปลี่ยน');
  assert.ok(logs.some((l) => l.includes('🞅 วงกลม: ตำแหน่ง') && !l.includes('ตำแหน่ง เดิม')), `ต้องมี log ยืนยันเลือกตำแหน่งอื่นที่ไม่ใช่ "เดิม" (logs: ${JSON.stringify(logs.filter((l) => l.includes('วงกลม')))})`);
});

await test('real-ref B: MEGA_CIRCLE_POS_FLEX=1 แต่ช่อง reaction_3 "ไม่มีหน้า" → คะแนนทุกตำแหน่งเท่ากัน (0) → เลือก "เดิม" เสมอ (ตำแหน่งไม่ขยับ)', async () => {
  setEnv('MEGA_CIRCLE_POS_FLEX', '1');
  const slotPlan = await buildSlotPlan({ reactionHasFace: false });
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  let out;
  try { out = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: REAL_REF_DNA_MRBQ, refImagePath: null, stableOrder: true }); }
  finally { console.log = origLog; }
  assert.equal(out.success, true, `compose ต้องสำเร็จ (error: ${out.error || '-'})`);
  const circle = findCircle(out.manifest);
  assert.equal(circle.x, TEMPLATE_CIRCLE_X, 'ไม่มีหน้าในช่องไหนที่วงทับ → ต้องคงตำแหน่งเทมเพลตเดิมเป๊ะ');
  assert.equal(circle.y, TEMPLATE_CIRCLE_Y, 'y ต้องคงเดิมเช่นกัน');
  assert.ok(logs.some((l) => l.includes('🞅 วงกลม: ตำแหน่ง เดิม')), 'ต้องมี log แต่ผลลัพธ์ต้องเป็น "เดิม" (เท่ากันทุกจุด=0 → tie-break ตำแหน่งแรก)');
});

await test('real-ref C: MEGA_CIRCLE_POS_FLEX ปิด (=0 หรือไม่ตั้งค่า) แม้ช่อง reaction_3 มีหน้าจริง → outputHash เดิมเป๊ะทั้งสองค่า (ไม่เรียกกลไกเลย)', async () => {
  const slotPlan = await buildSlotPlan({ reactionHasFace: true }); // สร้างครั้งเดียว reuse ทั้งสองรอบ (ภาพต้นทางต้องเหมือนกันทุก byte)
  setEnv('MEGA_CIRCLE_POS_FLEX', '0');
  const outOff = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: REAL_REF_DNA_MRBQ, refImagePath: null, stableOrder: true });
  setEnv('MEGA_CIRCLE_POS_FLEX', null);
  const outUnset = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: REAL_REF_DNA_MRBQ, refImagePath: null, stableOrder: true });
  assert.equal(outOff.success, true, `flag='0' ต้องสำเร็จ (error: ${outOff.error || '-'})`);
  assert.equal(outUnset.success, true, `flag ไม่ตั้งค่าต้องสำเร็จ (error: ${outUnset.error || '-'})`);
  assert.equal(outUnset.manifest.outputHash, outOff.manifest.outputHash, 'ปิด flag (ค่าใดก็ตามที่ไม่ใช่ "1") ต้อง byte-identical กันเป๊ะ — B ต้อง opt-in เท่านั้น (===\'1\')');
  const circleOff = findCircle(outOff.manifest), circleUnset = findCircle(outUnset.manifest);
  assert.equal(circleOff.x, TEMPLATE_CIRCLE_X, 'ปิด flag ต้องคงตำแหน่งเทมเพลตเดิมเป๊ะ แม้มีหน้าที่ควรทำให้ขยับถ้าเปิด');
  assert.equal(circleUnset.x, TEMPLATE_CIRCLE_X, 'ไม่ตั้งค่า (default) ต้องคงตำแหน่งเทมเพลตเดิมเป๊ะเช่นกัน (opt-in default OFF)');
});

setEnv('MEGA_CIRCLE_POS_FLEX', null);
console.log(`\n# mega-circle-realref: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
