// ข้อสอบ "ผู้กำหนดทิศทางข่าว" (10 พ.ย. 69) — import โค้ดจริง · ไม่ยิง API · ไม่แตะฐานข้อมูล
// รัน: node --test tests/angle-director.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAngleExemplars, _resetAngleCache, ANGLE_RULES, buildAnglePrompt, readAngleBrief, angleForVersion,
  formatAngleForWriter, missingMustKeep, directAngle,
} from '../src/lib/services/angleDirector.js';
import { buildTeacherPrompt, checkTeacherForm, buildFactCheckPrompt, TEACHER_RULES } from '../src/lib/services/teacherWriter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exemplars = loadAngleExemplars({ file: path.join(ROOT, 'data', 'angle-exemplars', 'angle-library.json') });
const RAW = 'น้องเอ อายุ 19 ปี เก็บเงินได้ 50,000 บาท จากการขายข้าวแกง 3 ปี เพื่อส่งตัวเองเรียนมหาวิทยาลัย น้องเอบอกว่า "ผมไม่อยากให้แม่ลำบากอีกแล้ว" ครูประจำชั้นเล่าว่าน้องตื่นตี 4 ทุกวัน';
const brief = (angles) => ({ angles });
const good = { focus: 'เด็กขายข้าวแกงส่งตัวเองเรียน', coverLines: ['ตื่นตี 4 ทุกวัน ขายข้าวแกง 3 ปี', '"ผมไม่อยากให้แม่ลำบากอีกแล้ว"'], order: ['เปิดด้วยกิจวัตรตีสี่', 'เล่าเงินที่เก็บได้', 'ปิดด้วยคำพูด'], mustKeep: ['50,000 บาท', 'ตื่นตี 4', 'เงิน 99 ล้าน'], exemplarIds: ['a05', 'ไม่มีจริง'], why: 'ตัวเลขเล็กคู่กับความตั้งใจ' };

test('คลังต้นแบบ: 33 ปก ทุกปกมีข้อความพาดปกและกติกาเลือกประเด็น · ผ่านการตรวจตัวสะกดซ้ำ', () => {
  assert.equal(exemplars.length, 33);
  for (const x of exemplars) {
    assert.ok(/^a\d\d$/.test(x.id), x.id);
    assert.ok(x.lines.length >= 2 && x.lines.length <= 4, `${x.id} มี ${x.lines.length} บรรทัด`);
    assert.ok(String(x.techniqueNote || '').length > 20, `${x.id} ไม่มีกติกาเลือกประเด็น`);
    assert.equal(x.verified, true, `${x.id} ยังไม่ได้ตรวจซ้ำ`);
    assert.ok(fs.existsSync(path.join(ROOT, x.image)), `${x.id} ไม่มีไฟล์ภาพ`);
  }
});

test('คลังต้นแบบ: ไฟล์หาย/ว่าง = error ที่มี errorType', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'angle-lib-'));
  try {
    _resetAngleCache();
    assert.throws(() => loadAngleExemplars({ file: path.join(dir, 'x.json') }), (e) => e.errorType === 'ANGLE_LIBRARY_UNREADABLE');
    fs.writeFileSync(path.join(dir, 'e.json'), JSON.stringify({ exemplars: [{ id: 'a01', lines: [] }] }));
    assert.throws(() => loadAngleExemplars({ file: path.join(dir, 'e.json') }), (e) => e.errorType === 'ANGLE_LIBRARY_EMPTY');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); _resetAngleCache(); }
});

test('คำสั่งผู้กำหนดทิศทาง: เห็นต้นแบบครบทุกปกและเนื้อข่าวเต็ม', () => {
  const longRaw = 'ประเด็น '.repeat(1200) + 'ท้ายสุด';
  const { system, user } = buildAnglePrompt({ rawText: longRaw, exemplars });
  assert.equal(system, ANGLE_RULES);
  for (const x of exemplars) assert.ok(user.includes(`[${x.id}] ${x.lines[0]}`), `ต้นแบบ ${x.id} ไม่อยู่ในคำสั่ง`);
  assert.ok(user.includes(longRaw), 'เนื้อข่าวถูกตัด');
  assert.throws(() => buildAnglePrompt({ rawText: 'สั้น', exemplars }), (e) => e.errorType === 'RAW_TEXT_TOO_SHORT');
});

