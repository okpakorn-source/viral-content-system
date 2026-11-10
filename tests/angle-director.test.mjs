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
