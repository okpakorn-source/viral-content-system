// ============================================================
// mega-composer-circle-label.test.mjs — TIER3 ข: ป้ายชื่อวงกลม (src/lib/services/megaComposerService.js)
//   แก้ตามผลตรวจรอบ 2 (27 ก.ค. 69): (1) คุมความกว้าง ink จริง ไม่ใช่จำนวนตัวอักษร — การันตีด้วย circular mask
//   ตอน composite (buildCircleLabelOverlay) ไม่ใช่แค่ประมาณความกว้างตัวอักษร (2) ตัวกรองชื่อ: ถอดวงเล็บ/ใช้ชื่อเล่น
//   + บัญชีดำคำบรรยาย generic (3) เลี่ยง JPEG encode ซ้ำ (คุณภาพ 92→97 พร้อมเหตุผลที่ไม่ย้ายเข้า executor)
//   (4) สายสตริกต์ (MEGA_STRICT_RENDER=1) ต้องปิดป้ายเสมอ
//
//   (1) unit ป้ายชื่อ (PURE — circleLabelText/buildCircleLabelSvg): มีชื่อ→วาด / ไม่มีชื่อ→ไม่วาด / วงเล็บ→ใช้ชื่อเล่น
//       ไม่มีวงเล็บเปิดค้าง / คำบรรยาย generic→ไม่วาด
//   (2) unit ป้ายชื่อ (masked overlay — buildCircleLabelOverlay): rasterize จริงแล้วนับพิกเซล ink นอกวง ต้อง = 0
//       เสมอ ไม่ว่าชื่อจะยาวแค่ไหน (การันตีระดับพิกเซล ไม่ใช่แค่สูตรประมาณ)
//   (3) integration จริงผ่าน composeAndVerify: ปิดสวิตช์ MEGA_CIRCLE_LABEL=0 หรือไม่รู้ชื่อ/ชื่อ generic → buffer
//       เดิมเป๊ะ (sha1 ตรงกัน) · เปิดสวิตช์ + รู้ชื่อจริง → buffer เปลี่ยน (ป้ายวาดจริง) · MEGA_STRICT_RENDER=1 →
//       ป้ายถูกปิดเสมอแม้เปิดสวิตช์ + รู้ชื่อจริง
//   เทคนิค: stub faceDetector ให้ไม่เจอหน้าเลย (Map ว่าง) → hero ตัดสินด้วย isHero flag ล้วน (deterministic
//   100% ไม่พึ่งตาหาหน้าจริง) · slotPlan เป็น data: URI ภาพ noise สร้างสดด้วย sharp (ไม่ยิง network จริง)
// ============================================================
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { register } from 'node:module';
import sharp from 'sharp';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
// stub ตาหาหน้า: ไม่เจอหน้าเลยทุกใบ (Map ว่าง) — ทำให้ตัวเลือก hero/circle/ช่องรอง deterministic ผ่าน isHero/pickIdx ล้วน
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

// ปิดเลนอื่นที่ไม่เกี่ยว กันปนผล (แพทเทิร์นเดียวกับเทสอื่นในชุดนี้)
delete process.env.MEGA_STRICT_RENDER;
delete process.env.MEGA_COVER_TESTER;
process.env.MEGA_SCENE_DEDUP = '0';

const { circleLabelText, buildCircleLabelSvg, buildCircleLabelOverlay, composeAndVerify } = await import('../src/lib/services/megaComposerService.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };
const setEnv = (key, v) => { if (v === null) delete process.env[key]; else process.env[key] = v; };
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
void sha1; // เผื่อใช้ debug — ไม่ได้ใช้ตรงๆ ในเทสนี้ (เทียบผ่าน manifest.outputHash แทน)

// นับพิกเซล ink (alpha>เกณฑ์) ที่อยู่ "นอกวงกลม" จริง — ใช้พิสูจน์ข้อ (1)/(2) ของผลตรวจรอบ 2
async function inkOutsideCircleStats(pngBuf, d) {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cx = d / 2, cy = d / 2, r = d / 2;
  let outside = 0, total = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 4;
      if (data[idx + 3] > 40) {
        total++;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (Math.sqrt(dx * dx + dy * dy) > r + 1) outside++; // +1px เผื่อ anti-aliasing ขอบ
      }
    }
  }
  return { total, outside };
}

