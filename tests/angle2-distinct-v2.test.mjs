// 🎚️ ข้อสอบ ANGLE2_DISTINCT_V2 — มุม 2 ต้องต่างจริง (2 ก.ย. 69 — จากเทสสนามจริงเคสศรราม: ย่อหน้ากลาง 2 เวอร์ชันซ้ำเกือบคำต่อคำ 38–42%
//   เพราะ 2 มุมเขียนขนานกัน แกนจอง (_reservedOpeningAngles) กันแค่ประโยคแรก)
//   ค่าเริ่มต้นเปิด · ปิดคืน ANGLE2_DISTINCT_V2=0 (รับเฉพาะ '0' ตรงตัว) = ไม่เติมข้อความ/ไม่ติดตัวเลขความคล้าย → พฤติกรรมเดิมทุกไบต์
// autoFlowServiceText ลาก import '@/…' เป็นลูกโซ่ → ดึงบล็อกฟังก์ชันบริสุทธิ์ (ใช้แค่ process.env + Intl) มาประเมินแยก (แบบ tests/opening-contract-switches)
//   + ดึง "บล็อกคำนวณแผน" ตัวจริงในตัว processAutoFlowText (plan start/end) มารันกับ stub ที่ throw = พิสูจน์ fail-open ด้วยพฤติกรรม ไม่ใช่ค้นคำ
// รัน: node --test tests/angle2-distinct-v2.test.mjs
// 🔨 ผลการทุบโค้ดจริงในไฟล์ (2 ก.ย. 69 รอบแรก — ทุบทีละข้อ รันเทส แล้วคืนไฟล์ไบต์ต่อไบต์ · ฐานก่อนทุบ 9/9 เขียว):
//   1) ทุบ `(owner[pi] === ai ? slot.primary : slot.secondary).push(p.label)` → `slot.primary.push(p.label)` (ทุกมุมได้ทุกประเด็น) → 🔴 แดง 6/9 (จัดสรรไม่ซ้ำ · ทุกมุมได้ ≥1 · ข้อความล้วน · มุมเดียว · รูปแบบข้อความ · mutation)
//   2) ทุบ `if (!isAngle2DistinctV2Enabled()) return '';` ออกจาก buildAnglePointsText → 🔴 แดง 2/9 (สวิตช์ 0 · mutation)
//   3) ทุบ `focusAngle: writeAngleWithPoints,` กลับเป็น `focusAngle: writeAngle,` → 🔴 แดง 1/9 (wiring)
//   4) ทุบ `if (isAngle2DistinctV2Enabled()) finalVersions = stampDiversitySimilarity(finalVersions, postFactDiversity);` ออก → 🔴 แดง 1/9 (wiring — นับได้ 1 ไม่ใช่ 2)
// 🔨 รอบแก้ตามผู้ตรวจไขว้ (2 ก.ย. 69 — ฐานก่อนทุบ 12/12 เขียว · ทุบทีละข้อในไฟล์จริง รันเทส แล้วคืนไฟล์):
//   5) ทุบ `if (own.length === 0) return '';` ออกจาก buildAnglePointsText → 🔴 แดง 2/12 (มุม > ประเด็น · mutation)
//   6) ทุบ dedupe ใน assignKeyPointsToAngles `.filter((p, i, all) => all.findIndex(q => q.label === p.label) === i)` ออก → 🔴 แดง 2/12 (ป้ายซ้ำ · mutation)
//   7) ทุบ `_anglePointPlan = null;` ใน catch ออก → 🔴 แดง 2/12 (fail-open · mutation) · ทุบ catch ให้ `throw planErr` → 🔴 แดง 2/12 (fail-open · mutation)
//   8) ทุบ `uniqueLabels(me.primary)` → `(Array.isArray(me.primary) ? me.primary : []).filter(Boolean)` (ไม่กรองซ้ำฝั่งข้อความ) → 🔴 แดง 2/12 (ป้ายซ้ำ · mutation)
//   คืนโค้ดแล้ว 12/12 เขียว · ข้อ 1–2, 5–8 มีสำเนา mutation อัตโนมัติอยู่ท้ายไฟล์นี้ด้วย
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const START = '// ── ANGLE2_DISTINCT_V2 block start ──';
const END = '// ── ANGLE2_DISTINCT_V2 block end ──';
const PLAN_START = '// ── ANGLE2_DISTINCT_V2 plan start ──';
const PLAN_END = '// ── ANGLE2_DISTINCT_V2 plan end ──';