test('อ่านผลทิศทาง: mustKeep เก็บเฉพาะที่มีในเนื้อข่าวจริง · รหัสต้นแบบมั่วถูกทิ้ง · ไม่เกิน 3 ทิศทาง', () => {
  const r = readAngleBrief(brief([good, good, good, good]), { rawText: RAW, exemplars });
  assert.equal(r.ok, true);
  assert.equal(r.angles.length, 3);
  assert.deepEqual(r.angles[0].mustKeep, ['50,000 บาท', 'ตื่นตี 4'], 'ถ้อยคำที่ไม่มีในเนื้อข่าวต้องไม่ถูกบังคับให้ใส่');
  assert.deepEqual(r.angles[0].exemplarIds, ['a05']);
  assert.deepEqual(r.angles[0].inventedQuotes, []);
});

test('ทิศทางที่แต่งคำพูดบนปกเอง: ไม่ถูกใช้เป็นตัวหลัก · ถ้าไม่มีทิศทางสะอาดเลย = ok:false', () => {
  const fake = { ...good, coverLines: ['"แม่คือทุกอย่างของชีวิตผมครับ"'] };
  const mixed = readAngleBrief(brief([fake, good]), { rawText: RAW, exemplars });
  assert.equal(mixed.ok, true);
  assert.equal(mixed.angles[0].inventedQuotes.length, 0, 'ทิศทางสะอาดต้องมาก่อน');
  assert.equal(mixed.angles[1].inventedQuotes.length, 1);
  assert.equal(angleForVersion(mixed, 0).focus, good.focus);
  assert.equal(angleForVersion(mixed, 1).focus, good.focus, 'ไม่มีทิศทางสำรองที่สะอาด = ใช้ทิศทางหลัก');
  const bad = readAngleBrief(brief([fake]), { rawText: RAW, exemplars });
  assert.equal(bad.ok, false);
  assert.equal(angleForVersion(bad, 0), null);
});

test('อ่านผลทิศทาง: JSON ในโค้ดบล็อก / ผลเสีย / ทิศทางไม่ครบช่อง', () => {
  assert.equal(readAngleBrief('```json\n' + JSON.stringify(brief([good])) + '\n```', { rawText: RAW, exemplars }).angles.length, 1);
  assert.equal(readAngleBrief('ขออภัย', { rawText: RAW }).ok, false);
  assert.equal(readAngleBrief(null, { rawText: RAW }).ok, false);
  const r = readAngleBrief(brief([{ focus: 'มีแต่ประเด็น' }, { coverLines: ['มีแต่ปก'] }, good]), { rawText: RAW, exemplars });
  assert.equal(r.angles.length, 1);
  assert.equal(r.dropped, 2);
});

test('ทิศทางถึงนักเขียนและผู้ตรวจ: ทิศทางเป็นแกน ครูเป็นแค่สำนวน', () => {
  const a = readAngleBrief(brief([good]), { rawText: RAW, exemplars }).angles[0];
  const text = formatAngleForWriter(a);
  assert.ok(text.includes('ประเด็นที่ชู: ' + good.focus) && text.includes('"ตื่นตี 4"') && text.includes('1. เปิดด้วยกิจวัตรตีสี่'));
  assert.equal(formatAngleForWriter(null), '');
  const teacher = { post: 'ย่อหน้าหนึ่ง\n\nย่อหน้าสอง\n\nย่อหน้าสาม', whyItWorks: 'เพราะ', views: 5e6 };
  const withAngle = buildTeacherPrompt({ teacher, rawText: RAW, angle: a }).user;
  assert.ok(withAngle.includes('ทิศทางข่าว (บรรณาธิการกำหนดแล้ว') && withAngle.includes(good.focus));
  assert.ok(withAngle.indexOf('เนื้อข่าวจากทีม') < withAngle.indexOf('ทิศทางข่าว (บรรณาธิการ'), 'ทิศทางต้องมาหลังเนื้อข่าว');
  assert.ok(!buildTeacherPrompt({ teacher, rawText: RAW }).user.includes('ทิศทางข่าว (บรรณาธิการ'), 'ไม่มีทิศทาง = ไม่มีหัวข้อนี้');
  assert.ok(TEACHER_RULES.includes('ห้ามใช้โพสต์ต้นแบบเปลี่ยนประเด็น'));
  assert.ok(buildFactCheckPrompt({ content: 'โพสต์', rawText: RAW, angle: a }).user.includes(good.focus));
});