// ═══════════════════════ (1) circleLabelText — PURE unit: ตัวกรองชื่อ ═══════════════════════

await test('circleLabelText: มีชื่อสั้น → คืนตามเดิม (ไม่ตัด)', async () => {
  assert.equal(circleLabelText('พี่แก้ว'), 'พี่แก้ว');
});

await test('circleLabelText: ว่าง/whitespace/null/undefined → null ทั้งหมด (สัญญาณ "ไม่รู้ชื่อ")', async () => {
  assert.equal(circleLabelText(''), null);
  assert.equal(circleLabelText('   '), null);
  assert.equal(circleLabelText(null), null);
  assert.equal(circleLabelText(undefined), null);
});

await test('circleLabelText: กด whitespace ซ้ำในชื่อให้เหลือช่องเดียว', async () => {
  assert.equal(circleLabelText('พี่   แก้ว'), 'พี่ แก้ว');
});

// ── (บังคับ — ผลตรวจรอบ 2 ข้อ 2) ชื่อมีวงเล็บ → ใช้ชื่อเล่น/ไม่มีวงเล็บค้าง ──
await test('[ผู้ตรวจ #2] circleLabelText: ชื่อมีวงเล็บ+ชื่อเล่น "จุน วนวิทย์ (อากงจุน)" → ใช้ชื่อเล่นในวงเล็บ', async () => {
  assert.equal(circleLabelText('จุน วนวิทย์ (อากงจุน)'), 'อากงจุน');
});

await test('[ผู้ตรวจ #2] circleLabelText: วงเล็บมีแต่คำบทบาท "น้องเบล (ผู้ถูกสัมภาษณ์)" → ผลลัพธ์ไม่มีวงเล็บค้าง (และไม่ผ่าน เพราะเป็น generic)', async () => {
  const r = circleLabelText('น้องเบล (ผู้ถูกสัมภาษณ์)');
  // "ผู้ถูกสัมภาษณ์" ถูกใช้เป็นชื่อเล่นตามกติกาถอดวงเล็บ แล้วโดนตัวกรอง generic ดักไว้ทันที (ผลคือ null)
  assert.equal(r, null);
});

await test('[ผู้ตรวจ #2] circleLabelText: ไม่มีวงเล็บเปิดค้างเด็ดขาด แม้อินพุตวงเล็บซ้อน/ไม่บาลานซ์', async () => {
  const cases = ['(((  )))', '((เอ))', 'ชื่อ (ไม่ปิด', 'ชื่อ) ปิดไม่มีเปิด', '((( ก )))'];
  for (const c of cases) {
    const r = circleLabelText(c);
    if (r != null) assert.ok(!/[()（）]/.test(r), `ผลลัพธ์ของ "${c}" ห้ามมีวงเล็บหลงเหลือ (ได้ "${r}")`);
  }
  assert.equal(circleLabelText('((( ก )))'), 'ก', 'วงเล็บซ้อนรอบเนื้อหาแท้ๆ ยังต้องดึงชื่อออกมาได้');
});

// ── (บังคับ — ผลตรวจรอบ 2 ข้อ 2) บัญชีดำคำบรรยาย generic ──
await test('[ผู้ตรวจ #3] circleLabelText: คำบรรยาย generic (เพศ/วัย/บทบาท) → คืน null ไม่วาด', async () => {
  const genericCases = ['หญิงสาวในคลิป', 'ชายหนุ่มคนหนึ่ง', 'เด็กหญิงตัวน้อย', 'เด็กชายวัย 8 ขวบ', 'ในคลิปนี้', 'ชาวบ้านแถวนั้น', 'ผู้ถูกสัมภาษณ์', 'ผู้เสียหาย', 'เจ้าของร้าน', 'ลูกสาวของเธอ', 'ลูกชายคนโต', 'คุณแม่ของน้อง', 'คุณพ่อของเด็ก', 'พิธีกร'];
  for (const c of genericCases) assert.equal(circleLabelText(c), null, `"${c}" ต้องเป็น null (คำบรรยาย generic ไม่ใช่ชื่อจริง)`);
});

