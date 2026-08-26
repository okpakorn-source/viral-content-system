/**
 * 🧪 clip-brain-verify.test.mjs — ข้อสอบอิสระของ "มือข้อสอบ" สำหรับ clipVerify.js (26 ส.ค. 69)
 * ------------------------------------------------------------------------------
 * ตรวจ 4 บั๊กที่ช่างซ่อมรายงานว่าปิดแล้ว: CB-05 / CB-11 / CB-06 / CB-07
 * เขียนแยกจาก tests/clip-verify-guards.test.mjs (ไฟล์นั้นเป็น self-test ของคนแก้โค้ด
 * ไม่นับเป็นการตรวจอิสระ) — ทุกเคสด้านล่างออกแบบเอง คนละชื่อ/คนละสถานการณ์
 * ไม่ยิง network/AI/ffmpeg ไม่แตะไฟล์อื่น เรียกฟังก์ชันจริงเท่านั้น ห้ามค้นคำในซอร์ส
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  isRolePlaceholder, checkAgainstTruth, applyRepairPatch, repairFabricatedNames, NAME_PLACEHOLDER,
} = await import(new URL('../src/lib/services/clipBrain/clipVerify.js', import.meta.url).href);

/* ════════════════════════ CB-05 — คำแทนบทบาท vs ชื่อคนจริง ════════════════════════ */

test('CB-05: ชื่อคนพ่วงหลังคำบทบาทตามโจทย์ ต้องไม่ถูกตีเป็นคำแทน (isRolePlaceholder=false)', () => {
  assert.equal(isRolePlaceholder('เจ้าหน้าที่ สมชาย ใจดี'), false);
  assert.equal(isRolePlaceholder('พิธีกรผู้ดำเนินรายการ สมชาย ใจดี'), false);
  assert.equal(isRolePlaceholder('ชายที่ชื่อ สมชาย ใจดี'), false);
});

test('CB-05: คำเชื่อมบทบาท (ชื่อ/ที่) ต้องไม่ทำให้ token ถัดไปถูกมองข้าม', () => {
  // ตั้งใจให้มีคำว่า "ที่" ปรากฏจริงในสตริง — นี่คือคำที่โค้ดเดิม (เช็คทั้งสตริงด้วย /ที่|ผู้|ใน|ประจำ/)
  // จะเจอแล้วเข้าใจผิดว่าเป็นคำแทนทันที ทั้งที่ตามด้วยชื่อคนจริง 2 คำ
  assert.equal(isRolePlaceholder('แม่ค้าที่ชื่อ สมหญิง ใจบุญ'), false);
  assert.equal(isRolePlaceholder('แม่ค้าคนหนึ่งชื่อ ทองดี มีลาภ'), false);
});

test('CB-05: คำแทนบทบาทล้วน (ไม่มีชื่อคนพ่วง) ยังต้องถูกข้ามเหมือนเดิม — กันบั๊ก #4 กลับมา', () => {
  for (const s of ['นักข่าวประจำจังหวัด', 'คุณป้าที่ตลาด', 'ทีมงานในคลิป', 'พนักงานร้าน', 'ลูกค้าคนหนึ่ง']) {
    assert.equal(isRolePlaceholder(s), true, `คาดว่า "${s}" ยังเป็น placeholder`);
  }
});

test('CB-05: คำกลาง "บุคคล"/"บุคคลในคลิป" ต้องไม่ขึ้นธงตัวเอง (กันตัวซ่อมชนกับตัวตรวจ)', () => {
  assert.equal(isRolePlaceholder('บุคคล'), true);
  assert.equal(isRolePlaceholder(NAME_PLACEHOLDER), true); // 'บุคคลในคลิป'
});

test('CB-05 end-to-end: ชื่อแต่งที่พ่วงหลังคำบทบาท ต้องขึ้นธง "ของงอก-ชื่อ" ผ่าน checkAgainstTruth จริง', () => {
  // "แม่ค้าที่ชื่อ" มีคำว่า "ที่" ฝังอยู่ — จุดที่โค้ดเดิม (เช็คทั้งสตริง) จะเข้าใจผิดว่าเป็นคำแทนทั้งก้อน
  const r = checkAgainstTruth(
    { speakers: ['แม่ค้าที่ชื่อ ทองดี มีลาภ'] },
    'วันนี้ที่ตลาดสดมีแม่ค้าขายของ ลูกค้าซื้อของเยอะมาก',
  );
  const hits = r.findings.filter((f) => f.kind === 'ของงอก-ชื่อ');
  assert.equal(hits.length, 1);
  assert.match(hits[0].detail, /ทองดี/);
  assert.match(hits[0].detail, /มีลาภ/);
});

test('CB-05 end-to-end (regression): คำแทนบทบาทล้วนที่ไม่มีในเฉลย ต้องไม่ขึ้นธง (บั๊ก #4 ห้ามกลับมา)', () => {
  const r = checkAgainstTruth(
    { speakers: ['ชายที่ร้านก๋วยเตี๋ยว', 'หญิงสาวผู้ดำเนินรายการ'] },
    'วันนี้ไม่มีเหตุการณ์อะไรพิเศษเลยที่ตลาด',
  );
  assert.equal(r.findings.filter((f) => f.kind === 'ของงอก-ชื่อ').length, 0);
});

/* ════════════════════════ CB-11 — หน้าต่างจับคำพูดเหลื่อม offset ════════════════════════ */

// ออกแบบด้วย noise-prefix แทนวิธี sliding-window ของไฟล์ guards — คนละกลไกพิสูจน์ บั๊กเดียวกัน:
// common part ยาว "พอดี 14 ตัว" (ไม่มากกว่า) ต่อท้าย noise ยาว offset ตัว ทำให้มีแค่ตำแหน่ง i=offset
// เท่านั้นที่จะ match ได้เต็มหน้าต่าง — โค้ดเดิม (เลื่อนทีละ 4 เริ่ม 0) ไม่มีทางไปถึง i=1/2/3 เลย
function noiseOffsetCase(commonRaw, offsetLen, noiseChar) {
  const common14 = commonRaw.slice(0, 14);
  assert.equal(common14.length, 14, 'เตรียมข้อมูลเทสผิด: common ต้องยาว 14 ตัวเป๊ะ');
  return noiseChar.repeat(offsetLen) + common14;
}

test('CB-11: คำพูดไทยที่ตรงจริงแต่เหลื่อม offset 1-3 ตัว ต้องไม่ถูกเตือน', () => {
  const commonThai = 'ขอเรียนชี้แจงว่าผมไม่มีส่วนเกี่ยวข้องกับเหตุการณ์นี้แต่อย่างใด';
  const truth = `เมื่อวานนี้ที่งานเทศกาล ${commonThai} ทุกคนก็แยกย้ายกันกลับบ้าน`;
  for (const off of [1, 2, 3]) {
    const quote = noiseOffsetCase(commonThai, off, '7'); // '7' ไม่ปรากฏในเฉลยเลย กันชนโดยบังเอิญ
    const r = checkAgainstTruth({ quotes: [quote] }, truth);
    assert.equal(r.findings.filter((f) => f.kind === 'คำพูดไม่ตรงคลิป').length, 0, `offset ${off} ควรเจอ`);
  }
});