test('ประเด็นต้องยังอยู่: ถ้อยคำที่ทิศทางกำหนดหายจากโพสต์ = ตก พร้อมบอกว่าขาดอะไร', () => {
  const a = readAngleBrief(brief([good]), { rawText: RAW, exemplars }).angles[0];
  assert.deepEqual(missingMustKeep('เก็บได้ 50,000 บาท จากการตื่นตี 4', a), []);
  assert.deepEqual(missingMustKeep('เก็บได้ 50,000 บาท', a), ['ตื่นตี 4']);
  const fail = checkTeacherForm('เก็บเงินได้ 50,000 บาท\n\nย่อหน้าสอง\n\nย่อหน้าสาม', { rawText: RAW, angle: a }).fails.find((f) => f.code === 'ANGLE_DROPPED');
  assert.ok(fail && fail.message.includes('"ตื่นตี 4"'));
  assert.ok(!checkTeacherForm('ข้อความ', { rawText: RAW }).fails.some((f) => f.code === 'ANGLE_DROPPED'), 'ไม่มีทิศทาง = ไม่ตรวจข้อนี้');
});

test('กำหนดทิศทาง: โมเดลล้มหรือตอบใช้ไม่ได้ = ok:false พร้อมเหตุ ไม่โยนทิ้งทั้งข่าว', async () => {
  const okRes = await directAngle({ rawText: RAW, exemplars, callModel: async () => brief([good]) });
  assert.equal(okRes.ok, true);
  const down = await directAngle({ rawText: RAW, exemplars, callModel: async () => { throw new Error('โมเดลล่ม'); } });
  assert.equal(down.ok, false);
  assert.ok(down.error.includes('โมเดลล่ม'));
  const junk = await directAngle({ rawText: RAW, exemplars, callModel: async () => 'ไม่ใช่ JSON' });
  assert.equal(junk.ok, false);
  await assert.rejects(() => directAngle({ rawText: RAW, exemplars }), /callModel/);
});

// ───────── 12 พ.ย. 69 — สามเวอร์ชันต้องต่างกันจริง (ผลตรวจ 20 ข่าวจริง: ครบ 3 ทิศทางแค่ 3 ข่าว · ผู้ประเมินให้ความต่าง 3.2/10) ─────────
import { sameAngle, countDistinctAngles, ANGLE_SAME } from '../src/lib/services/angleDirector.js';

test('กติกาผู้กำหนดทิศทาง: ขอ 3 ทิศทางที่เข้าเรื่องคนละจุด · ห้ามหยิบจุดเบาเพื่อให้ต่าง · order บอกว่าย่อหน้ากลางขยายอะไร', () => {
  assert.ok(ANGLE_RULES.includes('2. เสนอ 3 ทิศทาง'), 'ต้องขอ 3 ทิศทาง');
  assert.ok(!ANGLE_RULES.includes('ห้ามฝืนให้ครบ 3'), 'กติกาเดิมที่ทำให้ได้แค่ 2 ทิศทางต้องไม่อยู่แล้ว');
  assert.ok(ANGLE_RULES.includes('จุดคนละจุด') && ANGLE_RULES.includes('ห้ามหยิบจุดที่เบา'));
  assert.ok(ANGLE_RULES.includes('ชูจุดแรงเดิมได้ แต่ต้องเข้าเรื่องจากรายละเอียดอื่นและเรียง order ใหม่ทั้งชุด'), 'ข่าวที่มีจุดแรงจุดเดียว: ใช้จุดเดิมได้แต่ต้องเล่าคนละแบบ');
  assert.ok(ANGLE_RULES.includes('"order": ["เปิดด้วยอะไร", "ย่อหน้ากลางขยายรายละเอียดอะไรเป็นหลัก", "ปิดด้วยอะไร"]'));
  assert.ok(ANGLE_RULES.includes('บรรทัดที่เป็นชื่อคนซ้ำกันได้'), 'ปกของทีมขึ้นบรรทัดแรกด้วยชื่อคนได้ ไม่นับว่าซ้ำ');
  // กติกาข้ออื่นยังอยู่ครบ (ความจริง · ไม่ทิ้งแก่น · ให้เกียรติคนในข่าว)
  for (const keep of ['3. ทุกทิศทางต้องยืนบนข้อเท็จจริงในเนื้อข่าวเท่านั้น', '4. ทิศทางต้องไม่ทิ้งแก่นของข่าว', '5. เพจเล่าในมุมที่ให้เกียรติคนในข่าว']) assert.ok(ANGLE_RULES.includes(keep), keep);
});