await test('[ผู้ตรวจ #3] circleLabelText: ขึ้นต้นด้วยคำเพศ/วัยกว้างๆ (หญิง/ชาย/เด็ก/ผู้) → คืน null', async () => {
  for (const c of ['หญิงไม่ทราบชื่อ', 'ชายในเหตุการณ์', 'เด็กที่ยืนอยู่', 'ผู้พบเห็นเหตุการณ์']) {
    assert.equal(circleLabelText(c), null, `"${c}" ต้องเป็น null`);
  }
});

await test('circleLabelText: ชื่อจริงที่ไม่ตรงบัญชีดำ ต้องผ่านปกติ (ไม่ถูกกรองเกินจำเป็น)', async () => {
  assert.equal(circleLabelText('อภิสิทธิ์ วีระประวัติ'), 'อภิสิทธิ์ วีระประวัติ');
  assert.equal(circleLabelText('สมชาย ใจดี'), 'สมชาย ใจดี');
});

// ═══════════════════════ (1b) buildCircleLabelSvg — PURE unit: เรขาคณิต/fontSize ═══════════════════════

await test('buildCircleLabelSvg: มีชื่อจริง + diameter ถูกต้อง → คืน SVG buffer ที่ rasterize ได้จริง', async () => {
  const svg = buildCircleLabelSvg('พี่แก้ว', 300);
  assert.ok(Buffer.isBuffer(svg));
  const png = await sharp(svg).png().toBuffer();
  assert.ok(png.length > 0);
  const text = svg.toString('utf8');
  assert.ok(text.includes('&quot;พี่แก้ว&quot;'), 'ต้องมีชื่อในเครื่องหมายคำพูด (escaped)');
  assert.ok(/Sarabun/.test(text), 'ต้องระบุ font ตระกูลไทย');
});

await test('buildCircleLabelSvg: ไม่มีชื่อ (null/ว่าง/generic) → คืน null (ห้ามเดา/ห้ามมโนชื่อ ไม่วาดป้าย)', async () => {
  assert.equal(buildCircleLabelSvg(null, 300), null);
  assert.equal(buildCircleLabelSvg('', 300), null);
  assert.equal(buildCircleLabelSvg('   ', 300), null);
  assert.equal(buildCircleLabelSvg('พิธีกร', 300), null);
});

await test('buildCircleLabelSvg: diameter ไม่ถูกต้อง (0/NaN/ติดลบ) → คืน null ไม่ throw', async () => {
  assert.equal(buildCircleLabelSvg('พี่แก้ว', 0), null);
  assert.equal(buildCircleLabelSvg('พี่แก้ว', NaN), null);
  assert.equal(buildCircleLabelSvg('พี่แก้ว', -50), null);
});

await test('buildCircleLabelSvg: ชื่อยาว → fontSize ถูกลดสัดส่วนลง (เทียบกับชื่อสั้นที่ diameter เดียวกัน)', async () => {
  const shortSvg = buildCircleLabelSvg('พี่แก้ว', 300).toString('utf8');
  const longSvg = buildCircleLabelSvg('สมชาย ใจดีมากมายเหลือเกินจริงๆนะจ๊ะ', 300).toString('utf8');
  const fontOf = (s) => Number(s.match(/font-size="(\d+)"/)[1]);
  assert.ok(fontOf(longSvg) < fontOf(shortSvg), `ชื่อยาวต้อง fontSize เล็กกว่าชื่อสั้น (ยาว=${fontOf(longSvg)} สั้น=${fontOf(shortSvg)})`);
});

// ═══════════════════════ (2) buildCircleLabelOverlay — masked PNG: การันตี ink ไม่หลุดนอกวงระดับพิกเซล ═══════════════════════

