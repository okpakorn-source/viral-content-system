/**
 * 🧪 clip-verify-guards.test.mjs — ข้อสอบ clipVerify.js หลังปิด CB-05/06/07/11 (26 ส.ค. 69)
 * ------------------------------------------------------------------------------
 * ทุกเคสมาจาก probe ของผู้ตรวจอิสระ (scratch/review-sol-max.md) — ตรวจพฤติกรรมจริง
 * ไม่ยิง AI ไม่แตะเน็ต ไม่แตะไฟล์
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  isRolePlaceholder, checkAgainstTruth, applyRepairPatch, repairFabricatedNames, NAME_PLACEHOLDER,
} = await import(new URL('../src/lib/services/clipBrain/clipVerify.js', import.meta.url).href);

/* ───────────────────────── CB-05 คำแทนบทบาท vs ชื่อจริง ───────────────────────── */

test('CB-05 ชื่อคนที่พ่วงหลังคำบทบาท ต้องไม่ถูกตีเป็นคำแทน', () => {
  assert.equal(isRolePlaceholder('เจ้าหน้าที่ สมชาย ใจดี'), false);
  assert.equal(isRolePlaceholder('พิธีกรผู้ดำเนินรายการ สมชาย ใจดี'), false);
  assert.equal(isRolePlaceholder('ชายที่ชื่อ สมชาย ใจดี'), false);
  assert.equal(isRolePlaceholder('คุณกนกพร นระทีทาน'), false);
});

test('CB-05 คำแทนบทบาทล้วน ยังต้องถูกข้าม (กันบั๊ก #4 กลับมา)', () => {
  for (const s of ['ชายที่ร้านก๋วยเตี๋ยว', 'หญิงสาวผู้ดำเนินรายการ', 'พิธีกรหญิง', 'ผู้สื่อข่าว', 'เจ้าของร้าน', 'ชายในคลิป', NAME_PLACEHOLDER]) {
    assert.equal(isRolePlaceholder(s), true, s);
  }
});

test('CB-05 ชื่อแต่งหลังคำบทบาท ต้องขึ้นธง "ของงอก-ชื่อ"', () => {
  const r = checkAgainstTruth({ speakers: ['เจ้าหน้าที่ สมชาย ใจดี'] }, 'วันนี้มีเหตุที่ตลาด เจ้าหน้าที่ลงพื้นที่ตรวจสอบ');
  const hit = r.findings.filter((f) => f.kind === 'ของงอก-ชื่อ');
  assert.equal(hit.length, 1);
  assert.match(hit[0].detail, /สมชาย/);
});

/* ───────────────────────── CB-11 หน้าต่างจับคำพูด ───────────────────────── */

// ท่อนต่อเนื่องที่ตรงกันมีแค่ 14 ตัวพอดี และเริ่มที่ offset 1-3 — โค้ดเดิม (i += 4) มองไม่เห็น
const offsetCase = (base, off) => ({ quote: base.slice(0, 14 + off), truth: base.slice(off, 14 + off) });

test('CB-11 คำพูดที่ตรงจริงแต่เหลื่อม offset 1-3 ต้องไม่ถูกเตือน', () => {
  for (const off of [1, 2, 3]) {
    const { quote, truth } = offsetCase('abcdefghijklmnopqrst', off);
    const r = checkAgainstTruth({ quotes: [quote] }, truth);
    assert.equal(r.findings.filter((f) => f.kind === 'คำพูดไม่ตรงคลิป').length, 0, `offset ${off}`);
  }
});

test('CB-11 คำพูดไทยที่เหลื่อมต้นประโยค ต้องไม่ถูกเตือน', () => {
  for (const off of [1, 2, 3]) {
    const { quote, truth } = offsetCase('ผมไม่เคยรับเงินจากใครเลยครับยืนยัน', off);
    const r = checkAgainstTruth({ quotes: [quote] }, truth);
    assert.equal(r.findings.filter((f) => f.kind === 'คำพูดไม่ตรงคลิป').length, 0, `offset ${off}`);
  }
});

test('CB-11 คำพูดที่ไม่มีในคลิปจริง ยังต้องถูกเตือนอยู่', () => {
  const r = checkAgainstTruth({ quotes: ['ผมจะลาออกจากตำแหน่งภายในสิ้นเดือนนี้แน่นอน'] }, 'วันนี้อากาศดีมาก เรามาคุยเรื่องอาหารกลางวันกันดีกว่า');
  assert.equal(r.findings.filter((f) => f.kind === 'คำพูดไม่ตรงคลิป').length, 1);
});

/* ───────────────────────── CB-06 ด่านรับแพตช์ ───────────────────────── */

const baseInsight = () => ({
  headline: 'หัวข้อเดิม',
  overview: 'เรื่องย่อเดิม',
  rawData: 'ก'.repeat(200),
  speakers: ['ก1', 'ก2', 'ก3'],
  quotes: ['คำพูดหนึ่ง', 'คำพูดสอง'],
  subStories: [{ no: 1, topic: 'หัวข้อย่อย 1', timeRange: '00:00-01:00', rawData: 'ข'.repeat(200), quotes: ['อ้างหนึ่ง'] }],
});