function makeBlock(env = {}, source = SRC) {
  const s = source.indexOf(START);
  const e = source.indexOf(END, s);
  assert.ok(s >= 0 && e > s, 'ต้องพบบล็อก ANGLE2_DISTINCT_V2 ตัวจริงในซอร์ส');
  const slice = source.slice(s, e).replace(/export (const|function) /g, '$1 ');
  return new Function(
    'process',
    `${slice}\nreturn { isAngle2DistinctV2Enabled, tokenizeThaiWords, assignKeyPointsToAngles, buildAnglePointsText, stampDiversitySimilarity };`,
  )({ env });
}

/** รัน "บล็อกคำนวณแผน" ตัวจริงจากใน processAutoFlowText (ระหว่าง plan start/end) ด้วยของปลอมที่ควบคุมได้ — คืน { plan, logs } */
function runPlanBlock({ enabled = true, assign, build, breakdownData, anglesToUse, source = SRC }) {
  const s = source.indexOf(PLAN_START);
  const e = source.indexOf(PLAN_END, s);
  assert.ok(s >= 0 && e > s, 'ต้องพบบล็อกคำนวณแผน (plan start/end) ตัวจริงในซอร์ส');
  const api = makeBlock({}, source);
  const logs = [];
  const plan = new Function(
    'isAngle2DistinctV2Enabled', 'assignKeyPointsToAngles', 'buildAnglePointsText', 'breakdownData', 'anglesToUse', 'addLog',
    `${source.slice(s, e)}\nreturn _anglePointPlan;`,
  )(() => enabled, assign || api.assignKeyPointsToAngles, build || api.buildAnglePointsText, breakdownData, anglesToUse, (step, msg) => logs.push({ step, msg }));
  return { plan, logs };
}

// ── ข้อมูลจริงจาก breakdown เคสศรราม (C:\tmp\news-r233-run\result-run1.json) ──
const ANGLES = [
  {
    angle_name: 'พ่อที่เลี้ยงลูกเหมือนเพื่อน ผ่านเวลาธรรมดาที่ลูกยังจำ',
    description: 'เล่าความสัมพันธ์ของศรรามกับป๋าเดียร์ผ่านกิจกรรมตั้งแต่วัยเด็ก ทั้งไปกองถ่าย เล่นน้ำ ซื้อเนื้อ ทำอาหารเช้า และพูดคุยระหว่างนั่งรถไปโรงเรียน ก่อนวางคำว่า “ป๋าเหมือนเพื่อนเรา” เป็นแกนของเรื่อง',
  },
  {
    angle_name: 'เวลาอยู่ด้วยกันไม่มาก แต่ความห่วงใยยังมาถึงผ่านสายโทรศัพท์',
    description: 'โฟกัสช่วงที่ป๋าเดียร์ทำงานในวงการบันเทิงและมีเวลาอยู่กับลูกไม่มาก แต่พ่อกับลูกยังโทรหากันเป็นประจำ โดยพ่อมักห่วงเรื่องการขับรถและถามตอนกลางคืนว่าถ่ายละครเสร็จหรือยัง',
  },
];
const KEY_POINTS = [
  { point: 'พ่อเลี้ยงลูกเหมือนเพื่อน', detail: 'ป๋าเดียร์เลี้ยงศรรามแบบลูกผู้ชาย พูดคุยกันตรง ๆ และใช้เวลาทำกิจกรรมร่วมกันตั้งแต่เขายังเด็ก' },
  { point: 'สอนลูกด้วยการอธิบายเหตุผล', detail: 'เมื่อศรรามมีปัญหาเรื่องเพื่อน การเรียน หรือทำผิด ป๋าเดียร์จะเลือกพูดคุยและอธิบายเหตุผล พร้อมสอนสัมมาคารวะ ระเบียบวินัย และการตรงต่อเวลา' },
  { point: 'บทเรียนอยู่ในกิจวัตรธรรมดา', detail: 'ป๋าเดียร์พาศรรามไปซื้อเนื้อ ทำอาหารเช้าให้หลังเล่นกีฬา และเล่าเรื่องต่าง ๆ ระหว่างนั่งรถไปโรงเรียน' },
  { point: 'ความห่วงใยผ่านสายโทรศัพท์', detail: 'พ่อกับลูกโทรหากันเป็นประจำ ป๋าเดียร์มักเป็นห่วงเรื่องการขับรถ และโทรถามตอนกลางคืนว่าศรรามถ่ายละครเสร็จหรือยัง' },
  { point: 'เวลาอยู่ด้วยกันสำคัญกว่าสิ่งของ', detail: 'ศรรามเคยรู้สึกว่าได้พบแม่บ่อยกว่าพ่อ แต่ให้ความสำคัญกับเวลาที่ได้อยู่กับพ่อมากกว่าสิ่งของที่พ่อซื้อให้' },
];
const LABELS = KEY_POINTS.map(kp => kp.point);