test('ทิศทางซ้ำกันไหม: ประเด็นที่ชูแทบเป็นประโยคเดียวกัน หรือพาดปกทั้งชุดแทบเหมือนกัน = ซ้ำ · บรรทัดแรกเป็นชื่อคนตรงกัน = ไม่ซ้ำ', () => {
  const a = { focus: 'ชูเหตุผลทางใจของเจ้าตัวที่ถือว่าบุญสำเร็จแล้ว ไม่ขอฟ้องร้องเอาเงินคืน', coverLines: ['คนอื่นแจ้งความ แต่หนิงเลือกไม่ฟ้อง', 'บุญสำเร็จครบถ้วนตั้งแต่วันแรกที่โอน'], order: ['เปิดด้วยการสวนทางคนอื่น', 'ขยายเหตุผลทางใจ', 'ปิดด้วยเจตนาบริสุทธิ์'] };
  const b = { focus: 'ชูการวางขอบเขตที่ชัดเจน ไม่ฟ้องแต่พร้อมให้ข้อมูลหากตำรวจมีหมายเรียก', coverLines: ['หนิงไม่ฟ้อง แต่ไม่ได้ปิดประตู', 'ตำรวจมีหมายเรียก พร้อมให้ความร่วมมือ'], order: ['เปิดด้วยท่าทีต่อตำรวจ', 'ขยายสิ่งที่จะทำต่อไป', 'ปิดด้วยการส่งถึงมือผู้รับ'] };
  assert.equal(sameAngle(a, { ...a }), true, 'เหมือนกันทุกตัวอักษร');
  assert.equal(sameAngle(a, { ...a, focus: 'ชูเหตุผลทางใจของเจ้าตัว ที่ถือว่าบุญสำเร็จแล้ว ไม่ขอฟ้องเอาเงินคืน', coverLines: ['อีกแบบหนึ่งเลย'] }), true, 'ประเด็นที่ชูแค่เปลี่ยนคำ');
  assert.equal(sameAngle(a, { ...b, coverLines: a.coverLines }), true, 'พาดปกชุดเดียวกัน');
  assert.equal(sameAngle(a, b), false, 'ชูคนละจุด');
  // ปกจริงของทีมขึ้นบรรทัดแรกด้วยชื่อคนบ่อย: บรรทัดแรกตรงกันแต่ชูคนละเรื่อง = คนละทิศทาง (ตัวอย่างจริงเคส 07628)
  const p1 = { focus: 'ชูการลงมือทำตู้ปันสุขด้วยตัวเองทุกขั้นตอน', coverLines: ['ปิ่น เก็จมณี', 'ลงมือทำตู้เอง ทาสีเอง'], order: ['ก', 'ข', 'ค'] };
  const p2 = { focus: 'ชูการตัดผมยาวที่ไว้มาหลายปีไปบริจาคให้ผู้ป่วย', coverLines: ['ปิ่น เก็จมณี', 'ตัดผมบริจาค 3 ครั้งแล้ว'], order: ['ง', 'จ', 'ฉ'] };
  assert.equal(sameAngle(p1, p2), false);
  assert.equal(sameAngle(a, null), false);
  assert.equal(sameAngle({ focus: '', coverLines: [] }, { focus: '', coverLines: [] }), false, 'ทิศทางว่างไม่นับว่าซ้ำกัน');
  assert.deepEqual({ ...ANGLE_SAME }, { focus: 0.7, cover: 0.8 });
  assert.equal(countDistinctAngles([a, b, a]), 2, 'ทิศทางหลักถูกใช้ซ้ำกับเวอร์ชันที่ 3');
  assert.equal(countDistinctAngles([a, a, a]), 1);
  assert.equal(countDistinctAngles([a, b, p1]), 3);
  assert.equal(countDistinctAngles([]), 0);
  assert.equal(countDistinctAngles([null, a]), 1);
});