test('CB-11: คำพูดละติน/อังกฤษที่ตรงจริงแต่เหลื่อม offset 1-3 ตัว ต้องไม่ถูกเตือน', () => {
  const commonEn = 'iwanttoconfirmthatthisisnottrueatall';
  const truth = `he said before the crowd ${commonEn} and then left quietly`;
  for (const off of [1, 2, 3]) {
    const quote = noiseOffsetCase(commonEn, off, '9');
    const r = checkAgainstTruth({ quotes: [quote] }, truth);
    assert.equal(r.findings.filter((f) => f.kind === 'คำพูดไม่ตรงคลิป').length, 0, `offset ${off} ควรเจอ`);
  }
});

test('CB-11 (regression): คำพูดที่ไม่มีในคลิปจริงเลย ต้องยังถูกเตือนอยู่', () => {
  const r = checkAgainstTruth(
    { quotes: ['ผมจะลาออกจากตำแหน่งภายในสิ้นเดือนนี้แน่นอนครับผม'] },
    'วันนี้อากาศดีมาก เรามาคุยเรื่องอาหารกลางวันกันดีกว่านะครับ',
  );
  assert.equal(r.findings.filter((f) => f.kind === 'คำพูดไม่ตรงคลิป').length, 1);
});

test('CB-11: คำพูดสั้นกว่า 14 ตัวหลัง normalize ไม่ตัดสิน (ไม่เตือน) ตามสัญญาเดิม', () => {
  const r = checkAgainstTruth({ quotes: ['สั้นมาก'] }, 'ข้อความเฉลยที่ไม่เกี่ยวข้องอะไรเลย');
  assert.equal(r.findings.filter((f) => f.kind === 'คำพูดไม่ตรงคลิป').length, 0);
});

/* ════════════════════════ CB-06 — ด่านรับแพตช์ applyRepairPatch ════════════════════════ */

const freshInsight = () => ({
  headline: 'พาดหัวต้นฉบับ',
  overview: 'ภาพรวมต้นฉบับที่มีความยาวพอสมควรสำหรับทดสอบระบบ',
  rawData: 'เนื้อหาดิบต้นฉบับสั้นๆสี่สิบแปดตัวอักษรพอดีนะครับ12345', // ตั้งใจสั้น (<200) เพื่อพิสูจน์ guard ไม่ผูกกับ threshold 200
  speakers: ['คนหนึ่ง', 'คนสอง'],
  quotes: ['คำพูดที่หนึ่ง', 'คำพูดที่สอง'],
  subStories: [
    { no: 5, topic: 'หัวข้อย่อยห้า', timeRange: '00:00-01:00', rawData: 'เนื้อย่อยห้าอันสั้น', quotes: ['อ้างอิงย่อยห้า'], keyPoints: ['ประเด็นห้า'] },
  ],
});

test('CB-06: patch ที่ไม่ใช่ออบเจกต์ (null/undefined/string/number/array) ต้องไม่ throw และคืนของเดิมทั้งใบ', () => {
  for (const bad of [null, undefined, 'สตริงเปล่าๆ', 42, [1, 2, 3]]) {
    const r = applyRepairPatch(freshInsight(), bad);
    assert.deepEqual(r.changed, []);
    assert.equal(r.insight.headline, 'พาดหัวต้นฉบับ');
    assert.ok(Array.isArray(r.rejected) && r.rejected.length >= 1);
  }
});

test('CB-06: patch เป็นออบเจกต์ว่างเปล่า {} ต้องไม่แก้อะไรเลยและไม่ throw', () => {
  const r = applyRepairPatch(freshInsight(), {});
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.insight, freshInsight());
});

test('CB-06: subStories item ที่ไม่ใช่ออบเจกต์ (null/string/number/array) ต้องถูกข้ามอย่างปลอดภัย ไม่โยน TypeError', () => {
  // เรียกตรงๆ (ไม่ wrap ด้วย assert.doesNotThrow) — ถ้าโค้ด throw จริง node:test จะรายงาน error ของเทสนี้ทันที
  // 🔧 ปรับ 26 ส.ค. (รอบสอง): applyRepairPatch บรรทัด 469 + resolveFindingRef บรรทัด 430 บังคับให้ก้อนใหม่ต้องอ้าง
  //   หลักฐานแล้ว (CB-06 รอบสอง) — เติม findings + fromFinding ให้ก้อน "ที่ดี" ผ่านด่านได้ตามเจตนาเดิมของเทสนี้
  //   (พิสูจน์ว่ารายการขยะที่ไม่ใช่ออบเจกต์ไม่ทำให้พัง ไม่ใช่พิสูจน์เรื่องหลักฐาน)
  const findings = [{ kind: 'ของหาย-ประเด็น', where: 'ก้อนที่ดี' }];
  const r = applyRepairPatch(freshInsight(), {
    subStories: ['ไม่ใช่ออบเจกต์', 99, [1, 2], { no: 40, topic: 'ก้อนที่ดี', rawData: 'w'.repeat(65), fromFinding: 1 }],
  }, { findings });
  // เดิม+ใหม่ 1 ก้อนที่ผ่านด่าน = 2 ก้อน, ที่เหลือ 3 รายการถูกปฏิเสธ
  assert.equal(r.insight.subStories.length, 2);
  assert.ok(r.rejected.length >= 3);
});

test('CB-06: top-level quotes ที่ไม่ใช่ array ต้องถูกปฏิเสธเฉพาะช่องนั้น ไม่โยนที่ .map', () => {
  const r = applyRepairPatch(freshInsight(), { quotes: 'ข้อความเดี่ยวไม่ใช่ array' });
  assert.deepEqual(r.insight.quotes, ['คำพูดที่หนึ่ง', 'คำพูดที่สอง']);
  assert.ok(r.rejected.some((x) => x.where === 'quotes'));
});

test('CB-06: no แบบสตริง (เลขใดๆ ไม่ใช่แค่ "1") ต้องชนกับก้อนเดิมที่เป็น number ไม่สร้างซ้ำ', () => {
  const r = applyRepairPatch(freshInsight(), { subStories: [{ no: '5', topic: 'แก้ก้อนห้าด้วยเลขสตริง' }] });
  assert.equal(r.insight.subStories.length, 1);
  assert.equal(r.insight.subStories[0].topic, 'แก้ก้อนห้าด้วยเลขสตริง');
});