function assertDistinctPlan(plan, angles = ANGLES, labels = LABELS) {
  assert.equal(plan.length, angles.length, 'แผนต้องยาวเท่าจำนวนมุม');
  const allPrimary = plan.flatMap(slot => slot.primary);
  assert.deepEqual([...allPrimary].sort(), [...labels].sort(), 'ทุกประเด็นต้องเป็น primary ของมุมใดมุมหนึ่ง ครบและไม่ซ้ำ');
  assert.equal(new Set(allPrimary).size, labels.length, 'ประเด็นเดียวห้ามเป็น primary ของ 2 มุม');
  plan.forEach((slot, i) => {
    assert.ok(slot.primary.length >= 1, `มุม ${i + 1} ต้องมีประเด็นให้เล่าเต็มอย่างน้อย 1`);
    const others = labels.filter(label => !slot.primary.includes(label));
    assert.deepEqual(slot.secondary, others, `secondary ของมุม ${i + 1} = ประเด็นที่มุมอื่นเล่าเต็ม (ตามลำดับเดิม)`);
    for (const label of slot.primary) assert.ok(!slot.secondary.includes(label), 'primary กับ secondary ห้ามซ้อนกัน');
  });
}

test('จัดสรรไม่ซ้ำ: ประเด็นหนึ่งเป็น primary ได้มุมเดียว · secondary = primary ของมุมอื่น · ประเด็นเข้ามุมที่คำทับซ้อนมากสุด', () => {
  const { assignKeyPointsToAngles } = makeBlock();
  const plan = assignKeyPointsToAngles(KEY_POINTS, ANGLES);
  assertDistinctPlan(plan);
  assert.ok(plan[0].primary.includes('พ่อเลี้ยงลูกเหมือนเพื่อน'), 'มุม "เลี้ยงลูกเหมือนเพื่อน" ต้องได้ประเด็นเลี้ยงลูกเหมือนเพื่อน');
  assert.ok(plan[0].primary.includes('บทเรียนอยู่ในกิจวัตรธรรมดา'), 'มุม "เวลาธรรมดา" ต้องได้ประเด็นกิจวัตรธรรมดา');
  assert.ok(plan[1].primary.includes('ความห่วงใยผ่านสายโทรศัพท์'), 'มุม "สายโทรศัพท์" ต้องได้ประเด็นสายโทรศัพท์');
  assert.ok(plan[0].primary.length >= 2 && plan[1].primary.length >= 2, '5 ประเด็น 2 มุม ต้องแบ่งกันอย่างน้อยมุมละ 2 (ไม่กองมุมเดียว)');
});

test('ทุกมุมต้องได้ประเด็นอย่างน้อย 1 แม้ประเด็นทั้งหมดเข้ามุมเดียว', () => {
  const { assignKeyPointsToAngles } = makeBlock();
  const plan = assignKeyPointsToAngles(
    ['พ่อเลี้ยงลูกเหมือนเพื่อน', 'พ่อกับลูกเป็นเพื่อนกัน', 'ลูกจำพ่อได้'],
    ['พ่อเลี้ยงลูกเหมือนเพื่อน: เพื่อน', 'สายโทรศัพท์: โทรศัพท์'],
  );
  assertDistinctPlan(plan, [0, 1], ['พ่อเลี้ยงลูกเหมือนเพื่อน', 'พ่อกับลูกเป็นเพื่อนกัน', 'ลูกจำพ่อได้']);
  assert.equal(plan[1].primary.length, 1);
});

test('key_points แบบข้อความล้วน (โหมดอื่นของ breakdown) และของว่าง/ผิดรูป ไม่พัง', () => {
  const { assignKeyPointsToAngles, buildAnglePointsText } = makeBlock();
  const plan = assignKeyPointsToAngles(['ความห่วงใยผ่านสายโทรศัพท์', 'พ่อเลี้ยงลูกเหมือนเพื่อน'], ANGLES);
  assertDistinctPlan(plan, ANGLES, ['ความห่วงใยผ่านสายโทรศัพท์', 'พ่อเลี้ยงลูกเหมือนเพื่อน']);
  assert.ok(plan[1].primary.includes('ความห่วงใยผ่านสายโทรศัพท์'));
  assert.deepEqual(assignKeyPointsToAngles(undefined, ANGLES), [{ primary: [], secondary: [] }, { primary: [], secondary: [] }]);
  assert.deepEqual(assignKeyPointsToAngles(KEY_POINTS, null), []);
  assert.deepEqual(assignKeyPointsToAngles([null, {}, ''], ANGLES), [{ primary: [], secondary: [] }, { primary: [], secondary: [] }]);
  assert.equal(buildAnglePointsText(undefined, 0), '');
  assert.equal(buildAnglePointsText(null, 0), '');
});