await test('[ผู้ตรวจ #1] buildCircleLabelOverlay: ชื่อสั้น → ink 0% นอกวง', async () => {
  const d = 300;
  const png = await buildCircleLabelOverlay('พี่แก้ว', d);
  const { total, outside } = await inkOutsideCircleStats(png, d);
  assert.ok(total > 0, 'ต้องมี ink จริง (วาดป้ายสำเร็จ)');
  assert.equal(outside, 0, `ink ต้องไม่มีจุดใดหลุดนอกวงเลย (ได้ ${outside}/${total})`);
});

await test('[ผู้ตรวจ #1] buildCircleLabelOverlay: ชื่อยาว 14 ตัวอักษร → rasterize แล้ว ink ต้องไม่หลุดนอกวง (เคสที่เคยล้น 18-26%)', async () => {
  const d = 300;
  const name14 = 'วรรณิศาใจดีงาม'; // 14 ตัวอักษรพอดี (ไม่รวมช่องว่าง/เครื่องหมาย)
  assert.equal([...name14].length, 14, `fixture ต้องยาวพอดี 14 ตัวอักษร (ได้ ${[...name14].length})`);
  const png = await buildCircleLabelOverlay(name14, d);
  const { total, outside } = await inkOutsideCircleStats(png, d);
  assert.ok(total > 0);
  assert.equal(outside, 0, `ชื่อ 14 ตัวอักษร ink ต้องไม่หลุดนอกวงเลย (ได้ ${outside}/${total} = ${((outside / total) * 100).toFixed(1)}%) — บั๊กเดิมล้น 18-26%`);
});

await test('[ผู้ตรวจ #1] buildCircleLabelOverlay: ชื่อยาวมากผิดปกติ (30+ ตัวอักษร) ที่วงเล็กมาก → ยัง ink 0% นอกวง', async () => {
  const d = 150; // วงเล็กกว่าเดิม (ทดสอบเคสกดดันที่สุด)
  const png = await buildCircleLabelOverlay('สมชาย ใจดีมากมายเหลือเกินจริงๆนะจ๊ะไม่ล้อเล่น', d);
  const { total, outside } = await inkOutsideCircleStats(png, d);
  assert.ok(total > 0);
  assert.equal(outside, 0, `ได้ ${outside}/${total} ink นอกวง`);
});

await test('buildCircleLabelOverlay: ไม่มีชื่อ/ชื่อ generic → คืน null (ไม่วาด)', async () => {
  assert.equal(await buildCircleLabelOverlay(null, 300), null);
  assert.equal(await buildCircleLabelOverlay('ผู้เสียหาย', 300), null);
});

// ═══════════════════════ (3) composeAndVerify integration — parity ระดับผลประกอบจริง ═══════════════════════