test('CB-06 patch ผิดรูปทั้งก้อน ห้าม throw และต้องคืนของเดิม', () => {
  for (const bad of [null, undefined, 'สตริง', 42, [1, 2]]) {
    const r = applyRepairPatch(baseInsight(), bad);
    assert.deepEqual(r.changed, []);
    assert.equal(r.insight.headline, 'หัวข้อเดิม');
    assert.ok(Array.isArray(r.rejected));
  }
});

test('CB-06 subStories=[null] ต้องไม่โยน TypeError', () => {
  const r = applyRepairPatch(baseInsight(), { subStories: [null] });
  assert.equal(r.insight.subStories.length, 1);
  assert.equal(r.changed.includes('subStories'), false);
  assert.ok(r.rejected.length > 0);
});

test('CB-06 quotes/keyPoints ที่ไม่ใช่ array ต้องไม่โยน', () => {
  const r1 = applyRepairPatch(baseInsight(), { quotes: 'ไม่ใช่ array' });
  assert.deepEqual(r1.insight.quotes, ['คำพูดหนึ่ง', 'คำพูดสอง']);
  assert.ok(r1.rejected.some((x) => x.where === 'quotes'));

  const r2 = applyRepairPatch(baseInsight(), { subStories: [{ no: 1, quotes: 'x', keyPoints: 'y' }] });
  assert.deepEqual(r2.insight.subStories[0].quotes, ['อ้างหนึ่ง']);

  // ★ 26 ส.ค. 69 (รอบ 3 — ผู้ตรวจอิสระสั่งปิด CB-06 ให้สุด): ก้อนใหม่ต้องผูกหลักฐาน finding
  //   ไม่ส่ง findings มา = ไม่รับก้อนใหม่เลย · เทสนี้จึงยืนยัน "ค่าผิดชนิดต้องไม่ทำใบเดิมเสีย"
  const r3 = applyRepairPatch(baseInsight(), { subStories: [{ no: 9, topic: 'ใหม่', rawData: 'ค'.repeat(80), quotes: 'x', keyPoints: 'y' }] });
  assert.equal(r3.insight.subStories.length, 1);
  assert.deepEqual(r3.insight.subStories[0].quotes, ['อ้างหนึ่ง']);
});

test('CB-06 no แบบสตริง "1" ต้องชนก้อนเดิม ไม่เพิ่มก้อนซ้ำ', () => {
  const r = applyRepairPatch(baseInsight(), { subStories: [{ no: '1', topic: 'หัวข้อย่อยใหม่' }] });
  assert.equal(r.insight.subStories.length, 1);
  assert.equal(r.insight.subStories[0].topic, 'หัวข้อย่อยใหม่');
});

// ★ 26 ส.ค. 69 (รอบ 3): เปลี่ยนกฎจาก "จำกัด 3 ก้อน" เป็น "ต้องมีหลักฐานผูก finding"
//   เหตุผล: ผู้ตรวจอิสระพิสูจน์ว่าเพดาน 3 ก้อนยังเปิดให้ตัวซ่อมเติมเรื่องแต่งได้ (CB-06 ปิดไม่สุด)
test('CB-06 ไม่ส่ง findings มา = ห้ามเพิ่มก้อนใหม่แม้แต่ก้อนเดียว', () => {
  const p = { subStories: [2, 3, 4, 5, 6].map((no) => ({ no, topic: `ใหม่ ${no}`, rawData: 'ง'.repeat(80) })) };
  const r = applyRepairPatch(baseInsight(), p);
  assert.equal(r.insight.subStories.length, 1);           // ใบเดิมไม่ถูกเติม
  const noEvidence = r.rejected.filter((x) => /หลักฐาน|findings/.test(x.why || ''));
  assert.equal(noEvidence.length, 5);                      // ปฏิเสธครบทั้ง 5 ก้อน พร้อมเหตุผลชัด
  assert.equal(r.changed.length, 0);                       // ไม่มีช่องไหนถูกแก้จริง
});

test('CB-06 เนื้อหดผิดปกติต้องถูกปฏิเสธ (ทั้งช่องหลักและก้อนย่อย)', () => {
  const r = applyRepairPatch(baseInsight(), { rawData: 'ก', subStories: [{ no: 1, rawData: 'ข' }] });
  assert.equal(r.insight.rawData.length, 200);
  assert.equal(r.insight.subStories[0].rawData.length, 200);
  assert.equal(r.changed.length, 0);
});

test('CB-06 array ห้ามสั้นลง', () => {
  const r = applyRepairPatch(baseInsight(), { speakers: ['เหลือคนเดียว'], quotes: ['เหลืออันเดียว'] });
  assert.deepEqual(r.insight.speakers, ['ก1', 'ก2', 'ก3']);
  assert.deepEqual(r.insight.quotes, ['คำพูดหนึ่ง', 'คำพูดสอง']);
  assert.equal(r.changed.length, 0);
});