test('ผลของผู้กำหนดทิศทางบอกจำนวนทิศทางที่ต่างกันจริง (ไม่นับทิศทางที่แต่งคำพูดเอง) · ทิศทางไม่ครบ = เวอร์ชันที่เกินใช้ทิศทางหลัก', () => {
  const other = { ...good, focus: 'ชูตัวเลขเงินเก็บที่ได้จากการขายข้าวแกง', coverLines: ['เก็บเงินได้ 50,000 บาท', 'จากข้าวแกงจานละไม่กี่บาท'], order: ['เปิดด้วยตัวเลข', 'ขยายวิธีเก็บเงิน', 'ปิดด้วยเป้าหมาย'] };
  const fake = { ...good, focus: 'ชูคำพูดที่แต่งขึ้น', coverLines: ['"แม่คือทุกอย่างของชีวิตผมครับ"'] };
  assert.equal(readAngleBrief(brief([good, other]), { rawText: RAW, exemplars }).distinct, 2);
  assert.equal(readAngleBrief(brief([good, good, good]), { rawText: RAW, exemplars }).distinct, 1, 'ส่งมา 3 แต่เป็นทิศทางเดียวกัน = ต่างกันจริง 1');
  assert.equal(readAngleBrief(brief([good, other, fake]), { rawText: RAW, exemplars }).distinct, 2, 'ทิศทางที่แต่งคำพูดเองไม่นับ');
  assert.equal(readAngleBrief(brief([fake]), { rawText: RAW, exemplars }).distinct, 0);
  const two = readAngleBrief(brief([good, other]), { rawText: RAW, exemplars });
  assert.deepEqual([0, 1, 2].map((i) => angleForVersion(two, i).focus), [good.focus, other.focus, good.focus]);
});

test('กติกานักเขียน: ย่อหน้ากลางเป็นของทิศทางนี้ ไม่ใช่ไล่เล่าเนื้อข่าวครบทุกข้อเหมือนกันทุกเวอร์ชัน', () => {
  assert.ok(TEACHER_RULES.includes('ลำดับการเล่าในทิศทางข่าวบอกด้วยว่าย่อหน้ากลางของโพสต์นี้ขยายอะไรเป็นหลัก'));
  assert.ok(TEACHER_RULES.includes('ไม่ต้องไล่เล่าทุกข้อตามลำดับของเนื้อข่าว'));
  assert.ok(TEACHER_RULES.includes('2. เล่าใหม่ให้ครบแก่น'), 'กฎครบแก่นยังอยู่ (ตัดได้เฉพาะรายละเอียดปลีกย่อย)');
  const { user } = buildTeacherPrompt({ teacher: { post: 'ย่อหน้าหนึ่งของครู\n\nย่อหน้าสองของครู\n\nย่อหน้าสามของครู' }, rawText: RAW, angle: { core: 'เหตุการณ์หลัก', focus: 'ประเด็น', coverLines: ['ปก'], order: ['เปิดด้วย ก', 'ย่อหน้ากลางขยาย ข', 'ปิดด้วย ค'], mustKeep: [] } });
  assert.ok(user.includes('ลำดับการเล่า:\n  1. เปิดด้วย ก\n  2. ย่อหน้ากลางขยาย ข\n  3. ปิดด้วย ค'));
});