test('มุมเดียว → ไม่เติมอะไร (เดิม) · ประเด็น < 2 → ไม่เติม', () => {
  const { assignKeyPointsToAngles, buildAnglePointsText } = makeBlock();
  const single = assignKeyPointsToAngles(KEY_POINTS, ANGLES.slice(0, 1));
  assert.equal(single.length, 1);
  assert.equal(single[0].primary.length, KEY_POINTS.length);
  assert.equal(buildAnglePointsText(single, 0), '');
  const onePoint = assignKeyPointsToAngles(KEY_POINTS.slice(0, 1), ANGLES);
  assert.equal(buildAnglePointsText(onePoint, 0), '');
  assert.equal(buildAnglePointsText(onePoint, 1), '');
  assert.equal(buildAnglePointsText(assignKeyPointsToAngles([], ANGLES), 0), '');
});

test('มุม > ประเด็น (GEN_ANGLES=3 กับ 2 ประเด็น): มุมที่ไม่มีประเด็นให้เล่าเต็ม = ไม่เติมข้อความ (ห้ามสั่งนักเขียน "ย่อ/ข้ามทุกประเด็น")', () => {
  const { assignKeyPointsToAngles, buildAnglePointsText } = makeBlock();
  const three = [...ANGLES, { angle_name: 'มุมที่สาม', description: 'มุมสำรองที่ไม่มีประเด็นตรงตัว' }];
  const plan = assignKeyPointsToAngles(KEY_POINTS.slice(3, 5), three);
  assert.equal(plan.length, 3);
  const empty = plan.findIndex(slot => slot.primary.length === 0);
  assert.ok(empty >= 0, '2 ประเด็น 3 มุม → ต้องมีมุมที่ primary ว่าง (ย้ายได้เฉพาะจากมุมที่มี ≥2)');
  assert.equal(plan[empty].secondary.length, 2, 'มุมว่างเห็นประเด็นของมุมอื่นครบ 2');
  assert.equal(buildAnglePointsText(plan, empty), '', 'มุมว่าง = ไม่เติมอะไร (เหมือนสวิตช์ปิด) ไม่ใช่ "ย่อ/ข้าม: ทุกประเด็น"');
  let filled = 0;
  plan.forEach((slot, i) => {
    const text = buildAnglePointsText(plan, i);
    if (slot.primary.length === 0) return;
    filled += 1;
    assert.ok(text.startsWith(`ประเด็นที่มุมนี้ต้องเล่าเต็ม: ${slot.primary[0]}`), `มุม ${i + 1} ที่มีประเด็นยังได้ข้อความปกติ`);
  });
  assert.equal(filled, 2);
  for (let i = 0; i < 3; i++) assert.equal(buildAnglePointsText(plan, i).startsWith('ประเด็นที่มุมอื่น'), false, 'ข้อความถึงนักเขียนต้องไม่ขึ้นต้นด้วย "ประเด็นที่มุมอื่น…" (= ไม่มีของตัวเอง)');
});