test('CB-06 changed ต้องรายงานเฉพาะที่เปลี่ยนจริง', () => {
  const noop = applyRepairPatch(baseInsight(), {
    headline: 'หัวข้อเดิม', speakers: ['ก1', 'ก2', 'ก3'],
    subStories: [{ no: 1, topic: 'หัวข้อย่อย 1', timeRange: '00:00-01:00' }],
  });
  assert.deepEqual(noop.changed, []);

  const real = applyRepairPatch(baseInsight(), { headline: 'หัวข้อใหม่ที่แก้แล้ว' });
  assert.deepEqual(real.changed, ['headline']);
  assert.equal(real.insight.headline, 'หัวข้อใหม่ที่แก้แล้ว');
});

test('CB-06 ของดีต้องยังผ่านได้ (ไม่ใช่ปิดตายทั้งหมด)', () => {
  const r = applyRepairPatch(baseInsight(), {
    overview: 'เรื่องย่อที่แก้ให้ตรงคลิปแล้ว',
    speakers: ['ก1', 'ก2', 'ก3', 'ก4'],
    subStories: [{ no: 1, rawData: 'ข'.repeat(300) }],
  });
  assert.ok(r.changed.includes('overview'));
  assert.ok(r.changed.includes('speakers'));
  assert.ok(r.changed.includes('subStories'));
  assert.equal(r.insight.subStories[0].rawData.length, 300);
});

/* ───────────────────────── CB-07 กวาดชื่อแต่งออกจากเนื้อ ───────────────────────── */

test('CB-07 ตัดทิ้งทั้งชื่อ ต้องกวาดชื่อออกจากทุกช่องข้อความด้วย', () => {
  const insight = {
    speakers: ['สมชาย ใจดี'],
    headline: 'สมชาย ใจดี เปิดใจ',
    overview: 'สมชาย ใจดี เล่าเหตุการณ์',
    rawData: 'สมชาย ใจดี กล่าวข้อความ ต่อมาสมชายเดินออกไป',
    quotes: ['สมชาย ใจดี: ผมไม่รู้เรื่อง'],
    keyPoints: ['สมชาย ใจดี ยืนยัน'],
    subStories: [{ no: 1, topic: 'สมชาย ใจดี ให้การ', rawData: 'ใจดี บอกว่าไม่รู้', quotes: ['สมชาย พูด'] }],
  };
  const r = repairFabricatedNames(insight, 'ไม่มีชื่อใครในคลิปนี้เลย');
  const dump = JSON.stringify(r.insight);
  assert.equal(dump.includes('สมชาย'), false, dump);
  assert.equal(dump.includes('ใจดี'), false, dump);
  assert.ok(dump.includes(NAME_PLACEHOLDER));
  assert.deepEqual(r.insight.speakers, [NAME_PLACEHOLDER]);
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].mode, 'ตัดทั้งชื่อ');
});

test('CB-07 ตัดบางส่วน ยังทำงานเหมือนเดิม และรายงาน unresolved ถ้ายังค้าง', () => {
  const insight = {
    speakers: ['พลอย รัญดภา'],
    headline: 'พลอย รัญดภา เปิดใจ',
    rawData: 'พลอย รัญดภา บอกว่า ... ต่อมารัญดภาเดินออกไป',
  };
  const r = repairFabricatedNames(insight, 'พลอยบอกว่าเธอไม่รู้เรื่อง');
  assert.deepEqual(r.insight.speakers, ['พลอย']);
  assert.equal(r.insight.headline, 'พลอย เปิดใจ');
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].name, 'รัญดภา');
  assert.ok(r.changes.length === 1);
});

test('CB-07 ชื่อที่มีหลักฐานครบ ห้ามแตะ', () => {
  const insight = { speakers: ['ตั๊ก ศิริพร', 'ผู้สื่อข่าว'], rawData: 'ตั๊ก ศิริพร พูดในรายการ' };
  const r = repairFabricatedNames(insight, 'ตั๊ก ศิริพร มาออกรายการวันนี้');
  assert.deepEqual(r.insight.speakers, ['ตั๊ก ศิริพร', 'ผู้สื่อข่าว']);
  assert.deepEqual(r.changes, []);
  assert.equal(r.insight.rawData, 'ตั๊ก ศิริพร พูดในรายการ');
});

test('CB-07 ผลซ่อมต้องผ่านตัวตรวจรอบถัดไปโดยไม่มีธงชื่อใหม่', () => {
  const insight = { speakers: ['สมชาย ใจดี'], rawData: 'สมชาย ใจดี กล่าวข้อความ' };
  const fixed = repairFabricatedNames(insight, 'ไม่มีชื่อใครในคลิปนี้เลย').insight;
  const r = checkAgainstTruth(fixed, 'ไม่มีชื่อใครในคลิปนี้เลย');
  assert.equal(r.findings.filter((f) => f.kind === 'ของงอก-ชื่อ').length, 0);
});