test('CB-06: เลขก้อนเดิมซ้ำกันเอง (บั๊กจากรอบก่อน) ต้องไม่ทำให้ก้อนใดหายไปตอนแก้ก้อนอื่น', () => {
  const dupBase = {
    ...freshInsight(),
    subStories: [
      { no: 1, topic: 'ก้อนแรกเลขซ้ำ', rawData: 'x'.repeat(60) },
      { no: 1, topic: 'ก้อนสองเลขซ้ำ', rawData: 'y'.repeat(60) },
    ],
  };
  // 🔧 ปรับ 26 ส.ค. (รอบสอง): ก้อนใหม่ต้องอ้างหลักฐาน (ดู applyRepairPatch บรรทัด 469) — เติม findings + fromFinding
  //   เพื่อคงเจตนาเดิมของเทสนี้ (พิสูจน์เรื่องเลขซ้ำ ไม่ใช่พิสูจน์เรื่องหลักฐาน)
  const findings = [{ kind: 'ของหาย-ประเด็น', where: 'ก้อนใหม่ไม่ชนใคร' }];
  // แก้ก้อนที่ไม่ชนกับของเดิมเลย เพื่อบังคับให้ logic เขียน byNo ทำงาน
  const r = applyRepairPatch(dupBase, { subStories: [{ no: 9, topic: 'ก้อนใหม่ไม่ชนใคร', rawData: 'z'.repeat(70), fromFinding: 1 }] }, { findings });
  assert.equal(r.insight.subStories.length, 3, 'ก้อนเดิมทั้งสองต้องยังอยู่ครบ + ก้อนใหม่ 1');
  const topics = r.insight.subStories.map((s) => s.topic);
  assert.ok(topics.includes('ก้อนแรกเลขซ้ำ'));
  assert.ok(topics.includes('ก้อนสองเลขซ้ำ'));
});

test('CB-06: ก้อนใหม่จำกัดไม่เกิน 3 ก้อนต่อรอบ ก้อนเกินโควตาถูกปฏิเสธพร้อมเหตุผล', () => {
  // 🔧 ปรับ 26 ส.ค. (รอบสอง): ก้อนใหม่ต้องอ้างหลักฐานก่อนถึงจะโดนด่านโควตาตัดสิน — ให้ทุกก้อนอ้าง finding เดียวกันได้
  // (ด่านหลักฐานกับด่านโควตาเป็นคนละด่าน แยกอิสระต่อกัน ดู resolveFindingRef บรรทัด 430 กับ MAX_NEW_SUBSTORIES บรรทัด 404)
  const findings = [{ kind: 'ของหาย-ประเด็น', where: 'ประเด็นที่ขาดหายไปหลายจุด' }];
  const p = { subStories: [10, 11, 12, 13].map((no) => ({ no, topic: `ใหม่ ${no}`, rawData: 'ด'.repeat(80), fromFinding: 1 })) };
  const r = applyRepairPatch(freshInsight(), p, { findings });
  assert.equal(r.insight.subStories.length, 4); // เดิม 1 + ใหม่ 3 (ก้อนที่ 4 ถูกตัดเพราะเกินโควตา ไม่ใช่เพราะขาดหลักฐาน)
  assert.ok(r.rejected.some((x) => /เกินเพดาน/.test(x.why)));
});

test('CB-06: เนื้อหดผิดปกติต้องถูกปฏิเสธ แม้ต้นฉบับสั้นกว่า 200 ตัว (guard ไม่ผูกกับ threshold ตายตัว)', () => {
  const original = freshInsight();
  assert.ok(original.rawData.length < 200, 'เตรียมเคสผิด: rawData ต้องสั้นกว่า 200 ตัวเพื่อพิสูจน์ประเด็นนี้');
  const r = applyRepairPatch(original, { rawData: 'ก' });
  assert.equal(r.insight.rawData, original.rawData);
  assert.equal(r.changed.length, 0);
  assert.ok(r.rejected.some((x) => x.where === 'rawData' && /หด/.test(x.why)));
});

test('CB-06: การแก้เนื้อแบบหดเล็กน้อย (ไม่เกิน 40 ตัวหรือไม่เกินครึ่ง) ต้องผ่านได้ตามปกติ ไม่ over-reject', () => {
  const original = freshInsight();
  const trimmed = original.rawData.slice(0, original.rawData.length - 3); // ตัดแค่ 3 ตัวท้าย
  const r = applyRepairPatch(original, { rawData: trimmed });
  assert.equal(r.insight.rawData, trimmed);
  assert.ok(r.changed.includes('rawData'));
});

test('CB-06: speakers/quotes เป็น array ห้ามสั้นลงกว่าเดิม', () => {
  const r = applyRepairPatch(freshInsight(), { speakers: ['เหลือคนเดียว'], quotes: ['เหลืออันเดียว'] });
  assert.deepEqual(r.insight.speakers, ['คนหนึ่ง', 'คนสอง']);
  assert.deepEqual(r.insight.quotes, ['คำพูดที่หนึ่ง', 'คำพูดที่สอง']);
  assert.equal(r.changed.includes('speakers'), false);
  assert.equal(r.changed.includes('quotes'), false);
});

test('CB-06: subStories quotes (ก้อนที่มีอยู่แล้ว) ก็ห้ามสั้นลงเช่นกัน', () => {
  const r = applyRepairPatch(freshInsight(), { subStories: [{ no: 5, quotes: [] }] });
  assert.deepEqual(r.insight.subStories[0].quotes, ['อ้างอิงย่อยห้า']);
  assert.ok(r.rejected.some((x) => x.where === 'subStories no.5 quotes'));
});

test('CB-06: changed ต้องรายงานเฉพาะช่องที่ต่างจริง — ช่องที่ค่าเท่าเดิมไม่นับว่าเปลี่ยน', () => {
  const noop = applyRepairPatch(freshInsight(), {
    headline: 'พาดหัวต้นฉบับ', // เหมือนเดิมเป๊ะ
    subStories: [{ no: 5, topic: 'หัวข้อย่อยห้า', timeRange: '00:00-01:00' }], // เหมือนเดิมเป๊ะทั้งคู่
  });
  assert.deepEqual(noop.changed, []);

  const partial = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 5, topic: 'หัวข้อย่อยห้า', timeRange: '00:00-09:00' }], // topic เดิม, timeRange เปลี่ยน
  });
  assert.ok(partial.changed.includes('subStories'));
  assert.equal(partial.insight.subStories[0].timeRange, '00:00-09:00');
  assert.ok(partial.rejected.some((x) => x.where === 'subStories no.5 topic' && /เท่าเดิม/.test(x.why)));
});

test('CB-06: การแก้ที่ถูกต้องจริงต้องยัง apply ได้ปกติ (ไม่ใช่ปิดตายทั้งหมด)', () => {
  const r = applyRepairPatch(freshInsight(), {
    overview: 'ภาพรวมที่แก้ให้ตรงคลิปแล้วครับ',
    speakers: ['คนหนึ่ง', 'คนสอง', 'คนสาม'],
    subStories: [{ no: 5, rawData: 'ฃ'.repeat(400) }],
  });
  assert.ok(r.changed.includes('overview'));
  assert.ok(r.changed.includes('speakers'));
  assert.ok(r.changed.includes('subStories'));
  assert.equal(r.insight.subStories[0].rawData.length, 400);
});