test('ป้ายซ้ำ: key_points ซ้ำกันนับเป็นประเด็นเดียว · แผน/ข้อความไม่มี "ซ้ำ | ซ้ำ" · แผนทำมือที่มีป้ายซ้ำ/ช่องว่างก็ถูกกรอง', () => {
  const { assignKeyPointsToAngles, buildAnglePointsText } = makeBlock();
  const plan = assignKeyPointsToAngles(
    ['ความห่วงใยผ่านสายโทรศัพท์', 'ความห่วงใยผ่านสายโทรศัพท์', { point: 'พ่อเลี้ยงลูกเหมือนเพื่อน' }, 'พ่อเลี้ยงลูกเหมือนเพื่อน', ' ความห่วงใยผ่านสายโทรศัพท์ '],
    ANGLES,
  );
  assertDistinctPlan(plan, ANGLES, ['ความห่วงใยผ่านสายโทรศัพท์', 'พ่อเลี้ยงลูกเหมือนเพื่อน']);
  plan.forEach((slot, i) => {
    assert.equal(new Set(slot.primary).size, slot.primary.length, `primary มุม ${i + 1} ห้ามมีป้ายซ้ำ`);
    assert.equal(new Set(slot.secondary).size, slot.secondary.length, `secondary มุม ${i + 1} ห้ามมีป้ายซ้ำ`);
    assert.doesNotMatch(buildAnglePointsText(plan, i), /([^|·]+) \| \1(?: \||$| ·)/u, 'ข้อความห้ามมี "ซ้ำ | ซ้ำ"');
  });
  assert.equal(buildAnglePointsText(plan, 1), 'ประเด็นที่มุมนี้ต้องเล่าเต็ม: ความห่วงใยผ่านสายโทรศัพท์ · ประเด็นที่มุมอื่นเล่าเต็มแล้ว ให้ย่อเป็นประโยคเดียวหรือข้าม: พ่อเลี้ยงลูกเหมือนเพื่อน');
  // แผนทำมือ (ไม่ผ่านตัวจัดสรร) ที่มีป้ายซ้ำ/ช่องว่าง/ค่าว่าง → ฝั่งต่อข้อความกรองเองอีกชั้น
  const handmade = [{ primary: ['ก', 'ก', ' ก ', ''], secondary: ['ข', 'ข', null] }, { primary: ['ข'], secondary: ['ก', 'ก'] }];
  assert.equal(buildAnglePointsText(handmade, 0), 'ประเด็นที่มุมนี้ต้องเล่าเต็ม: ก · ประเด็นที่มุมอื่นเล่าเต็มแล้ว ให้ย่อเป็นประโยคเดียวหรือข้าม: ข');
  assert.equal(buildAnglePointsText(handmade, 1), 'ประเด็นที่มุมนี้ต้องเล่าเต็ม: ข · ประเด็นที่มุมอื่นเล่าเต็มแล้ว ให้ย่อเป็นประโยคเดียวหรือข้าม: ก');
  // ป้ายเดียวกันโผล่ทั้ง primary และ secondary ของมุมเดียว (แผนขัดกัน) → ฝั่ง "เล่าเต็ม" ชนะ ไม่สั่งย่อของตัวเอง
  assert.equal(
    buildAnglePointsText([{ primary: ['ก'], secondary: ['ก', 'ข'] }, { primary: ['ข'], secondary: ['ก'] }], 0),
    'ประเด็นที่มุมนี้ต้องเล่าเต็ม: ก · ประเด็นที่มุมอื่นเล่าเต็มแล้ว ให้ย่อเป็นประโยคเดียวหรือข้าม: ข',
  );
});

test('รูปแบบข้อความต่อมุมตามสเปก และ 2 มุมได้ข้อความต่างกัน', () => {
  const { assignKeyPointsToAngles, buildAnglePointsText } = makeBlock();
  const plan = assignKeyPointsToAngles(KEY_POINTS, ANGLES);
  const t0 = buildAnglePointsText(plan, 0);
  const t1 = buildAnglePointsText(plan, 1);
  assert.equal(t0, `ประเด็นที่มุมนี้ต้องเล่าเต็ม: ${plan[0].primary.join(' | ')} · ประเด็นที่มุมอื่นเล่าเต็มแล้ว ให้ย่อเป็นประโยคเดียวหรือข้าม: ${plan[0].secondary.join(' | ')}`);
  assert.equal(t1, `ประเด็นที่มุมนี้ต้องเล่าเต็ม: ${plan[1].primary.join(' | ')} · ประเด็นที่มุมอื่นเล่าเต็มแล้ว ให้ย่อเป็นประโยคเดียวหรือข้าม: ${plan[1].secondary.join(' | ')}`);
  assert.notEqual(t0, t1);
  for (const label of plan[0].primary) {
    assert.ok(t0.indexOf(label) < t0.indexOf('ประเด็นที่มุมอื่นเล่าเต็มแล้ว'), 'ประเด็นของมุมนี้ต้องอยู่ฝั่ง "เล่าเต็ม"');
    assert.ok(t1.indexOf(label) > t1.indexOf('ประเด็นที่มุมอื่นเล่าเต็มแล้ว'), 'ประเด็นเดียวกันต้องอยู่ฝั่ง "ย่อ/ข้าม" ของอีกมุม');
  }
  assert.equal(buildAnglePointsText(plan, 5), '', 'index นอกแผน = ไม่เติม');
});