test('ทิศทางซ้ำกันไหม (ใกล้เกณฑ์): ซ้ำ 80% = ซ้ำ · ซ้ำ 60% = ไม่ซ้ำ · ประโยคสั้นที่อยู่ในประโยคยาว = ซ้ำ · พาดปกต่าง 1 บรรทัดจาก 3 = ไม่ซ้ำ · เครื่องหมายคำพูดไม่มีผล', () => {
  const mk = (focus, coverLines) => ({ focus, coverLines, order: [] });
  const f0 = 'ชูเหตุผลทางใจของเจ้าตัวที่ถือว่าบุญสำเร็จแล้ว ไม่ขอฟ้องร้องเอาเงินคืน';
  // ประเด็นที่ชู (พาดปกของสองฝั่งต่างกันสิ้นเชิง)
  assert.equal(sameAngle(mk(f0, ['ปกแบบที่หนึ่ง']), mk('ชูเหตุผลทางใจของหนิงที่ถือว่าบุญสำเร็จแล้ว จึงไม่ขอฟ้องร้องเอาเงินคืน', ['อีกแบบหนึ่งไปเลย'])), true, 'ประเด็นซ้ำราว 80%');
  assert.equal(sameAngle(mk(f0, ['ปกแบบที่หนึ่ง']), mk('ชูเหตุผลทางใจของเจ้าตัวที่ถือว่าบุญสำเร็จ แต่พร้อมไปให้ปากคำกับตำรวจทุกเมื่อ', ['อีกแบบหนึ่งไปเลย'])), false, 'ประเด็นซ้ำราว 60% = ชูคนละจุด');
  assert.equal(sameAngle(mk('ชูการตัดผมยาวไปบริจาคให้ผู้ป่วย', ['ปกแบบที่หนึ่ง']), mk('ชูการตัดผมยาวไปบริจาคให้ผู้ป่วย ซึ่งเจ้าตัวไว้มาหลายปีและทำมาแล้วสามครั้งโดยไม่เคยบอกใคร', ['อีกแบบหนึ่งไปเลย'])), true, 'ประเด็นเดิมที่เขียนยาวขึ้น');
  // พาดปก (ประเด็นที่ชูของสองฝั่งต่างกันสิ้นเชิง)
  const c0 = ['คนอื่นแจ้งความ แต่หนิงเลือกไม่ฟ้อง', 'บุญสำเร็จครบถ้วนตั้งแต่วันแรกที่โอน', 'ขอรักษาเจตนาบริสุทธิ์ไว้'];
  assert.equal(sameAngle(mk('ประเด็นแบบ ก', c0), mk('เรื่องอีกอย่างหนึ่ง ข', [c0[0], c0[1], 'ขอรักษาเจตนาดีไว้'])), true, 'พาดปกเปลี่ยนคำเดียว');
  assert.equal(sameAngle(mk('ประเด็นแบบ ก', c0), mk('เรื่องอีกอย่างหนึ่ง ข', [c0[0], 'ไม่อยากซ้ำเติมพี่ที่ไม่เคยปฏิเสธ', c0[2]])), false, 'พาดปกต่างกัน 1 บรรทัดจาก 3 = คนละทิศทาง');
  assert.equal(sameAngle(mk('ประเด็นแบบ ก', c0), mk('เรื่องอีกอย่างหนึ่ง ข', [c0[0], 'ไม่อยากซ้ำเติมพี่ที่ไม่เคยปฏิเสธ', 'พร้อมให้ข้อมูลถ้าตำรวจเรียก'])), false);
  assert.equal(sameAngle(mk('ประเด็นแบบ ก', ['"ไม่ฟ้อง"', '"บุญสำเร็จ"', '"ตั้งแต่วันแรก"', '"ไม่ทวงคืน"']), mk('เรื่องอีกอย่างหนึ่ง ข', ['ไม่ฟ้อง', 'บุญสำเร็จ', 'ตั้งแต่วันแรก', 'ไม่ทวงคืน'])), true, 'ต่างกันแค่เครื่องหมายคำพูด');
});