test('CB-06: ต้องไม่ mutate insight ต้นฉบับที่ส่งเข้ามา (immutability)', () => {
  const original = freshInsight();
  const headlineRef = original.headline;
  const subStoriesRef = original.subStories;
  applyRepairPatch(original, { headline: 'พาดหัวใหม่เอี่ยม', subStories: [{ no: 5, topic: 'เปลี่ยนหัวข้อย่อยแล้ว' }] });
  assert.equal(original.headline, headlineRef);
  assert.equal(original.subStories, subStoriesRef);
  assert.equal(original.subStories[0].topic, 'หัวข้อย่อยห้า');
});

test('CB-06: คืน {insight, changed, rejected} ครบทุกกรณี แม้ patch พังทุกช่องพร้อมกัน (fail-open)', () => {
  const r = applyRepairPatch(freshInsight(), {
    headline: { bad: 'object' },
    speakers: 'ไม่ใช่ array',
    subStories: [null, 'bad', { no: 'xyz', topic: 1234 }],
  });
  assert.ok('insight' in r && 'changed' in r && 'rejected' in r);
  assert.ok(Array.isArray(r.changed));
  assert.ok(Array.isArray(r.rejected));
});

/* ── ช่องว่างที่พบระหว่างตรวจ: keyPoints ไม่มี guard เลยทั้ง top-level และตอนแก้ก้อนเดิม ── */
/* เทสนี้ยืนยันแค่ว่า "ไม่ throw" (สัญญา fail-open ยังอยู่) — รายละเอียดช่องว่างอยู่ใน uncoveredConcerns */

test('CB-06 (พบเพิ่ม): top-level keyPoints ที่ไม่ใช่ array ต้องไม่ throw อย่างน้อยที่สุด', () => {
  const r = applyRepairPatch(freshInsight(), { keyPoints: 'ไม่ใช่ array เลย' });
  assert.ok(Array.isArray(r.rejected));
});

test('CB-06 (พบเพิ่ม): subStories keyPoints ของก้อนที่มีอยู่แล้ว (merge) ไม่ throw อย่างน้อยที่สุด', () => {
  const r = applyRepairPatch(freshInsight(), { subStories: [{ no: 5, keyPoints: ['ประเด็นใหม่ที่อยากแก้'] }] });
  assert.ok(Array.isArray(r.rejected));
});

/* ══════════════ CB-06 รอบสอง (26 ส.ค.) — ก้อนใหม่ต้องอ้างหลักฐาน (fromFinding/evidence) จริง ══════════════ */
/* พิสูจน์ประเด็นที่โซลบอกว่า "บางส่วน": เดิมก้อนใหม่ผ่านด่านแค่ "มีหัวข้อ + เนื้อ ≥60 ตัว" ไม่ผูกกับหลักฐานเลย
   → แก้แล้วที่ applyRepairPatch(insight, patch, opts) พารามิเตอร์ตัวที่ 3 — ไม่ส่ง opts/findings มา = ห้ามเพิ่มก้อนใหม่เลย */

test('CB-06 (ปิดจุดที่ 2): ไม่ส่ง opts/findings มาเลย ต้องห้ามเพิ่มก้อนใหม่ทุกก้อน แม้เนื้อหาจะดีและไม่เกินโควตา', () => {
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 99, topic: 'ก้อนใหม่ไม่มีหลักฐานรองรับ', rawData: 'เนื้อหาที่ดูดีและยาวพอสำหรับผ่านด่านเนื้อหา'.repeat(2) }],
  }); // ไม่ส่ง opts ตัวที่ 3 เลย — เหมือนโค้ดเดิมของผู้เรียกที่ยังไม่รู้จัก findings
  assert.equal(r.insight.subStories.length, 1, 'ต้องไม่มีก้อนใหม่เพิ่มเข้ามาแม้แต่ก้อนเดียว');
  assert.ok(r.rejected.some((x) => x.where === 'subStories no.99' && /ไม่ได้ส่ง findings/.test(x.why)), JSON.stringify(r.rejected));
});

test('CB-06: ส่ง { findings: [] } (array ว่างเปล่า) ต้องห้ามเพิ่มก้อนใหม่เหมือนไม่ส่งเลย', () => {
  // เนื้อ rawData ต้อง ≥60 ตัวจริง (ไม่งั้นจะโดนด่าน "เนื้อไม่พอ" บังหน้า ทำให้เทสนี้ผ่านได้แม้ด่านหลักฐานถูกถอดออกไปเงียบๆ)
  const rawData = 'เนื้อหายาวพอสมควรสำหรับทดสอบระบบตรงนี้ไม่มีปัญหาอะไรเลยแน่นอนครับผม';
  assert.ok(rawData.length >= 60, `เตรียมเคสผิด: ยาวแค่ ${rawData.length} ตัว`);
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 77, topic: 'ก้อนใหม่เนื้อดี', rawData }],
  }, { findings: [] });
  assert.equal(r.insight.subStories.length, 1);
  // เจาะจงข้อความเหตุผลเรื่องหลักฐานเลย ไม่ใช่แค่ "ถูกปฏิเสธด้วยเหตุผลอะไรก็ได้" (กันการผ่านมั่วเพราะโดนด่านอื่นบังหน้า)
  assert.ok(r.rejected.some((x) => x.where === 'subStories no.77' && /ไม่ได้ส่ง findings/.test(x.why)), JSON.stringify(r.rejected));
});

test('CB-06: ก้อนใหม่ไม่มีทั้ง fromFinding และ evidence เลย (แม้ findings ไม่ว่าง) ต้องถูกปฏิเสธ', () => {
  // เนื้อ rawData ต้อง ≥60 ตัวจริง เหตุผลเดียวกับเทสก่อนหน้า — กันด่าน "เนื้อไม่พอ" บังหน้าด่านหลักฐาน
  const rawData = 'เนื้อหายาวพอสมควรสำหรับทดสอบตรงนี้แน่นอนไม่มีปัญหาอะไรเลยจริงๆ';
  assert.ok(rawData.length >= 60, `เตรียมเคสผิด: ยาวแค่ ${rawData.length} ตัว`);
  const findings = [{ kind: 'ของหาย-ประเด็น', where: '05:00 เหตุการณ์ที่พลาดไป' }];
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 55, topic: 'ก้อนใหม่ไม่อ้างอะไรเลย', rawData }],
  }, { findings });
  assert.equal(r.insight.subStories.length, 1);
  assert.ok(r.rejected.some((x) => x.where === 'subStories no.55' && /ไม่ได้อ้างจุดที่ผู้ตรวจชี้/.test(x.why)), JSON.stringify(r.rejected));
});