// สร้างภาพ noise 800x1000 สด (>5000 bytes แน่นอน, ผ่านด่านไฟล์จิ๋ว/ด่านไบต์ในโค้ดจริง) → data: URI (fetchOne
//   จัดการ data: URL ในตัวอยู่แล้ว ไม่ต้อง mock fetch/network เลย)
async function makeDataUri(seed) {
  const buf = await sharp({
    create: { width: 800, height: 1000, channels: 3, noise: { type: 'gaussian', mean: 128 + seed, sigma: 40 } },
  }).jpeg({ quality: 90 }).toBuffer();
  assert.ok(buf.length > 5000, `fixture ต้อง >5000 bytes (ได้ ${buf.length}) ไม่งั้นโดนด่านไฟล์จิ๋วตัดทิ้ง`);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// ★ deterministic assignment: ไม่มีตาหาหน้า (stub Map ว่าง) → heroScore=0 ทุกใบ → mi ตัดสินด้วย isHero ล้วน
//   (loaded[0].isHero=true) → main=loaded[0] แน่นอน · circle loop ตกไป pickIdx(()=>true) (ไม่มีเงื่อนไขหน้า
//   ผ่านได้เลย) → ได้ตัวแรกที่ยังไม่ถูกใช้ = loaded[1] แน่นอน (pickIdx ไล่ index น้อย→มาก) → circle=loaded[1] เสมอ
async function buildSlotPlan(circlePersonName) {
  const urls = await Promise.all([0, 1, 2, 3].map((i) => makeDataUri(i * 10)));
  return urls.map((url, i) => ({
    url, thumbnailUrl: '', isHero: i === 0, person: i === 1 ? (circlePersonName ?? null) : null,
    clean: true, newsScene: true, faces: 0, slot: null,
  }));
}

await test('เตรียมพูล 4 ใบ (isHero + person ที่ index 1) → ยืนยันได้โครงที่มีวงกลม (spec.id + manifest.slots มี shape=circle)', async () => {
  setEnv('MEGA_CIRCLE_LABEL', null); // default ON
  const slotPlan = await buildSlotPlan('พี่แก้ว');
  const out = await composeAndVerify({ newsTitle: 'ข่าวทดสอบป้ายวงกลม', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(out.success, true, `compose ต้องสำเร็จ (error: ${out.error || '-'})`);
  const circleSlot = (out.manifest?.slots || []).find((s) => s.shape === 'circle');
  assert.ok(circleSlot, 'โครงที่เลือกต้องมีช่องวงกลม (vt_ref_5x4/vt_faces_circle/vt_ref_tri)');
  console.log(`   (โครงที่ใช้จริง: ${out.template})`);
});

await test('parity: MEGA_CIRCLE_LABEL=0 (ปิด) → เรียกซ้ำพูลเดิมเป๊ะ (data: URI เดียวกันทุก byte) ได้ buffer เหมือนกัน (deterministic)', async () => {
  setEnv('MEGA_CIRCLE_LABEL', '0');
  const planNamed = await buildSlotPlan('พี่แก้ว'); // สร้างครั้งเดียว — reuse object เดิมทั้งสองรอบ (ห้ามสร้าง noise ใหม่ ไม่งั้นภาพต้นทางไม่ตรงกันเอง)
  const outOffA = await composeAndVerify({ newsTitle: 'x', slotPlan: planNamed, refDNA: null, refImagePath: null, stableOrder: true });
  const outOffB = await composeAndVerify({ newsTitle: 'x', slotPlan: planNamed, refDNA: null, refImagePath: null, stableOrder: true }); // เรียกซ้ำพูลเดิมเป๊ะ (เดียวกันทุก byte)
  assert.equal(outOffA.success, true);
  assert.equal(outOffB.success, true);
  assert.equal(outOffA.manifest.outputHash, outOffB.manifest.outputHash, 'ปิดสวิตช์: เรียกซ้ำ input เดียวกัน (พูลเดียวกันทุก byte) ต้องได้ buffer เหมือนกันเป๊ะ (deterministic, ไม่มีป้ายแทรก)');
});

await test('integration: MEGA_CIRCLE_LABEL เปิด (default) + รู้ชื่อจริง → buffer เปลี่ยนจากกรณีปิดสวิตช์ (ป้ายถูกวาดจริง)', async () => {
  const slotPlan = await buildSlotPlan('พี่แก้ว');
  setEnv('MEGA_CIRCLE_LABEL', '0');
  const outOff = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  setEnv('MEGA_CIRCLE_LABEL', null); // default ON
  const outOn = await composeAndVerify({ newsTitle: 'x', slotPlan, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(outOff.success, true);
  assert.equal(outOn.success, true);
  assert.notEqual(outOn.manifest.outputHash, outOff.manifest.outputHash, 'เปิดสวิตช์ + รู้ชื่อ ต้องได้ buffer ต่างจากปิดสวิตช์ (ป้ายถูกวาดจริงลงพิกเซล)');
});

await test('integration: เปิดสวิตช์แต่ "ไม่รู้ชื่อ" (person=null ที่ index วงกลม) → buffer เหมือนปิดสวิตช์เป๊ะ (ห้ามเดา/ห้ามมโนชื่อ)', async () => {
  const slotPlanUnnamed = await buildSlotPlan(null); // index 1 (จะได้ช่องวงกลม) person=null
  setEnv('MEGA_CIRCLE_LABEL', '0');
  const outOff = await composeAndVerify({ newsTitle: 'x', slotPlan: slotPlanUnnamed, refDNA: null, refImagePath: null, stableOrder: true });
  setEnv('MEGA_CIRCLE_LABEL', null); // default ON
  const outOn = await composeAndVerify({ newsTitle: 'x', slotPlan: slotPlanUnnamed, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(outOff.success, true);
  assert.equal(outOn.success, true);
  assert.equal(outOn.manifest.outputHash, outOff.manifest.outputHash, 'ไม่รู้ชื่อ = ไม่วาดป้าย แม้สวิตช์เปิด — buffer ต้องเหมือนปิดสวิตช์เป๊ะ');
});

await test('integration: person เป็นคำบรรยาย generic ("ผู้เสียหาย") → buffer เหมือนปิดสวิตช์เป๊ะ (กรองก่อนวาด)', async () => {
  const slotPlanGeneric = await buildSlotPlan('ผู้เสียหาย');
  setEnv('MEGA_CIRCLE_LABEL', '0');
  const outOff = await composeAndVerify({ newsTitle: 'x', slotPlan: slotPlanGeneric, refDNA: null, refImagePath: null, stableOrder: true });
  setEnv('MEGA_CIRCLE_LABEL', null); // default ON
  const outOn = await composeAndVerify({ newsTitle: 'x', slotPlan: slotPlanGeneric, refDNA: null, refImagePath: null, stableOrder: true });
  assert.equal(outOff.success, true);
  assert.equal(outOn.success, true);
  assert.equal(outOn.manifest.outputHash, outOff.manifest.outputHash, 'person="ผู้เสียหาย" เป็นคำบรรยาย generic — ต้องไม่วาดป้าย (buffer เหมือนปิดสวิตช์)');
});

// ═══════════════════════ (4) [ผู้ตรวจ #4] สายสตริกต์ (MEGA_STRICT_RENDER=1) ต้องปิดป้ายเสมอ ═══════════════════════

// fnv1a32 — คัดลอกจาก src/lib/refSlotContract.js เป๊ะ (ฟังก์ชัน private ในนั้น) เพื่อคำนวณ hash ที่
//   validateStrictRenderActivation (V1) ต้องการให้ตรง — ไม่ import ข้ามเพราะไม่ได้ export
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// สร้าง payload strict V1 ขั้นต่ำที่ valid จริง (selectionSpec + realizedTemplate + slotPlan ตรงสัญญา
//   validateStrictRenderActivation ทุกข้อ) — 4 ช่อง (main/right_top/right_bottom/circle) ไม่มี refDNA/scoring
//   เกี่ยวข้องเลย (strict = ผูกตรง 1:1 จาก authority) — person ของช่องวงกลมกำหนดได้ผ่าน circlePersonName
async function buildStrictArgs(circlePersonName) {
  const urls = await Promise.all([0, 1, 2, 3].map((i) => makeDataUri(200 + i * 10))); // seed แยกจากชุด legacy กันชนแคช
  const refId = 'TESTREF-strict-001';
  const meta = [
    { refSlotId: 'r_main', composerSlotId: 'main', shape: 'rect' },
    { refSlotId: 'r_top', composerSlotId: 'right_top', shape: 'rect' },
    { refSlotId: 'r_bottom', composerSlotId: 'right_bottom', shape: 'rect' },
    { refSlotId: 'r_circle', composerSlotId: 'circle', shape: 'circle' },
  ];
  const specSlots = meta.map((s, i) => ({
    mappingMode: 'ref_slot_exact', refSlotId: s.refSlotId, composerSlotId: s.composerSlotId,
    shape: s.shape, primary: { candidateId: `cand_${i}`, imageUrl: urls[i] }, backups: [],
  }));
  const identity = specSlots.map((s) => [s.refSlotId, s.composerSlotId, s.primary.candidateId]);
  const specHash = fnv1a32(JSON.stringify({ refId, identity }));
  const backupPoolHash = fnv1a32(JSON.stringify(specSlots.map((s) => [s.refSlotId, []])));
  const replayHash = fnv1a32(JSON.stringify({
    refId, identity,
    urls: specSlots.map((s) => s.primary.imageUrl),
    backups: specSlots.map((s) => [s.refSlotId, []]),
  }));
  const selectionSpec = {
    v: 1, mode: 'ref_slot_exact', source: 'template.slots', refId, strictReady: true,
    slots: specSlots, specHash, backupPoolHash, replayHash,
    counts: { total: 4, mapped: 4, unmapped: 0, missingPrimary: 0, duplicatePrimary: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 },
    diagnostics: { extraPlannedKeys: [], invalidPrimary: [], aliasPrimaryUrls: [], duplicateBackupsDropped: [] },
  };
  const realizedTemplate = {
    id: 'strict_test_tpl', canvasW: 1080, canvasH: 1350,
    slots: [
      { id: 'main', x: 0, y: 0, w: 616, h: 1350 },
      { id: 'right_top', x: 616, y: 0, w: 464, h: 540 },
      { id: 'right_bottom', x: 616, y: 540, w: 464, h: 810 },
      { id: 'circle', x: 34, y: 940, w: 380, h: 380, shape: 'circle' },
    ],
  };
  const slotPlan = specSlots.map((s, i) => ({
    url: s.primary.imageUrl, refSlotId: s.refSlotId, thumbnailUrl: '',
    person: i === 3 ? (circlePersonName ?? null) : null, // index 3 = circle
    clean: true, newsScene: true, faces: 0,
  }));
  return { selectionSpec, realizedTemplate, slotPlan };
}

await test('[ผู้ตรวจ #4] สายสตริกต์ (MEGA_STRICT_RENDER=1): ป้ายวงกลมต้องถูกปิดเสมอ แม้ MEGA_CIRCLE_LABEL เปิด + รู้ชื่อจริง', async () => {
  const { selectionSpec, realizedTemplate, slotPlan } = await buildStrictArgs('พี่แก้ว');
  try {
    setEnv('MEGA_CIRCLE_LABEL', null); // default ON — ตั้งใจเปิดไว้ ให้เห็นว่า strict ยังปิดป้ายได้แม้สวิตช์เปิด
    process.env.MEGA_STRICT_RENDER = '1';
    const outLabelOn = await composeAndVerify({ newsTitle: 'x', selectionSpec, realizedTemplate, slotPlan });
    assert.equal(outLabelOn.success, true, `strict compose ต้องสำเร็จ (error: ${outLabelOn.error || '-'} reasons=${JSON.stringify(outLabelOn.reasons || [])})`);
    const circleSlot = (outLabelOn.manifest?.slots || []).find((s) => s.shape === 'circle');
    assert.ok(circleSlot, 'ต้องมีช่องวงกลมในผลลัพธ์ strict');

    setEnv('MEGA_CIRCLE_LABEL', '0'); // ปิดสวิตช์เทียบ — คาดว่า "เหมือนกันเป๊ะ" เพราะ strict ปิดป้ายเองอยู่แล้วไม่ว่า MEGA_CIRCLE_LABEL จะตั้งอย่างไร
    const outLabelOff = await composeAndVerify({ newsTitle: 'x', selectionSpec, realizedTemplate, slotPlan });
    assert.equal(outLabelOff.success, true, `strict compose (label off) ต้องสำเร็จ (error: ${outLabelOff.error || '-'})`);
    assert.equal(outLabelOn.manifest.outputHash, outLabelOff.manifest.outputHash, 'strict: MEGA_CIRCLE_LABEL เปิด/ปิด ต้องได้ buffer เหมือนกันเป๊ะ (ป้ายถูกปิดเสมอในสายสตริกต์ ไม่ขึ้นกับสวิตช์)');
  } finally {
    delete process.env.MEGA_STRICT_RENDER;
    setEnv('MEGA_CIRCLE_LABEL', null);
  }
});

console.log(`\n1..${passed}`);