test('สวิตช์: ANGLE2_DISTINCT_V2=0 ไม่เติมข้อความ · ค่าอื่น (ว่าง/off/false) ยังเปิด (รับเฉพาะ 0 ตรงตัว)', () => {
  const on = makeBlock({});
  const plan = on.assignKeyPointsToAngles(KEY_POINTS, ANGLES);
  assert.equal(on.isAngle2DistinctV2Enabled(), true);
  assert.notEqual(on.buildAnglePointsText(plan, 0), '');
  const off = makeBlock({ ANGLE2_DISTINCT_V2: '0' });
  assert.equal(off.isAngle2DistinctV2Enabled(), false);
  assert.equal(off.buildAnglePointsText(plan, 0), '');
  assert.equal(off.buildAnglePointsText(plan, 1), '');
  for (const value of ['off', 'false', '', '1', 'no']) {
    const api = makeBlock({ ANGLE2_DISTINCT_V2: value });
    assert.equal(api.isAngle2DistinctV2Enabled(), true, `"${value}" ไม่ใช่คำสั่งปิด`);
    assert.notEqual(api.buildAnglePointsText(plan, 0), '');
  }
});

test('fail-open: บล็อกคำนวณแผนตัวจริงใน processAutoFlowText — ตัวจัดสรร throw → แผน null + log ⚠️ (= สวิตช์ปิด) ไม่ล้มงานข่าว · ปกติ → แผน + log 🧭 · สวิตช์ปิด → ไม่เรียกเลย', () => {
  const boom = () => { throw new Error('boom-plan'); };
  const failed = runPlanBlock({ assign: boom, breakdownData: { key_points: KEY_POINTS }, anglesToUse: ANGLES });
  assert.equal(failed.plan, null, 'ล้ม = แผน null → buildAnglePointsText(null) คืน \'\' = ข้อความนักเขียนเหมือนเดิม');
  assert.equal(failed.logs.length, 1);
  assert.equal(failed.logs[0].step, 'AngleDistinct');
  assert.match(failed.logs[0].msg, /^⚠️ จัดสรรประเด็นล้ม — ใช้มุมเดิม \(boom-plan\)$/u);

  // ล้มหลังได้แผนแล้ว (ตอนต่อข้อความ/log) ก็ต้องคืน null — ห้ามส่งแผนครึ่งๆ กลางๆ ให้นักเขียน
  const lateBoom = runPlanBlock({ build: () => { throw new Error('boom-text'); }, breakdownData: { key_points: KEY_POINTS }, anglesToUse: ANGLES });
  assert.equal(lateBoom.plan, null);
  assert.match(lateBoom.logs[0].msg, /boom-text/u);

  const { assignKeyPointsToAngles } = makeBlock();
  const ok = runPlanBlock({ breakdownData: { key_points: KEY_POINTS }, anglesToUse: ANGLES });
  assert.deepEqual(ok.plan, assignKeyPointsToAngles(KEY_POINTS, ANGLES), 'ทางปกติได้แผนเดียวกับฟังก์ชันบริสุทธิ์');
  assert.equal(ok.logs.length, 1);
  assert.equal(ok.logs[0].msg, '🧭 จัดสรรประเด็นต่อมุมไม่ซ้ำ: A1=3 ประเด็น · A2=2 ประเด็น (ANGLE2_DISTINCT_V2)');

  let called = 0;
  const off = runPlanBlock({ enabled: false, assign: () => { called += 1; return []; }, breakdownData: { key_points: KEY_POINTS }, anglesToUse: ANGLES });
  assert.equal(off.plan, null);
  assert.equal(called, 0, 'สวิตช์ปิดต้องไม่เรียกตัวจัดสรร');
  assert.deepEqual(off.logs, []);

  const quiet = runPlanBlock({ breakdownData: { key_points: KEY_POINTS.slice(0, 1) }, anglesToUse: ANGLES });
  assert.deepEqual(quiet.logs, [], 'ประเด็น < 2 = ไม่มีข้อความให้ใคร → ไม่ log 🧭');
});

test('stampDiversitySimilarity: ติดตัวเลขความคล้ายสูงสุดของแต่ละเวอร์ชัน ไม่แตะฟิลด์เดิม · ไม่มีคู่เทียบ = คืน array เดิม', () => {
  const { stampDiversitySimilarity } = makeBlock();
  const versions = [
    { title: 'หนึ่ง', content: 'ก', _diversityWarning: 'เตือน' },
    { title: 'สอง', content: 'ข' },
    { title: 'สาม', content: 'ค' },
  ];
  const report = { ok: false, maxSimilarity: 0.4213, pairs: [
    { left: 0, right: 1, similarity: 0.4213, tooSimilar: true },
    { left: 0, right: 2, similarity: 0.1, tooSimilar: false },
    { left: 1, right: 2, similarity: 0.25, tooSimilar: false },
  ] };
  const stamped = stampDiversitySimilarity(versions, report);
  assert.equal(stamped[0]._diversitySimilarity, 0.421);
  assert.equal(stamped[1]._diversitySimilarity, 0.421);
  assert.equal(stamped[2]._diversitySimilarity, 0.25);
  stamped.forEach((v, i) => {
    const { _diversitySimilarity, ...rest } = v;
    assert.equal(typeof _diversitySimilarity, 'number');
    assert.deepEqual(rest, versions[i], 'ฟิลด์เดิม (เนื้อ/คำเตือน/ที่มา) ต้องไม่ถูกแตะ');
  });
  assert.equal(stampDiversitySimilarity(versions, { ok: true, pairs: [] }), versions, 'เวอร์ชันเดียว/ไม่มีคู่ = array เดิม');
  assert.equal(stampDiversitySimilarity(versions, null), versions);
});