test('CB-06: fromFinding อ้างเลขข้อที่เกินขอบเขต findings ที่ส่งมาจริง ต้องถูกปฏิเสธ (กันอ้างลอย)', () => {
  const findings = [{ kind: 'ของหาย-ประเด็น', where: '05:00 เหตุการณ์ที่พลาดไป' }]; // มี finding แค่ 1 ข้อ
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 50, topic: 'ก้อนใหม่อ้างเลขมั่ว', rawData: 'y'.repeat(80), fromFinding: 9 }], // อ้างข้อ 9 ที่ไม่มีจริง
  }, { findings });
  assert.equal(r.insight.subStories.length, 1);
  assert.ok(r.rejected.some((x) => x.where === 'subStories no.50' && /ไม่ได้อ้างจุดที่ผู้ตรวจชี้/.test(x.why)), JSON.stringify(r.rejected));
});

test('CB-06: fromFinding อ้างเลขข้อจริงที่ผู้เรียกส่งมา (1-based) ต้องผ่านด่านและถูกเพิ่มเข้าไปได้จริง', () => {
  const findings = [
    { kind: 'ของหาย-ประเด็น', where: '05:00 เหตุการณ์ A' },
    { kind: 'ของหาย-ประเด็น', where: '08:00 เหตุการณ์ B' },
  ];
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 50, topic: 'เพิ่มประเด็นช่วง 08:00 ตามข้อ 2', rawData: 'z'.repeat(80), fromFinding: 2 }],
  }, { findings });
  assert.equal(r.insight.subStories.length, 2, JSON.stringify(r.rejected));
  // หมายเหตุ: "no" ถูก renumber ใหม่ตามลำดับหลังรวม (byNo → sort → map no:i+1) จึงต้องหาด้วย topic ไม่ใช่เลข no เดิม
  const added = r.insight.subStories.find((s) => s.topic === 'เพิ่มประเด็นช่วง 08:00 ตามข้อ 2');
  assert.ok(added, `ก้อนใหม่ต้องถูกเพิ่มเข้าไปจริง ได้ ${JSON.stringify(r.insight.subStories)}`);
});

test('CB-06: evidence เป็นข้อความอ้างอิงตรงกับ where ของ finding จริง ต้องผ่านด่านได้เหมือน fromFinding', () => {
  const findings = [{ kind: 'ของหาย-ประเด็น', where: '05:00 เหตุการณ์คนล้มที่สนาม' }];
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 60, topic: 'เพิ่มเหตุการณ์คนล้มที่สนาม', rawData: 'w'.repeat(80), evidence: 'เหตุการณ์คนล้มที่สนาม' }],
  }, { findings });
  assert.equal(r.insight.subStories.length, 2, JSON.stringify(r.rejected));
});

test('CB-06: ส่ง opts เป็น array ตรงๆ (ไม่ห่อ {findings}) ต้องใช้งานได้เหมือนกัน — ตามสัญญา backward-compatible', () => {
  const findings = [{ kind: 'x', where: 'จุดที่ขาดหายไปนี้' }];
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 70, topic: 'เพิ่มจุดที่ขาดหายไปนี้', rawData: 'v'.repeat(80), fromFinding: 1 }],
  }, findings); // ส่ง array ตรงๆ ไม่ห่อ object
  assert.equal(r.insight.subStories.length, 2, JSON.stringify(r.rejected));
});

test('CB-06: fromFinding แบบข้อความมีคำนำ ("ข้อ 2") ต้องแปลงเป็นเลขข้อได้ถูกต้อง ไม่ใช่รับแค่ตัวเลขล้วน', () => {
  const findings = [{ kind: 'a', where: 'จุดที่หนึ่ง' }, { kind: 'b', where: 'จุดที่สอง' }];
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 80, topic: 'อ้างข้อ 2 แบบมีคำนำ', rawData: 'u'.repeat(80), fromFinding: 'ข้อ 2' }],
  }, { findings });
  assert.equal(r.insight.subStories.length, 2, JSON.stringify(r.rejected));
});

test('CB-06: ด่านหลักฐานคุมเฉพาะ "ก้อนใหม่" — แก้ก้อนเดิม (no ชนของเดิม) ไม่ต้องมี fromFinding/evidence เลย แม้ findings ว่างเปล่า', () => {
  const r = applyRepairPatch(freshInsight(), {
    subStories: [{ no: 5, topic: 'แก้หัวข้อเดิมได้แม้ไม่มี findings' }],
  }, { findings: [] });
  assert.equal(r.insight.subStories.length, 1);
  assert.equal(r.insight.subStories[0].topic, 'แก้หัวข้อเดิมได้แม้ไม่มี findings');
});

test('CB-06: เพดาน 3 ก้อนใหม่/รอบ ยังทำงานอยู่แม้ทุกก้อนอ้างหลักฐานถูกต้องครบ (ด่านหลักฐานกับด่านโควตาแยกอิสระ)', () => {
  const findings = [{ kind: 'ของหาย-ประเด็น', where: 'ประเด็นที่ขาดหายไปหลายจุดในคลิปนี้' }];
  const p = { subStories: [20, 21, 22, 23].map((no) => ({ no, topic: `ใหม่ ${no}`, rawData: 'ภ'.repeat(80), fromFinding: 1 })) };
  const r = applyRepairPatch(freshInsight(), p, { findings });
  assert.equal(r.insight.subStories.length, 4); // เดิม 1 + ใหม่ 3 (ก้อนที่ 4 ตกเพราะเกินโควตา ไม่ใช่เพราะหลักฐาน)
  assert.ok(r.rejected.some((x) => x.where === 'subStories no.23' && /เกินเพดาน/.test(x.why)));
});

/* ════════════════════════ CB-07 — กวาดชื่อแต่งออกจากทุกช่องข้อความ ════════════════════════ */

test('CB-07: ตัดทิ้งทั้งชื่อ ต้องกวาดออกจากทุกช่องข้อความ (headline/overview/rawData/quotes/keyPoints/subStories)', () => {
  const insight = {
    speakers: ['อาทิตย์ วงศ์งาม'],
    headline: 'อาทิตย์ วงศ์งาม เปิดใจครั้งแรก',
    overview: 'อาทิตย์ วงศ์งาม เล่าเหตุการณ์ทั้งหมด',
    rawData: 'อาทิตย์ วงศ์งาม ให้ข้อมูล ต่อมาวงศ์งามเดินจากไป',
    quotes: ['อาทิตย์ วงศ์งาม: ผมไม่รู้เรื่องนี้เลย'],
    keyPoints: ['อาทิตย์ วงศ์งาม ยืนยันชัดเจน'],
    subStories: [{ no: 1, topic: 'อาทิตย์ วงศ์งาม ให้การ', rawData: 'อาทิตย์บอกว่าไม่รู้เรื่อง', quotes: ['วงศ์งาม พูดชัด'] }],
  };
  const r = repairFabricatedNames(insight, 'ไม่มีการเอ่ยชื่อใครเลยในคลิปนี้');
  const dump = JSON.stringify(r.insight);
  assert.equal(dump.includes('อาทิตย์'), false, dump);
  assert.equal(dump.includes('วงศ์งาม'), false, dump);
  assert.deepEqual(r.insight.speakers, [NAME_PLACEHOLDER]);
  assert.deepEqual(r.unresolved, []);
});

test('CB-07: หลายคนถูกตัดทิ้งพร้อมกันในเนื้อเดียว ต้องไม่รบกวนกันเอง และกวาดครบทั้งคู่', () => {
  const insight = {
    speakers: ['อาทิตย์ วงศ์งาม', 'บุญมี แสงทอง'],
    headline: 'อาทิตย์ วงศ์งาม และ บุญมี แสงทอง ให้สัมภาษณ์',
    overview: 'บุญมี แสงทอง เล่าว่าอาทิตย์ วงศ์งาม ทำเรื่องดี',
    rawData: 'วันนี้อาทิตย์ วงศ์งาม พบกับบุญมี แสงทอง ที่งานเทศกาล',
  };
  const r = repairFabricatedNames(insight, 'มีการจัดงานเทศกาลใหญ่ในตัวเมือง ไม่มีการเอ่ยชื่อใครเลย');
  const dump = JSON.stringify(r.insight);
  for (const w of ['อาทิตย์', 'วงศ์งาม', 'บุญมี', 'แสงทอง']) {
    assert.equal(dump.includes(w), false, `คำว่า "${w}" ต้องถูกกวาดออกหมด: ${dump}`);
  }
  assert.deepEqual(r.insight.speakers, [NAME_PLACEHOLDER]);
  assert.deepEqual(r.unresolved, []);
});

test('CB-07: คำแทนกลางที่ซ้ำติดกันหลังกวาด ต้องถูกยุบเหลือตัวเดียว (DUP_PLACEHOLDER)', () => {
  const insight = {
    speakers: ['สมชาย ใจดี'],
    headline: 'สมชาย ใจดี สมชาย ให้สัมภาษณ์ซ้ำสองรอบ',
  };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อใครถูกกล่าวถึงเลยในคลิปนี้');
  assert.equal(r.insight.headline, `${NAME_PLACEHOLDER} ให้สัมภาษณ์ซ้ำสองรอบ`);
  assert.equal(new RegExp(`${NAME_PLACEHOLDER}.*${NAME_PLACEHOLDER}`).test(r.insight.headline), false);
});

test('CB-07: ตัดบางส่วน (เหลือชื่อที่มีหลักฐาน) — นามสกุลที่ยังค้างเดี่ยวๆ ในอีกช่อง ต้องรายงาน unresolved', () => {
  const insight = {
    speakers: ['วิชัย รักชาติ'],
    headline: 'รักชาติ ให้สัมภาษณ์อย่างมั่นใจ', // เขียนถึงแค่ "นามสกุล" เดี่ยวๆ ไม่มี "วิชัย" นำหน้า
    rawData: 'วิชัย บอกว่าไม่มีอะไรผิดปกติ',
  };
  const r = repairFabricatedNames(insight, 'วิชัยบอกว่าทุกอย่างเรียบร้อยดี');
  assert.deepEqual(r.insight.speakers, ['วิชัย']); // ส่วนที่มีหลักฐานถูกเก็บไว้
  assert.equal(r.insight.rawData, 'วิชัย บอกว่าไม่มีอะไรผิดปกติ'); // ช่องนี้ไม่มีนามสกุลค้าง ไม่ถูกแตะ
  assert.equal(r.insight.headline, 'รักชาติ ให้สัมภาษณ์อย่างมั่นใจ'); // ยังค้างจริง (พิสูจน์ unresolved ไม่ใช่ false-positive)
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].name, 'รักชาติ');
});

test('CB-07: ชื่อที่มีหลักฐานครบทั้งคำ ห้ามแตะต้องเลย', () => {
  const insight = { speakers: ['ตั้ม ประดิษฐ์', 'ผู้สื่อข่าว'], rawData: 'ตั้ม ประดิษฐ์ พูดในรายการวันนี้' };
  const r = repairFabricatedNames(insight, 'ตั้ม ประดิษฐ์ มาออกรายการวันนี้ที่สตูดิโอ');
  assert.deepEqual(r.insight.speakers, ['ตั้ม ประดิษฐ์', 'ผู้สื่อข่าว']);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.insight.rawData, 'ตั้ม ประดิษฐ์ พูดในรายการวันนี้');
});

// หมายเหตุ: ตั้งใจไม่เขียนเทส "ผ่าน checkAgainstTruth รอบถัดไป" ตรงนี้ — พิสูจน์แล้วว่าไม่ discriminating
// เพราะ checkAgainstTruth ①ตรวจของงอก-ชื่อ วนเฉพาะ insight.speakers เท่านั้น ไม่ได้ scan headline/rawData
// หาชื่อเลย ต่อให้ CB-07 กวาด rawData ไม่ครบ (คือย้อนกลับไปเป็นบั๊กเดิม) checkAgainstTruth ก็ตอบ "สะอาด"
// เหมือนกันทั้งคู่ — จึงตรวจตรงๆ ที่ผลลัพธ์ของ repairFabricatedNames เองแทน (เทสด้านบนทำอยู่แล้ว)

test('CB-07: ฟิลด์ null/undefined ต้องไม่ throw และคงค่าเดิมไว้ (ไม่แปลงเป็นสตริง "null")', () => {
  const insight = { speakers: ['อาทิตย์ วงศ์งาม'], headline: null, overview: undefined, rawData: 'อาทิตย์ วงศ์งาม พูด' };
  // เรียกตรงๆ — ถ้า throw จริง node:test จะรายงาน error ของเทสนี้ทันทีอยู่แล้ว
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  assert.equal(r.insight.headline, null);
  assert.equal(r.insight.overview, undefined);
  assert.equal(r.insight.rawData.includes('อาทิตย์'), false);
});

test('CB-07: subStories ที่มี entry เป็น null ปนอยู่ ต้องไม่ throw และก้อนที่เป็นออบเจกต์จริงยังถูกกวาดตามปกติ', () => {
  const insight = {
    speakers: ['อาทิตย์ วงศ์งาม'],
    subStories: [null, { no: 1, topic: 'อาทิตย์ วงศ์งาม ให้ข้อมูล', rawData: 'อาทิตย์บอกว่า...', quotes: ['วงศ์งามพูดว่าดี'] }],
  };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  assert.equal(r.insight.subStories[0], null);
  assert.equal(r.insight.subStories[1].topic.includes('อาทิตย์'), false);
  assert.equal(r.insight.subStories[1].rawData.includes('อาทิตย์'), false);
});

/* ══════════ CB-07 รอบสอง (26 ส.ค.) — swapDeep เดินเฉพาะใบสตริง รักษารูปโครงสร้าง ══════════ */
/* พิสูจน์ประเด็นที่โซลบอกว่า "บางส่วน": เดิม String() ทับทุกอย่างจน keyPoint แบบ {point,detail} พังเป็น '[object Object]'
   โพรบต้นเรื่อง: repairFabricatedNames({speakers:['สมชาย'],keyPoints:[{point:'ประเด็นเดิม'}]}, 'สมชาย')
   → ของเดิม (String() ทับทุกอย่าง) คืน keyPoints[0]==='[object Object]' ทั้งที่ไม่มีชื่อให้ซ่อมสักตัว */