test('wiring: จุดเรียกจริงต่อสายครบ · บรรทัด writeAngle เดิมไม่ถูกแตะ · เกณฑ์บล็อกความคล้ายไม่เปลี่ยน', () => {
  assert.ok(SRC.includes('  let _anglePointPlan = null;\n  if (isAngle2DistinctV2Enabled()) {\n    try {\n      _anglePointPlan = assignKeyPointsToAngles(breakdownData?.key_points, anglesToUse);'),
    'ต้องคำนวณแผนก่อนยิงขนาน ภายใต้สวิตช์ และครอบ try (fail-open)');
  const planStart = SRC.indexOf(PLAN_START);
  assert.ok(planStart > 0 && planStart < SRC.indexOf('// === PARALLEL GENERATE'), 'บล็อกคำนวณแผนต้องอยู่ก่อนยิงขนาน');
  assert.ok(SRC.includes('const writeAngle = _openingStyle ? `${focusAngle}\\nสไตล์เปิดเรื่องบังคับของเวอร์ชันนี้: ${_openingStyle}` : focusAngle;'),
    'บรรทัด writeAngle เดิม (สัญญาเปิดเรื่อง) ต้องคงเดิม');
  assert.ok(SRC.includes('const _pointsText = buildAnglePointsText(_anglePointPlan, index);'));
  assert.ok(SRC.includes('const writeAngleWithPoints = _pointsText ? `${writeAngle}\\n${_pointsText}` : writeAngle;'),
    'ข้อความว่าง = writeAngle เดิมทุกไบต์');
  assert.ok(SRC.includes('focusAngle: writeAngleWithPoints,'), 'นักเขียนต้องได้รับมุม+ประเด็นต่อมุม');
  assert.equal(SRC.includes('focusAngle: writeAngle,'), false, 'ห้ามเหลือจุดส่ง writeAngle เปล่าให้นักเขียน');
  assert.ok(SRC.includes('        focusAngle,\n        workflowId: _autoWorkflowId,\n        signal: stageSignal,\n      }).catch((resErr) => {'),
    'performResearch ยังรับ focusAngle เปล่า (ไม่ยัดประเด็นให้ตัวค้น)');
  const stamps = SRC.match(/if \(isAngle2DistinctV2Enabled\(\)\) finalVersions = stampDiversitySimilarity\(finalVersions, (diversity|postFactDiversity)\);/g) || [];
  assert.equal(stamps.length, 2, 'ต้องติดตัวเลขความคล้ายทั้งก่อนและหลัง factual editor ภายใต้สวิตช์');
  assert.ok(SRC.includes('annotateDiversityWarning(finalVersions, diversity)'), 'คำเตือนความคล้ายเดิมต้องยังอยู่');
  assert.ok(SRC.includes('const threshold = Math.min(left.length, right.length) >= 300 ? 0.37 : 0.5;'), 'เกณฑ์บล็อก 37%/50% ต้องไม่เปลี่ยน');
  const s = SRC.indexOf(START);
  const e = SRC.indexOf(END, s);
  const code = SRC.slice(s, e).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /^\s*import\b|\brequire\(/mu, 'บล็อกต้องไม่มี import (เทสดึงไปรันแยก)');
});