test('CB-07 (ปิดจุดที่ 1 — โพรบตรงจากโจทย์): keyPoints แบบออบเจกต์ {point} ต้องไม่กลายเป็นสตริง "[object Object]"', () => {
  // ไม่มีชื่อให้ซ่อมสักตัว (speakers ตรงกับ truth เป๊ะ) แต่ของเดิมพังทั้งที่ไม่ต้องแก้อะไรเลย
  const r = repairFabricatedNames({ speakers: ['สมชาย'], keyPoints: [{ point: 'ประเด็นเดิม' }] }, 'สมชาย');
  assert.equal(typeof r.insight.keyPoints[0], 'object', `คาดว่าเป็นออบเจกต์ ได้ ${JSON.stringify(r.insight.keyPoints)}`);
  assert.notEqual(r.insight.keyPoints[0], '[object Object]');
  assert.deepEqual(r.insight.keyPoints[0], { point: 'ประเด็นเดิม' });
});

test('CB-07: keyPoints แบบ {point, detail} ที่ต้องซ่อมจริง ต้องคงรูป object ไว้ พร้อมสลับชื่อในสตริงลูกให้ครบ', () => {
  const insight = {
    speakers: ['อาทิตย์ วงศ์งาม'],
    keyPoints: [
      { point: 'อาทิตย์ วงศ์งาม พูดถึงเรื่องนี้ก่อนใคร', detail: 'วงศ์งามเน้นย้ำชัดเจนว่าไม่มีปัญหา' },
    ],
  };
  const r = repairFabricatedNames(insight, 'ไม่มีการเอ่ยชื่อใครเลยในคลิปนี้');
  const kp = r.insight.keyPoints[0];
  assert.equal(Array.isArray(r.insight.keyPoints), true);
  assert.equal(typeof kp, 'object');
  assert.ok('point' in kp && 'detail' in kp, 'ต้องมีคีย์ครบทั้ง point และ detail เหมือนเดิม');
  assert.equal(kp.point.includes('อาทิตย์'), false);
  assert.equal(kp.point.includes('วงศ์งาม'), false);
  assert.equal(kp.detail.includes('วงศ์งาม'), false);
  assert.equal(kp.point.includes(NAME_PLACEHOLDER), true);
});

test('CB-07: ตัวเลข/บูลีน/null/undefined ที่ปนอยู่ใน keyPoint แบบออบเจกต์ ต้องไม่ถูกแปลงเป็นสตริง', () => {
  const insight = {
    speakers: ['อาทิตย์ วงศ์งาม'],
    keyPoints: [{ point: 'อาทิตย์ วงศ์งาม ให้ข้อมูลชัดเจน', score: 7, verified: true, note: null, tag: undefined }],
  };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  const kp = r.insight.keyPoints[0];
  assert.equal(kp.score, 7);
  assert.equal(typeof kp.score, 'number');
  assert.equal(kp.verified, true);
  assert.equal(typeof kp.verified, 'boolean');
  assert.equal(kp.note, null);
  assert.ok('tag' in kp, 'คีย์ tag ต้องยังอยู่แม้ค่าเป็น undefined');
  assert.equal(kp.tag, undefined);
  assert.equal(kp.point.includes('อาทิตย์'), false);
});

test('CB-07: quotes แบบ array ของออบเจกต์ {speaker, text} (ไม่ใช่สตริงตรงๆ) ต้องคงรูปและสลับชื่อในลูกได้', () => {
  const insight = {
    speakers: ['อาทิตย์ วงศ์งาม'],
    quotes: [{ speaker: 'อาทิตย์ วงศ์งาม', text: 'อาทิตย์ วงศ์งาม บอกว่าไม่รู้เรื่องนี้เลย' }],
  };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  const q = r.insight.quotes[0];
  assert.equal(typeof q, 'object');
  assert.ok('speaker' in q && 'text' in q);
  assert.equal(q.speaker, NAME_PLACEHOLDER);
  assert.equal(q.text.includes('อาทิตย์'), false);
});

test('CB-07: subStories.keyPoints แบบออบเจกต์ ก็ต้องถูกกวาด+คงรูปเหมือนใบหลัก (ครอบทั้งใบหลักและ subStories)', () => {
  const insight = {
    speakers: ['อาทิตย์ วงศ์งาม'],
    subStories: [{
      no: 1, topic: 'หัวข้อย่อย', rawData: 'เนื้อย่อย',
      keyPoints: [{ point: 'อาทิตย์ วงศ์งาม พูดในที่ประชุม', weight: 3 }],
    }],
  };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  const kp = r.insight.subStories[0].keyPoints[0];
  assert.equal(typeof kp, 'object');
  assert.equal(kp.weight, 3);
  assert.equal(typeof kp.weight, 'number');
  assert.equal(kp.point.includes('อาทิตย์'), false);
  assert.equal(kp.point.includes(NAME_PLACEHOLDER), true);
});

test('CB-07: ออบเจกต์เดียวกันถูกอ้างซ้ำเป็น "พี่น้องกัน" ในอาเรย์ (ไม่ใช่วนเป็นวง) ต้องถูกกวาดครบทั้งสองตำแหน่ง', () => {
  // ถ้าตัวกันวนใช้ Set เดียวตลอดทั้งต้นไม้โดยไม่ลบตอนถอย (ไม่ใช่ per-path) ตัวที่สองจะถูกมองว่า "เจอแล้ว" แล้วข้ามซ่อม
  const shared = { point: 'อาทิตย์ วงศ์งาม พูดในที่แจ้ง' };
  const insight = { speakers: ['อาทิตย์ วงศ์งาม'], keyPoints: [shared, shared] };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  assert.equal(r.insight.keyPoints[0].point.includes('อาทิตย์'), false, 'ตัวแรกต้องถูกกวาด');
  assert.equal(r.insight.keyPoints[1].point.includes('อาทิตย์'), false, 'ตัวที่สอง (อ้างวัตถุเดียวกัน) ก็ต้องถูกกวาดเช่นกัน');
  assert.equal(r.insight.keyPoints[0].point, r.insight.keyPoints[1].point);
});

test('CB-07: โครงสร้างที่วนเป็นวงจริง (self-reference) ต้องไม่ throw/ค้าง และชั้นที่เข้าถึงได้ยังถูกซ่อมตามปกติ', () => {
  const circular = { point: 'อาทิตย์ วงศ์งาม พูด' };
  circular.self = circular; // วนกลับหาตัวเอง
  const insight = { speakers: ['อาทิตย์ วงศ์งาม'], keyPoints: [circular] };
  // เรียกตรงๆ — ถ้า throw หรือค้าง (infinite loop) node:test จะจับได้เอง (throw ทันที / timeout)
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  assert.equal(r.insight.keyPoints[0].point.includes('อาทิตย์'), false);
  assert.equal(typeof r.insight.keyPoints[0].self, 'object');
});

test('CB-07: คีย์ "__proto__" ที่เป็น own-property (มาจาก JSON.parse) ต้องถูกคัดลอกแบบข้อมูลธรรมดา ห้ามไปโดน setter จน prototype โดนแก้', () => {
  const evil = JSON.parse('{"__proto__":{"point":"อาทิตย์ วงศ์งาม พูดในที่แจ้ง"}}');
  assert.ok(Object.prototype.hasOwnProperty.call(evil, '__proto__'), 'เตรียมเคสผิด: ต้องเป็น own property ไม่ใช่ prototype จริง');
  const insight = { speakers: ['อาทิตย์ วงศ์งาม'], keyPoints: [evil] };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  const out = r.insight.keyPoints[0];
  assert.equal(Object.getPrototypeOf(out), Object.prototype, 'prototype ของออบเจกต์ผลลัพธ์ต้องไม่ถูกแก้');
  assert.equal(Object.prototype.point, undefined, 'ห้ามมีการเปื้อน Object.prototype ทั้งระบบ');
  assert.ok(Object.prototype.hasOwnProperty.call(out, '__proto__'), 'ต้องยังมี "__proto__" เป็น own key อยู่ (ไม่หายไปเงียบๆ)');
  const nested = Object.getOwnPropertyDescriptor(out, '__proto__').value;
  assert.equal(nested.point.includes('อาทิตย์'), false, 'ค่าข้างในคีย์ __proto__ ก็ต้องถูกกวาดชื่อเหมือนช่องอื่น');
});

test('CB-07: อินสแตนซ์ Date ที่ปนอยู่ในโครงสร้าง ต้องคืนตามเดิม (ไม่แปลงรูป ไม่โคลนใหม่)', () => {
  const capturedAt = new Date('2026-08-26T00:00:00Z');
  const insight = { speakers: ['อาทิตย์ วงศ์งาม'], keyPoints: [{ point: 'อาทิตย์ วงศ์งาม พูด', capturedAt }] };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  assert.ok(r.insight.keyPoints[0].capturedAt instanceof Date);
  assert.equal(r.insight.keyPoints[0].capturedAt, capturedAt, 'ต้องเป็น instance เดิมเป๊ะ ไม่ใช่แค่ค่าเวลาเท่ากัน');
});

test('CB-07: อินสแตนซ์ Map ที่ปนอยู่ในโครงสร้าง ต้องคืนตามเดิม (ไม่แปลงรูป ไม่โคลนใหม่) เหมือน Date', () => {
  const extra = new Map([['a', 1]]);
  const insight = { speakers: ['อาทิตย์ วงศ์งาม'], keyPoints: [{ point: 'อาทิตย์ วงศ์งาม พูด', extra }] };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อเลยในคลิปนี้');
  assert.ok(r.insight.keyPoints[0].extra instanceof Map);
  assert.equal(r.insight.keyPoints[0].extra, extra, 'ต้องเป็น instance เดิมเป๊ะ');
  assert.equal(r.insight.keyPoints[0].point.includes('อาทิตย์'), false, 'field อื่นในก้อนเดียวกันต้องยังถูกสลับตามปกติ');
});

test('CB-07: เดินลึกได้จริงถึง 6 ชั้นในโครงสร้างซ้อนกัน (ยังไม่ถึงเพดาน) — ชื่อที่ฝังลึกต้องถูกสลับ', () => {
  const nest6 = { inner: { inner: { inner: { inner: { inner: { point: 'อาทิตย์ วงศ์งาม พูด' } } } } } };
  const r = repairFabricatedNames({ speakers: ['อาทิตย์ วงศ์งาม'], keyPoints: [nest6] }, 'ไม่มีชื่อเลยในคลิปนี้');
  const leaf = r.insight.keyPoints[0].inner.inner.inner.inner.inner;
  assert.equal(leaf.point.includes('อาทิตย์'), false, 'ที่ความลึกนี้ (ในเพดาน 8 ชั้น) ต้องยังสลับชื่อได้');
});

test('CB-07: โครงสร้างที่ลึกเกินปกติมาก (500 ชั้น) ต้องไม่ throw/ค้าง — เพดานลึกทำงานป้องกัน stack ระเบิด', () => {
  let deep = { point: 'อาทิตย์ วงศ์งาม พูด' };
  for (let i = 0; i < 500; i += 1) deep = { inner: deep };
  const t0 = Date.now();
  const r = repairFabricatedNames({ speakers: ['อาทิตย์ วงศ์งาม'], keyPoints: [deep] }, 'ไม่มีชื่อเลยในคลิปนี้');
  const elapsedMs = Date.now() - t0;
  assert.ok(elapsedMs < 2000, `ใช้เวลานานผิดปกติ (${elapsedMs}ms) — สงสัยเพดานลึกไม่ทำงาน`);
  // แค่พิสูจน์ว่าไม่ throw และโครงสร้างชั้นนอกยังเป็นออบเจกต์ปกติ (ไม่ต้องเช็คว่าสลับชื่อถึงชั้นในสุดหรือไม่)
  assert.equal(typeof r.insight.keyPoints[0], 'object');
});

test('CB-07: ชื่อที่ถูกตัดบางส่วนแล้วยังฝังค้างอยู่ใน keyPoint แบบออบเจกต์ (ไม่ใช่สตริงตรงๆ) ต้องยังโผล่ใน unresolved', () => {
  // นี่คือบั๊กรอบสองของ CB-07 ตามโจทย์เป๊ะ: ตัวตรวจ unresolved เดิมใช้ String() ต่อฟิลด์
  // ถ้า keyPoints เป็น array ของ object, String(arrayOfObjects) จะได้ "[object Object]" ทำให้หาไม่เจอว่า "รักชาติ" ยังค้างอยู่
  const insight = {
    speakers: ['วิชัย รักชาติ'], // 'วิชัย' มีหลักฐาน, 'รักชาติ' ไม่มี — ถูกตัดบางส่วน
    keyPoints: [{ point: 'รักชาติ ยืนยันข้อมูลชัดเจน', detail: 'ไม่มีอะไรผิดปกติ' }], // นามสกุลค้างอยู่ในนี้ ไม่ใช่ headline
  };
  const r = repairFabricatedNames(insight, 'วิชัยบอกว่าทุกอย่างเรียบร้อยดี');
  assert.deepEqual(r.insight.speakers, ['วิชัย']);
  assert.equal(r.insight.keyPoints[0].point, 'รักชาติ ยืนยันข้อมูลชัดเจน', 'ช่องนี้ไม่ถูกแตะจริง (ตัดบางส่วนไม่ทำ token-replace) — พิสูจน์ไม่ใช่ false positive');
  assert.equal(r.unresolved.length, 1, `คาดว่าต้องเจอ 1 รายการ ได้ ${JSON.stringify(r.unresolved)}`);
  assert.equal(r.unresolved[0].name, 'รักชาติ');
});