test('mutation: ทุบการจัดสรร/สวิตช์/ตัวเลขความคล้าย/มุมว่าง/ป้ายซ้ำ/fail-open แล้ว oracle ต้องแดง', () => {
  const everyAngleGetsEverything = SRC.replace(
    '(owner[pi] === ai ? slot.primary : slot.secondary).push(p.label)',
    'slot.primary.push(p.label)',
  );
  assert.notEqual(everyAngleGetsEverything, SRC);
  assert.throws(() => assertDistinctPlan(makeBlock({}, everyAngleGetsEverything).assignKeyPointsToAngles(KEY_POINTS, ANGLES)));

  const ignoresSwitch = SRC.replace("  if (!isAngle2DistinctV2Enabled()) return '';\n", '');
  assert.notEqual(ignoresSwitch, SRC);
  assert.throws(() => {
    const api = makeBlock({ ANGLE2_DISTINCT_V2: '0' }, ignoresSwitch);
    assert.equal(api.buildAnglePointsText(api.assignKeyPointsToAngles(KEY_POINTS, ANGLES), 0), '');
  });

  const zeroSimilarity = SRC.replace('_diversitySimilarity: Math.round(max * 1000) / 1000', '_diversitySimilarity: 0');
  assert.notEqual(zeroSimilarity, SRC);
  assert.throws(() => {
    const out = makeBlock({}, zeroSimilarity).stampDiversitySimilarity([{ a: 1 }, { b: 2 }], { pairs: [{ left: 0, right: 1, similarity: 0.42 }] });
    assert.equal(out[0]._diversitySimilarity, 0.42);
  });

  // มุมว่าง: ถอด guard → มุมที่ 3 (ไม่มีประเด็น) ได้ข้อความ "ย่อ/ข้าม: ทุกประเด็น"
  const noEmptyGuard = SRC.replace("  if (own.length === 0) return '';\n", '');
  assert.notEqual(noEmptyGuard, SRC);
  assert.throws(() => {
    const api = makeBlock({}, noEmptyGuard);
    const plan = api.assignKeyPointsToAngles(KEY_POINTS.slice(3, 5), [...ANGLES, { angle_name: 'มุมที่สาม', description: 'มุมสำรอง' }]);
    assert.equal(api.buildAnglePointsText(plan, plan.findIndex(slot => slot.primary.length === 0)), '');
  });

  // ป้ายซ้ำฝั่งจัดสรร: ถอด dedupe → primary มีป้ายซ้ำ
  const noDedupe = SRC.replace('    .filter((p, i, all) => all.findIndex(q => q.label === p.label) === i);\n', '    ;\n');
  assert.notEqual(noDedupe, SRC);
  assert.throws(() => {
    const plan = makeBlock({}, noDedupe).assignKeyPointsToAngles(['ความห่วงใยผ่านสายโทรศัพท์', 'ความห่วงใยผ่านสายโทรศัพท์', 'พ่อเลี้ยงลูกเหมือนเพื่อน'], ANGLES);
    plan.forEach(slot => assert.equal(new Set(slot.primary).size, slot.primary.length));
  });

  // ป้ายซ้ำฝั่งข้อความ: ถอด uniqueLabels ของ primary → แผนทำมือที่ซ้ำโผล่ "ก | ก"
  const noUniqueText = SRC.replace('  const own = uniqueLabels(me.primary);\n', "  const own = (Array.isArray(me.primary) ? me.primary : []).filter(Boolean);\n");
  assert.notEqual(noUniqueText, SRC);
  assert.throws(() => assert.equal(
    makeBlock({}, noUniqueText).buildAnglePointsText([{ primary: ['ก', 'ก'], secondary: ['ข'] }, { primary: ['ข'], secondary: ['ก', 'ก'] }], 0),
    'ประเด็นที่มุมนี้ต้องเล่าเต็ม: ก · ประเด็นที่มุมอื่นเล่าเต็มแล้ว ให้ย่อเป็นประโยคเดียวหรือข้าม: ข',
  ));

  // fail-open: catch โยนต่อ → งานข่าวล้ม
  const rethrow = SRC.replace('    } catch (planErr) {\n      _anglePointPlan = null;\n', '    } catch (planErr) {\n      throw planErr;\n');
  assert.notEqual(rethrow, SRC);
  assert.throws(() => runPlanBlock({ source: rethrow, assign: () => { throw new Error('boom'); }, breakdownData: { key_points: KEY_POINTS }, anglesToUse: ANGLES }), /boom/u);
  // fail-open: ไม่ล้างแผนใน catch → ล้มตอนต่อข้อความแล้วแผนครึ่งเดียวหลุดไปหานักเขียน
  const keepsPlan = SRC.replace('    } catch (planErr) {\n      _anglePointPlan = null;\n', '    } catch (planErr) {\n');
  assert.notEqual(keepsPlan, SRC);
  assert.throws(() => assert.equal(
    runPlanBlock({ source: keepsPlan, build: () => { throw new Error('boom-text'); }, breakdownData: { key_points: KEY_POINTS }, anglesToUse: ANGLES }).plan,
    null,
  ));
});
