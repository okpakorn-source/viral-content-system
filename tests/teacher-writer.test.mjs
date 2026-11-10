// ข้อสอบ "นักเขียนแบบเลียนครู" (10 พ.ย. 69) — import โค้ดจริงตรงๆ · ไม่ยิง API · ไม่แตะฐานข้อมูล
// รัน: node --test tests/teacher-writer.test.mjs
//   ① คลังครู: 254 โพสต์ครบ ใช้ได้ทุกใบ · ไฟล์เสีย/ว่าง = error ชัดเจน
//   ② ตัวเลือกครู: เข้ากับข่าว · ไม่ซ้ำวิธีเปิด · เลี่ยงใบที่เพิ่งใช้ · สุ่มแบบคุมผลได้
//   ③ ตัวตรวจแบบแผน: โพสต์ครูจริงต้อง "ผ่าน" (ตัวตรวจต้องไม่ตีครูตก) · ของผิดแบบต้อง "ตก" ทีละข้อ
//   ④ คำสั่งนักเขียน: มีของจริงครบทุกตัวอักษร ไม่ตัดกลางทาง · กฎมีชุดเดียว
//   ⑤ วงเขียน→ตรวจ→แก้: มีเพดาน · ฉบับไม่ผ่านไม่ถูกทิ้งเงียบ
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadTeacherLibrary, _resetTeacherLibraryCache, pickTeachers, classifyOpening, countWordsThai,
  shortlistTeachers, chooseRankedTeachers, rawHasQuote,
} from '../src/lib/services/teacherLibrary.js';
import {
  TEACHER_FORM, TEACHER_RULES, buildTeacherPrompt, checkTeacherForm, readWriterOutput, writeWithTeacher,
  sharedRunRatio, longestSharedRun, longestSharedRuns, lengthBudget,
  FACT_CHECK_RULES, buildFactCheckPrompt, readFactCheck,
  paragraphBudget, READER_RULES, READER_MAX_HARD_PARTS, buildReaderPrompt, readReaderReport,
} from '../src/lib/services/teacherWriter.js';
import { keepsPhrase } from '../src/lib/services/angleDirector.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB_FILE = path.join(ROOT, 'data', 'teacher-library.json');
const teachers = loadTeacherLibrary({ file: LIB_FILE });
const seededRand = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

// ───────── ① คลังครู ─────────
test('คลังครูมี 254 โพสต์ ทุกใบมีโพสต์เต็ม 3 ย่อหน้า + หมวด + ยอดวิว', () => {
  assert.equal(teachers.length, 254);
  for (const t of teachers) {
    assert.ok(t.id.startsWith('fb_'), `id ผิดรูป: ${t.id}`);
    assert.equal(t.post.split(/\n\s*\n/).filter((p) => p.trim()).length, 3, `ไม่ใช่ 3 ย่อหน้า: ${t.id}`);
    assert.ok(t.category, `ไม่มีหมวด: ${t.id}`);
    assert.ok(t.views >= 3_000_000, `ยอดวิวต่ำกว่า 3 ล้าน: ${t.id}`);
    assert.ok(!/…$|\.\.\.$/.test(t.post), `โพสต์ถูกตัดท้าย: ${t.id}`);
  }
  assert.equal(new Set(teachers.map((t) => t.id)).size, 254, 'id ซ้ำ');
});

test('คลังครู: ไฟล์หาย / เสีย / ว่าง = error ที่มี errorType (ห้ามเขียนต่อแบบไม่มีครู)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teacher-lib-'));
  try {
    _resetTeacherLibraryCache();
    assert.throws(() => loadTeacherLibrary({ file: path.join(dir, 'missing.json') }), (e) => e.errorType === 'TEACHER_LIBRARY_UNREADABLE');
    fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
    assert.throws(() => loadTeacherLibrary({ file: path.join(dir, 'broken.json') }), (e) => e.errorType === 'TEACHER_LIBRARY_UNREADABLE');
    fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ teachers: [{ id: 'x', post: 'สั้น' }] }));
    assert.throws(() => loadTeacherLibrary({ file: path.join(dir, 'empty.json') }), (e) => e.errorType === 'TEACHER_LIBRARY_EMPTY');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    _resetTeacherLibraryCache();
  }
});

test('จัดประเภทวิธีเปิดเรื่อง', () => {
  assert.equal(classifyOpening('"ผมไม่เคยลืมบุญคุณ" น้องเอวัย 19 พูดไว้'), 'quote');
  assert.equal(classifyOpening('ร่วมไว้อาลัยครูขนุน ครูภาษาไทยวัย 31 ปี'), 'tribute');
  assert.equal(classifyOpening('ต้องยกนิ้วให้ผู้หญิงที่ชื่อนุ่น 22 ปีในวงการ'), 'admire');
  assert.equal(classifyOpening('แม้เป็นกะเหรี่ยงใช้ชีวิตบนเขา แต่พลทหารวันชัยก็ไม่กลัว'), 'contrast');
  assert.equal(classifyOpening('บิ๊กกุ้งในวัย 60 ขอสู้อีกครั้ง'), 'number');
  assert.equal(classifyOpening('คุณยายเดินมาส่งหลานที่โรงเรียนทุกเช้า'), 'plain');
});

// ───────── ② ตัวเลือกครู ─────────
const scoreByCategory = (cat) => teachers.map((t, index) => ({ index, score: t.category === cat ? 60 : 5 }));

test('เลือกครู 3 โพสต์จากหมวดที่เข้ากับข่าว และวิธีเปิดไม่ซ้ำกัน', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const picks = pickTeachers({ teachers, scored: scoreByCategory('ฮีโร่ชาวบ้าน'), rand: seededRand(seed) });
    assert.equal(picks.length, 3);
    assert.ok(picks.every((p) => p.category === 'ฮีโร่ชาวบ้าน'), 'หลุดหมวด');
    assert.equal(new Set(picks.map((p) => p.id)).size, 3, 'ครูซ้ำ');
    assert.equal(new Set(picks.map((p) => p.openingType)).size, 3, 'วิธีเปิดซ้ำ');
    assert.ok(picks.every((p) => p._matchScore === 60));
  }
});

test('เลือกครู: สุ่มแบบคุมผลได้ (seed เดิม = ผลเดิม) และไม่กระจุกอยู่ไม่กี่ใบ', () => {
  const a = pickTeachers({ teachers, scored: scoreByCategory('อบอุ่นใจ'), rand: seededRand(7) }).map((p) => p.id);
  const b = pickTeachers({ teachers, scored: scoreByCategory('อบอุ่นใจ'), rand: seededRand(7) }).map((p) => p.id);
  assert.deepEqual(a, b);
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) for (const p of pickTeachers({ teachers, scored: scoreByCategory('อบอุ่นใจ'), rand: seededRand(seed) })) seen.add(p.id);
  assert.ok(seen.size >= 40, `หมวดอบอุ่นใจมี 54 ใบ แต่ 200 ข่าวใช้แค่ ${seen.size} ใบ`);
});

test('เลือกครู: เลี่ยงใบที่เพิ่งใช้ และหมวดเล็ก (3 ใบ) ยังได้ครบ 3', () => {
  const scored = scoreByCategory('ช่วยเหลือกัน');
  const first = pickTeachers({ teachers, scored, rand: seededRand(3) }).map((p) => p.id);
  for (let seed = 1; seed <= 20; seed++) {
    const next = pickTeachers({ teachers, scored, rand: seededRand(seed), avoidIds: first }).map((p) => p.id);
    assert.ok(next.every((id) => !first.includes(id)), 'หยิบใบที่เพิ่งใช้ซ้ำ');
  }
  const small = pickTeachers({ teachers, scored: scoreByCategory('ข่าวอาชญากรรม'), rand: seededRand(1) });
  assert.equal(small.length, 3);
  assert.ok(small.filter((p) => p.category === 'ข่าวอาชญากรรม').length >= 1);
});

test('เลือกครู: ข้อมูลเข้าเสีย = คืนรายการว่าง ไม่พัง', () => {
  assert.deepEqual(pickTeachers({ teachers: [], scored: [] }), []);
  assert.deepEqual(pickTeachers({ teachers, scored: [] }), []);
  assert.deepEqual(pickTeachers({ teachers, scored: [{ index: 99999, score: 1 }] }), []);
});

// ───────── ③ ตัวตรวจแบบแผน ─────────
test('ตัวตรวจต้องไม่ตีโพสต์ครูจริงตก (ครูคือคำตอบที่ถูก)', () => {
  const failed = [];
  const codes = {};
  for (const t of teachers) {
    const r = checkTeacherForm(t.post); // ตรวจแบบแผนล้วน (ไม่มีเนื้อดิบให้เทียบ)
    if (!r.ok) { failed.push(t.id); for (const f of r.fails) codes[f.code] = (codes[f.code] || 0) + 1; }
  }
  // ยอมให้ตกได้เฉพาะโพสต์ครูที่ยาว/สั้นสุดขอบ (ครู 5% เขียน ≤ 150 คำ, ยาวสุด 264 คำ) — ไม่เกิน 6% ของคลัง
  assert.ok(failed.length <= Math.ceil(teachers.length * 0.06), `ครูตกตัวตรวจ ${failed.length} ใบ: ${JSON.stringify(codes)}`);
  assert.deepEqual(Object.keys(codes).filter((c) => !['TOO_SHORT', 'TOO_LONG'].includes(c)), [], `ครูตกด้วยเหตุอื่นนอกจากความยาว: ${JSON.stringify(codes)}`);
});

const RAW = 'น้องเอ อายุ 19 ปี เก็บเงินได้ 50,000 บาท จากการขายข้าวแกง 3 ปี เพื่อส่งตัวเองเรียนมหาวิทยาลัย น้องเอบอกว่า "ผมไม่อยากให้แม่ลำบากอีกแล้ว" ครูประจำชั้นเล่าว่าน้องตื่นตี 4 ทุกวัน';
const good = () => {
  // ยาวเท่าโพสต์ครูจริง (ราว 650 ตัวอักษร)
  const p1 = 'น้องเอวัย 19 ปี เก็บเงินได้ 50,000 บาทจากการขายข้าวแกงตลอด 3 ปี เพื่อส่งตัวเองเรียนมหาวิทยาลัย เด็กคนหนึ่งเลือกแบกความฝันไว้ด้วยสองมือของตัวเอง โดยไม่รอให้ใครมาช่วย';
  const p2 = 'ครูประจำชั้นเล่าว่าน้องตื่นตี 4 ทุกวันเพื่อเตรียมของขาย ก่อนไปเรียนตามปกติเหมือนเพื่อนคนอื่น เรื่องนี้ทำให้หลายคนอดชื่นชมไม่ได้ เพราะความกตัญญูกับความขยันเมื่ออยู่ในคนคนเดียวกัน ก็พาชีวิตไปได้ไกลเสมอ น้องเอบอกไว้สั้นๆ ว่า "ผมไม่อยากให้แม่ลำบากอีกแล้ว" คำพูดประโยคเดียวนี้อธิบายทุกอย่างที่น้องทำมาตลอดหลายปี ทั้งการตื่นเช้า การอดออม และความตั้งใจที่ไม่เคยลดลงเลย';
  const p3 = 'เงินก้อนนี้อาจไม่มากสำหรับใครหลายคน แต่สำหรับน้องเอมันคือค่าเทอมที่หามาด้วยตัวเองทุกบาท ขอเป็นกำลังใจให้น้องเอเรียนจบตามที่ตั้งใจไว้';
  return [p1, p2, p3].join('\n\n');
};
const LONG_TEACHER = teachers.reduce((a, b) => (a.post.length > b.post.length ? a : b)); // โพสต์ครูยาวสุด → งบความยาวเต็มเพดาน
const SHORT_TEACHER = teachers.reduce((a, b) => (a.post.length < b.post.length ? a : b));

test('โพสต์ถูกแบบแผน = ผ่าน และตัวเลข/คำพูดจากเนื้อข่าวอยู่ครบ', () => {
  const r = checkTeacherForm(good(), { rawText: RAW });
  assert.deepEqual(r.fails, []);
  assert.equal(r.ok, true);
  assert.equal(r.metrics.paragraphs, 3);
  assert.equal(r.metrics.missingNumbers, 0);
  assert.ok(r.metrics.words >= TEACHER_FORM.minWords && r.metrics.words <= TEACHER_FORM.maxWords, `คำ=${r.metrics.words}`);
});

const failCodes = (content, ctx = { rawText: RAW }) => checkTeacherForm(content, ctx).fails.map((f) => f.code);

test('ของผิดแบบต้องตก ทีละข้อ', () => {
  assert.ok(failCodes('').includes('EMPTY'));
  assert.ok(failCodes(good().replace('\n\n', ' ')).includes('PARAGRAPHS'), '2 ย่อหน้า');
  assert.ok(failCodes(good().split('\n\n').map((p) => p.slice(0, 60)).join('\n\n')).includes('TOO_SHORT'));
  assert.ok(failCodes(good().split('\n\n').map((p) => p + ' ' + p).join('\n\n')).includes('TOO_LONG'));
  assert.ok(failCodes(good().replace('สำหรับใครหลายคน แต่', 'สำหรับใครหลายคน — แต่')).includes('DASH'));
  assert.ok(failCodes(good() + ' 🙏').includes('EMOJI'));
  assert.ok(failCodes(good() + ' #สู้ชีวิต').includes('HASHTAG'));
  assert.ok(failCodes(good() + ' แล้วคุณล่ะคิดยังไง').includes('QUESTION_END'));
  assert.ok(failCodes(good() + ' เห็นด้วยไหม?').includes('QUESTION_END'));
  assert.ok(failCodes(good().replace('ไม่เคยลดลงเลย', 'ไม่เคยลดลงเลย และ')).includes('DANGLING'), 'ย่อหน้าจบค้างด้วย "และ"');
  // ตัวเลขหาย = เตือนให้คนตรวจ ไม่ตีตก (โค้ดแยกไม่ได้ว่าตัวไหนเป็นแก่นเรื่อง · "300,000" กับ "3 แสน" คือเรื่องเดียวกัน)
  const noNum = checkTeacherForm(good().replace(/50,000|19/g, 'หลาย'), { rawText: RAW });
  assert.ok(!noNum.fails.some((f) => f.code === 'NUMBERS_MISSING'));
  assert.ok(noNum.warns.some((w) => w.code === 'NUMBERS_MISSING' && w.message.includes('50000')));
  // ยาวเกินงบตัวอักษรของครูที่เลียน = ตก พร้อมบอกจำนวนที่ต้องตัด
  const long = checkTeacherForm(good() + ' ' + 'เล่าเพิ่มอีกนิดหน่อยให้ยาวขึ้นกว่าเดิม '.repeat(6).trim(), { rawText: RAW, teacherPost: SHORT_TEACHER.post });
  const tooLong = long.fails.find((f) => f.code === 'TOO_LONG');
  assert.ok(tooLong && /ตัดออกอย่างน้อย \d+ ตัวอักษร/.test(tooLong.message), 'ต้องบอกจำนวนที่ต้องตัด');
  assert.equal(long.metrics.charLimit, lengthBudget(SHORT_TEACHER.post).maxChars);
});

test('ยกถ้อยคำจากครู = ตก · ลอกเนื้อข่าวมาก = เตือน · ตัวเลข/คำพูดใหม่ = เตือน', () => {
  const teacherPost = LONG_TEACHER.post;
  const flat = teacherPost.replace(/\s+/g, '');
  const withTeacherText = (n) => good().replace('ขอเป็นกำลังใจให้น้องเอเรียนจบตามที่ตั้งใจไว้', flat.slice(40, 40 + n));
  assert.ok(failCodes(withTeacherText(60), { rawText: RAW, teacherPost }).includes('COPIED_TEACHER'), 'ยกจากครู 60 ตัวอักษรต้องตก');
  assert.ok(!failCodes(withTeacherText(25), { rawText: RAW, teacherPost }).includes('COPIED_TEACHER'), 'สำนวนติดปากสั้นๆ ของแอดมินใช้ร่วมกับครูได้');
  assert.ok(!failCodes(good(), { rawText: RAW, teacherPost }).includes('COPIED_TEACHER'));

  const warnCodes = (c) => checkTeacherForm(c, { rawText: RAW }).warns.map((w) => w.code);
  assert.ok(warnCodes(good().replace('ทุกบาท', 'ทุกบาทรวม 99,999 บาท')).includes('NUMBERS_NEW'));
  assert.ok(warnCodes(good().replace('ขอเป็นกำลังใจ', 'แม่บอกว่า "ลูกคือความภูมิใจที่สุดของแม่" ขอเป็นกำลังใจ')).includes('QUOTES_NEW'));
  assert.ok(sharedRunRatio(RAW, RAW) > 0.99);
  assert.equal(sharedRunRatio('กขคงจฉชซฌญ', 'ฎฏฐฑฒณดตถท'), 0);
  assert.equal(longestSharedRun('ตอนเช้า เดินทางไปโรงเรียน ทุกวัน', 'เธอ เดินทางไปโรงเรียน เสมอ'), 'เดินทางไปโรงเรียน'.length);
  // ครูปิดด้วยประโยครำพึงลงท้าย "ไหม" ได้ (ไม่ใช่การถามคนอ่าน) — ตัวตรวจต้องไม่ตีตก
  assert.ok(!failCodes(good() + ' ไม่รู้ว่าลูกทั้งสามจะถูกโยงเกี่ยวกับเรื่องนี้ด้วยไหม').includes('QUESTION_END'));
});

test('ยกถ้อยคำจากเนื้อข่าวมากเกิน = ตก พร้อมบอกท่อนที่ต้องเล่าใหม่ · คำตอบหลุดรูปแบบ = ตก', () => {
  const copy = checkTeacherForm(good(), { rawText: good() + ' ' + RAW }).fails.find((f) => f.code === 'RAW_COPY');
  assert.ok(copy, 'โพสต์ที่ยกเนื้อข่าวมาทั้งหมดต้องตก RAW_COPY');
  assert.ok(copy.message.includes('ท่อน: "'), 'ต้องบอกท่อนที่ยกมา');
  const run = 'ขคงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภม';
  assert.ok(longestSharedRuns('ก'.repeat(10) + run + 'ย'.repeat(10), 'ร' + run + 'ล')[0] === run);
  assert.deepEqual(longestSharedRuns('สั้น', 'สั้น'), []);
  assert.ok(failCodes('{"title":"ก","content":"' + good().replace(/\n/g, ' ') + '"}').includes('FORMAT_LEAK'));
  assert.ok(failCodes('## หัวข้อ\n\n' + good()).includes('FORMAT_LEAK'));
  assert.ok(!failCodes(good()).includes('FORMAT_LEAK'));
});

test('คัดผู้เข้ารอบ: ตัดครูเปิดด้วยคำพูดเมื่อข่าวไม่มีคำพูด · ตัดใบที่เพิ่งใช้ · เรียงตามคะแนน', () => {
  assert.equal(rawHasQuote('เขาบอกว่า "ผมไม่อยากให้แม่ลำบากอีกแล้ว" ก่อนกลับบ้าน'), true);
  assert.equal(rawHasQuote('ข่าวนี้ไม่มีคำพูดของใครเลย มีแต่ชื่อ "เอ"'), false);
  const scored = scoreByCategory('อบอุ่นใจ');
  const noQuote = shortlistTeachers({ teachers, scored, rawText: 'ข่าวไม่มีคำพูด', size: 60 });
  assert.equal(noQuote.length, 60);
  assert.ok(noQuote.every((t) => t.openingType !== 'quote'), 'ครูเปิดด้วยคำพูดหลุดเข้ารอบทั้งที่ข่าวไม่มีคำพูด');
  assert.ok(noQuote[0]._matchScore >= noQuote[59]._matchScore);
  const withQuote = shortlistTeachers({ teachers, scored, rawText: RAW, size: 60 });
  assert.ok(withQuote.some((t) => t.openingType === 'quote'));
  const avoid = withQuote.slice(0, 10).map((t) => t.id);
  const rotated = shortlistTeachers({ teachers, scored, rawText: RAW, size: 60, avoidIds: avoid });
  assert.ok(rotated.every((t) => !avoid.includes(t.id)), 'ใบที่เพิ่งใช้ต้องไม่เข้ารอบ');
  assert.deepEqual(shortlistTeachers({ teachers: [], scored }), []);
});

test('เลือกจากลำดับของบรรณารักษ์: ตามลำดับ · วิธีเปิดไม่ซ้ำก่อน · ข้าม id มั่ว · ไม่ครบก็ไม่พัง', () => {
  const shortlist = shortlistTeachers({ teachers, scored: scoreByCategory('ช่วยเหลือกัน'), rawText: RAW, size: 40 });
  const sameOpening = shortlist.filter((t) => t.openingType === shortlist[0].openingType).slice(0, 3);
  const other = shortlist.find((t) => t.openingType !== shortlist[0].openingType);
  const ranked = [sameOpening[0].id, 'id-ที่ไม่มีจริง', sameOpening[1].id, sameOpening[0].id, other.id, sameOpening[2].id];
  const picks = chooseRankedTeachers({ shortlist, rankedIds: ranked, count: 3 });
  assert.deepEqual(picks.map((t) => t.id), [sameOpening[0].id, other.id, sameOpening[1].id]);
  assert.equal(chooseRankedTeachers({ shortlist, rankedIds: ['x', 'y'], count: 3 }).length, 0);
  assert.equal(chooseRankedTeachers({ shortlist, rankedIds: [other.id], count: 3 }).length, 1);
});

// ───────── ④ คำสั่งนักเขียน ─────────
test('คำสั่งนักเขียน: โพสต์ครูและเนื้อข่าวเข้าไปครบทุกตัวอักษร ไม่ตัดกลางทาง', () => {
  const longRaw = 'ประเด็นสำคัญ '.repeat(900) + 'ท้ายสุดของเนื้อข่าว'; // ยาวกว่า 3,000 ตัวอักษร (จุดที่ระบบเดิมตัด)
  const t = teachers.find((x) => x.post.length > 900);
  const { system, user } = buildTeacherPrompt({ teacher: t, rawText: longRaw });
  assert.equal(system, TEACHER_RULES);
  assert.ok(user.includes(t.post), 'โพสต์ครูไม่ครบ');
  assert.ok(user.includes(longRaw), 'เนื้อข่าวถูกตัด');
  assert.ok(user.includes(t.whyItWorks));
  assert.ok(!user.includes('ข้อมูลเสริมจากการค้น'), 'ไม่มีข้อมูลเสริมต้องไม่มีหัวข้อนี้');
  assert.ok(!user.includes('จุดที่ต้องแก้'), 'รอบแรกต้องไม่มีหัวข้อแก้');
});

test('คำสั่งนักเขียน: ข้อมูลเสริมและรอบแก้ถูกแนบเมื่อมี · ไม่มีครู/เนื้อข่าวสั้น = error', () => {
  const t = teachers[1];
  const { user } = buildTeacherPrompt({ teacher: t, rawText: RAW, researchFacts: ['ข้อมูล ก', ''], fixNotes: ['ยาวเกินไป'], previousDraft: 'ฉบับเก่า' });
  assert.ok(user.includes('1. ข้อมูล ก') && !user.includes('2. '));
  assert.ok(user.includes('ฉบับเก่า') && user.includes('- ยาวเกินไป'));
  assert.throws(() => buildTeacherPrompt({ teacher: null, rawText: RAW }), (e) => e.errorType === 'TEACHER_MISSING');
  assert.throws(() => buildTeacherPrompt({ teacher: t, rawText: 'สั้น' }), (e) => e.errorType === 'RAW_TEXT_TOO_SHORT');
});

test('กฎมีชุดเดียวและไม่ขัดกันเอง: ความยาวพูดถึงที่เดียว · ไม่มีกฎสำนวนของระบบเดิมปนมา', () => {
  assert.equal((TEACHER_RULES.match(/ยาวพอๆ กับโพสต์ต้นแบบ/g) || []).length, 1);
  assert.ok(!TEACHER_RULES.includes('JSON เท่านั้น'), 'นักเขียนตอบข้อความล้วน ไม่ใช่ JSON');
  assert.ok(TEACHER_RULES.includes('ห้ามเกินจำนวนตัวอักษรที่ระบุไว้ท้ายคำสั่ง'));
  const b = lengthBudget(teachers[0].post);
  assert.ok(buildTeacherPrompt({ teacher: teachers[0], rawText: RAW }).user.includes(`ต้องยาวไม่เกิน ${b.maxChars} ตัวอักษร`), 'งบความยาวต้องอยู่ในคำสั่ง');
  assert.ok(b.maxChars >= TEACHER_FORM.minChars && b.maxChars <= TEACHER_FORM.maxChars);
  for (const old of ['250', '300 คำ', 'The Witness', 'ประโยคทุบ', 'VIRAL STYLE PACK', 'PROSE CRAFT', 'hook', 'แม้จะ...แต่ก็']) {
    assert.ok(!TEACHER_RULES.includes(old), `กฎเดิมปนมา: ${old}`);
  }
});

test('อ่านคำตอบของโมเดลได้ทุกรูป (object / JSON ในโค้ดบล็อก / versions[] / ข้อความล้วน)', () => {
  assert.deepEqual(readWriterOutput({ title: 'ก', content: 'ข\r\n\r\n\r\nค' }), { title: 'ก', content: 'ข\n\nค' });
  assert.equal(readWriterOutput('```json\n{"title":"ก","content":"เนื้อ"}\n```').content, 'เนื้อ');
  assert.equal(readWriterOutput({ versions: [{ title: 'ก', content: 'เนื้อ' }] }).content, 'เนื้อ');
  assert.equal(readWriterOutput('คำนำ {"content":"เนื้อ"} ท้าย').content, 'เนื้อ');
  assert.equal(readWriterOutput('ข้อความล้วนไม่มี JSON').content, 'ข้อความล้วนไม่มี JSON');
  // JSON เสีย (ขึ้นบรรทัดจริงในสตริง) — ต้องดึงเนื้อออกมาได้ ไม่ปล่อย JSON ดิบเป็นเนื้อโพสต์ (เจอจริงรอบนำร่อง 10 พ.ย. 69)
  assert.equal(
    readWriterOutput('{"title": "หัว","content": "ย่อหน้าแรก\n\nย่อหน้าสอง มี \\"คำพูด\\" ด้วย"}').content,
    'ย่อหน้าแรก\n\nย่อหน้าสอง มี "คำพูด" ด้วย',
  );
  assert.equal(readWriterOutput(null).content, '');
});

// ───────── ⑤ วงเขียน → ตรวจ → แก้ ─────────
test('เขียนผ่านรอบแรก = เรียกโมเดลครั้งเดียว', async () => {
  let calls = 0;
  const r = await writeWithTeacher({ teacher: LONG_TEACHER, rawText: RAW, callModel: async () => { calls++; return { title: 'หัว', content: good() }; } });
  assert.equal(calls, 1);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.equal(r.teacherId, LONG_TEACHER.id);
});

test('ไม่ผ่านรอบแรก → รอบแก้ได้ฉบับเดิม + จุดที่ต้องแก้ → ผ่าน', async () => {
  const prompts = [];
  const r = await writeWithTeacher({
    teacher: teachers[0], rawText: RAW,
    callModel: async (p) => { prompts.push(p.user); return prompts.length === 1 ? { content: good() + ' 🙏' } : { content: good() }; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.ok(prompts[1].includes('🙏') && prompts[1].includes('อีโมจิ'), 'รอบแก้ต้องเห็นฉบับเดิมและเหตุที่ตก');
});

test('ไม่ผ่านทุกรอบ = หยุดตามเพดาน และคืนฉบับที่ผิดน้อยสุดพร้อมผลตรวจ (ไม่ทิ้งเงียบ)', async () => {
  let calls = 0;
  const r = await writeWithTeacher({
    teacher: teachers[0], rawText: RAW, maxAttempts: 99,
    callModel: async () => { calls++; return { content: calls === 1 ? good() + ' 🙏 #แท็ก' : good() + ' 🙏' }; },
  });
  assert.equal(calls, 3, 'เพดานสูงสุด 3 รอบ ไม่ว่าจะขอเท่าไร');
  assert.equal(r.ok, false);
  assert.deepEqual(r.check.fails.map((f) => f.code), ['EMOJI']);
  assert.ok(r.content.length > 0);
  await assert.rejects(() => writeWithTeacher({ teacher: LONG_TEACHER, rawText: RAW }), /callModel/);
});

test('ตัวนับคำตรงกับที่ใช้วัดครู', () => {
  assert.equal(countWordsThai(''), 0);
  assert.ok(countWordsThai('แม่ค้าขายข้าวแกงตื่นตีสี่ทุกวัน') >= 6);
});

// ───────── ⑥ ด่านตรวจข้อเท็จจริง ─────────
test('อ่านผลผู้ตรวจ: JSON ปกติ / ในโค้ดบล็อก / เสีย = "ยังไม่ได้ตรวจ" (ห้ามถือว่าผ่าน)', () => {
  const ok = readFactCheck('```json\n{"issues":[{"type":"added","severity":"minor","quote":"มูลนิธิเล็กๆ","problem":"ข่าวไม่ได้บอกขนาด","fix":"ตัดคำว่าเล็กๆ"},{"type":"แปลก","quote":"ก","problem":"ข"},{"type":"wrong","quote":""}]}\n```');
  assert.equal(ok.checked, true);
  assert.equal(ok.issues.length, 2, 'ข้อที่ไม่มี quote ถูกทิ้ง');
  assert.deepEqual(ok.issues[0], { type: 'added', severity: 'minor', quote: 'มูลนิธิเล็กๆ', problem: 'ข่าวไม่ได้บอกขนาด', fix: 'ตัดคำว่าเล็กๆ' });
  assert.equal(ok.issues[1].type, 'wrong', 'ชนิดไม่รู้จัก = wrong');
  assert.equal(ok.issues[1].severity, 'major', 'ไม่ระบุความร้ายแรง = ถือว่าร้ายแรง');
  assert.deepEqual(readFactCheck({ issues: [] }), { checked: true, issues: [] });
  assert.equal(readFactCheck('ขออภัย ตรวจไม่ได้').checked, false);
  assert.equal(readFactCheck({ result: 'ok' }).checked, false);
  assert.equal(readFactCheck(null).checked, false);
  assert.equal(readFactCheck({ issues: Array.from({ length: 20 }, (_, i) => ({ type: 'wrong', quote: 'ข้อ ' + i })) }).issues.length, 8);
});

test('คำสั่งผู้ตรวจ: เห็นเนื้อข่าวและโพสต์ครบ · ผู้ตรวจชี้อย่างเดียวไม่แก้เอง', () => {
  const { system, user } = buildFactCheckPrompt({ content: good(), rawText: RAW, researchFacts: ['ข้อมูล ก'] });
  assert.equal(system, FACT_CHECK_RULES);
  assert.ok(user.includes(RAW) && user.includes(good()) && user.includes('1. ข้อมูล ก'));
  assert.ok(FACT_CHECK_RULES.includes('คุณไม่ได้เขียนใหม่'));
});

test('ผู้ตรวจเจอจุดร้ายแรง → นักเขียนได้รายการแก้ → ตรวจซ้ำผ่าน', async () => {
  const prompts = [];
  let checks = 0;
  const r = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW,
    callModel: async (p) => { prompts.push(p.user); return good(); },
    callChecker: async () => (++checks === 1
      ? { issues: [{ type: 'wrong', severity: 'major', quote: 'ตื่นตี 4', problem: 'ทดสอบ', fix: 'แก้ตามข่าว' }] }
      : { issues: [{ type: 'unclear', severity: 'minor', quote: 'สองมือ', problem: 'เล็กน้อย', fix: '' }] }),
  });
  assert.equal(r.ok, true, 'เหลือแต่จุดเล็กน้อย = ผ่าน');
  assert.equal(r.attempts, 2);
  assert.equal(checks, 2, 'ฉบับแก้ต้องถูกตรวจซ้ำ');
  assert.ok(prompts[1].includes('ไม่ตรงกับเนื้อข่าว: "ตื่นตี 4" — ทดสอบ → แก้ตามข่าว'));
  assert.equal(r.facts.issues.length, 1, 'จุดเล็กน้อยที่เหลือต้องติดไปกับผล ให้คนตรวจเห็น');
});

test('ผู้ตรวจล้มหรือยังเจอจุดร้ายแรงทุกรอบ = ไม่ผ่าน แต่ไม่ทิ้งฉบับ และไม่เกินเพดานรอบ', async () => {
  let writes = 0;
  const stuck = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW, maxAttempts: 3,
    callModel: async () => { writes++; return good(); },
    callChecker: async () => ({ issues: [{ type: 'added', severity: 'major', quote: 'สองมือ', problem: 'ทดสอบ', fix: '' }] }),
  });
  assert.equal(writes, 3);
  assert.equal(stuck.ok, false);
  assert.ok(stuck.content.length > 0 && stuck.facts.issues.length === 1);

  let w2 = 0;
  const down = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW, maxAttempts: 3,
    callModel: async () => { w2++; return good(); },
    callChecker: async () => { throw new Error('ตัวตรวจล่ม'); },
  });
  assert.equal(down.ok, false, 'ตรวจไม่ได้ห้ามถือว่าผ่าน');
  assert.equal(down.facts.checked, false);
  assert.equal(w2, 1, 'ตัวตรวจล่มอย่างเดียว เขียนใหม่ไม่ช่วย — ไม่เปลืองรอบ');
});

// ───────── ⑦ อ่านรอบเดียวเข้าใจ (เจ้าของ 10 พ.ย. 69: "ยังแอบงง เข้าใจยาก เข้าใจช้า") ─────────
const paras = (s) => s.split('\n\n');
const ANGLE_QUOTE = { core: 'น้องเอขายข้าวแกงส่งตัวเองเรียน', focus: 'คำพูดถึงแม่', coverLines: ['"ผมไม่อยากให้แม่ลำบากอีกแล้ว"'], order: [], mustKeep: ['ผมไม่อยากให้แม่ลำบากอีกแล้ว'] };

test('งบย่อหน้าแรก/ท้ายยึดครูที่เลียน และอยู่ในคำสั่งนักเขียน · กฎพูดเรื่องย่อหน้าแรกที่เดียว', () => {
  const t = teachers[0];
  const pb = paragraphBudget(t.post);
  assert.ok(pb.openingMax >= TEACHER_FORM.edgeParagraphMin && pb.openingMax <= TEACHER_FORM.edgeParagraphMax);
  assert.ok(pb.closingMax >= TEACHER_FORM.edgeParagraphMin && pb.closingMax <= TEACHER_FORM.edgeParagraphMax);
  const { user } = buildTeacherPrompt({ teacher: t, rawText: RAW });
  assert.ok(user.includes(`ย่อหน้าแรกของคุณต้องไม่เกิน ${pb.openingMax} ตัวอักษร`) && user.includes(`ย่อหน้าท้ายต้องไม่เกิน ${pb.closingMax} ตัวอักษร`));
  assert.equal(paragraphBudget('ย่อหน้าเดียว'), null, 'ครูไม่ใช่ 3 ย่อหน้า = ไม่มีงบ (ไม่เดา)');
  assert.equal((TEACHER_RULES.match(/ย่อหน้าแรกคือพาดหัวของโพสต์/g) || []).length, 1);
  assert.ok(TEACHER_RULES.includes('เขียนให้อ่านรอบเดียวเข้าใจ') && TEACHER_RULES.includes('ห้ามเปิดแบบอ้อม'));
  // ครูส่วนใหญ่ต้องผ่านงบของตัวเอง (งบ = ครู +15% · ครูที่ย่อหน้าแรก/ท้ายยาวสุดขอบไม่ถือเป็นแบบให้เลียน)
  const selfFail = teachers.filter((x) => checkTeacherForm(x.post, { teacherPost: x.post }).fails.some((f) => ['OPENING_TOO_LONG', 'CLOSING_TOO_LONG'].includes(f.code)));
  assert.ok(selfFail.length <= Math.ceil(teachers.length * 0.03), `ครูตกงบย่อหน้าของตัวเอง ${selfFail.length} ใบ`);
});

test('ย่อหน้าแรกยืด / ย่อหน้าท้ายยืด / ย่อหน้าแรกไม่ถึงประเด็นที่ชู = ตก พร้อมบอกวิธีแก้', () => {
  const [p1, p2, p3] = paras(good());
  const filler = ' เรื่องนี้มีคนพูดถึงกันมากและยังมีรายละเอียดอีกหลายอย่างที่น่าสนใจไม่แพ้กันเลยทีเดียว';
  const longOpen = checkTeacherForm([p1 + filler + filler, p2, p3].join('\n\n'), { rawText: RAW, teacherPost: SHORT_TEACHER.post });
  const open = longOpen.fails.find((f) => f.code === 'OPENING_TOO_LONG');
  assert.ok(open && /ตัดออกอย่างน้อย \d+ ตัวอักษร/.test(open.message));
  const longClose = checkTeacherForm([p1, p2, p3 + filler + filler].join('\n\n'), { rawText: RAW, teacherPost: SHORT_TEACHER.post });
  assert.ok(longClose.fails.some((f) => f.code === 'CLOSING_TOO_LONG'));
  assert.ok(!longClose.fails.some((f) => f.code === 'OPENING_TOO_LONG'));
  assert.equal(checkTeacherForm(good(), { rawText: RAW, teacherPost: SHORT_TEACHER.post }).metrics.paragraphChars.length, 3);
  // คำพูดที่ทิศทางชูอยู่ย่อหน้ากลาง ไม่อยู่ย่อหน้าแรก = คนอ่านยังไม่เจอประเด็น
  const miss = checkTeacherForm(good(), { rawText: RAW, angle: ANGLE_QUOTE });
  const m = miss.fails.find((f) => f.code === 'OPENING_MISSES_POINT');
  assert.ok(m && m.message.includes('ผมไม่อยากให้แม่ลำบากอีกแล้ว'), 'ต้องบอกข้อความพาดปกที่ต้องเปิด');
  assert.ok(!miss.fails.some((f) => f.code === 'ANGLE_DROPPED'), 'คำพูดยังอยู่ในโพสต์ — ตกเฉพาะเรื่องตำแหน่ง');
  const hit = checkTeacherForm(good(), { rawText: RAW, angle: { ...ANGLE_QUOTE, mustKeep: ['50,000 บาท', 'ผมไม่อยากให้แม่ลำบากอีกแล้ว'] } });
  assert.ok(!hit.fails.some((f) => f.code === 'OPENING_MISSES_POINT'), 'มีอย่างน้อย 1 ถ้อยคำที่ชูในย่อหน้าแรก = ถึงประเด็นแล้ว');
});

test('ผู้อ่านจับใจความ: เห็นแค่โพสต์ · นับเฉพาะ 3 ชนิดที่ทำให้ตามเรื่องไม่ได้ · อ่านผลไม่ได้ = "ไม่ได้อ่าน"', () => {
  const { system, user } = buildReaderPrompt(good());
  assert.equal(system, READER_RULES);
  assert.ok(user.includes(good()) && !user.includes(RAW), 'ผู้อ่านต้องไม่เห็นเนื้อข่าว');
  const ok = readReaderReport('```json\n{"gist":"น้องเอขายข้าวแกง","opening":"บอกเรื่อง","hardParts":[{"quote":"เขา","kind":"สรรพนาม","why":"ไม่รู้ว่าใคร"},{"quote":"สะกดแปลก","kind":"คำสะกด","why":"ไม่นับ"},{"quote":"","kind":"เหตุผล"}]}\n```');
  assert.deepEqual(ok, { read: true, clear: true, opening: 'บอกเรื่อง', gist: 'น้องเอขายข้าวแกง', hardParts: [{ quote: 'เขา', kind: 'สรรพนาม', why: 'ไม่รู้ว่าใคร' }] });
  assert.equal(READER_MAX_HARD_PARTS, 1);
  const two = readReaderReport({ gist: 'ก', opening: 'บอกเรื่อง', hardParts: [{ quote: 'ก', kind: 'เหตุผล', why: 'ข' }, { quote: 'ค', kind: 'ประโยคซ้อน', why: 'ง' }] });
  assert.equal(two.clear, false, 'จุดที่ตามไม่ได้เกินเพดาน = ต้องแก้');
  assert.equal(readReaderReport({ gist: 'ก', opening: 'เกริ่น', hardParts: [] }).clear, false, 'ย่อหน้าแรกแค่เกริ่น = ต้องแก้');
  assert.equal(readReaderReport({ gist: 'ก', opening: 'ดีมาก' }).read, false);
  assert.equal(readReaderReport('ขออภัย').read, false);
  assert.equal(readReaderReport(null).read, false);
});

test('ผู้อ่านบอกว่าย่อหน้าแรกแค่เกริ่น → นักเขียนได้รายการแก้ → อ่านซ้ำผ่าน · ผู้อ่านล่ม = ไม่บล็อกงาน แต่ผลบอกว่าไม่ได้อ่าน', async () => {
  const prompts = [];
  let reads = 0;
  const r = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW,
    callModel: async (p) => { prompts.push(p.user); return good(); },
    callChecker: async () => ({ issues: [] }),
    callReader: async (p) => {
      assert.ok(!p.user.includes(RAW), 'ผู้อ่านต้องไม่เห็นเนื้อข่าว');
      return ++reads === 1
        ? { gist: 'มีเด็กคนหนึ่ง', opening: 'เกริ่น', hardParts: [{ quote: 'เขา', kind: 'สรรพนาม', why: 'ไม่รู้ว่าหมายถึงใคร' }] }
        : { gist: 'น้องเอขายข้าวแกงส่งตัวเองเรียน', opening: 'บอกเรื่อง', hardParts: [] };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(reads, 2, 'ฉบับแก้ต้องถูกอ่านซ้ำ');
  assert.ok(prompts[1].includes('อ่านย่อหน้าแรกแล้วยังไม่รู้ว่าเกิดอะไรขึ้น') && prompts[1].includes('คนอ่านตามไม่ได้ (สรรพนาม): "เขา"'));
  assert.equal(r.reader.clear, true);

  let writes = 0;
  const down = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW,
    callModel: async () => { writes++; return good(); },
    callChecker: async () => ({ issues: [] }),
    callReader: async () => { throw new Error('ผู้อ่านล่ม'); },
  });
  assert.equal(down.ok, true, 'ผู้อ่านเป็นด่านเสริม — ล่มแล้วงานไม่ล้ม');
  assert.equal(writes, 1);
  assert.equal(down.reader.read, false);
  assert.ok(down.reader.error.includes('ผู้อ่านล่ม'), 'ต้องบอกเหตุ ไม่ถือเงียบๆ ว่าอ่านเข้าใจ');

  // ผู้อ่านยังไม่ผ่านทุกรอบ = ไม่ผ่าน แต่ไม่ทิ้งฉบับ และไม่เกินเพดานรอบ
  let w3 = 0;
  const stuck = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW, maxAttempts: 3,
    callModel: async () => { w3++; return good(); },
    callReader: async () => ({ gist: '', opening: 'งง', hardParts: [] }),
  });
  assert.equal(w3, 3);
  assert.equal(stuck.ok, false);
  assert.ok(stuck.content.length > 0 && stuck.reader.opening === 'งง');
});

test('ถ้อยคำที่ต้องคง: ตรงตัว หรือตัวเลขครบ = ยังอยู่ (ไม่ตีตกเพราะคำรอบตัวเลขเปลี่ยน)', () => {
  assert.equal(keepsPhrase('คุณหมอวัย 28 เพิ่งมาทำงาน', 'อายุ 28 ปี'), true, 'ตัวเลขยังอยู่ = แก่นยังอยู่');
  assert.equal(keepsPhrase('ต้มโครงไก่วันละ 60-70 กิโล', 'ต้มโครงไก่ 60-70 กิโลกรัม'), true);
  assert.equal(keepsPhrase('เงินหมุนเวียน 3.7 ล้าน', 'เงินหมุนเวียนแค่ 3.7 ล้านบาท'), true);
  assert.equal(keepsPhrase('คุณหมอวัย 29', 'อายุ 28 ปี'), false, 'ตัวเลขเปลี่ยน = หาย');
  assert.equal(keepsPhrase('เก็บเงินได้ 50,000 บาท', '50000 บาท'), true, 'จุลภาคในตัวเลขไม่นับเป็นความต่าง');
  assert.equal(keepsPhrase('น้องเอ ตื่น เช้า', 'น้องเอตื่นเช้า'), true, 'ไม่นับช่องว่าง');
  assert.equal(keepsPhrase('น้องเอตื่นสาย', 'ตื่นเช้า'), false, 'ถ้อยคำไม่มีตัวเลขต้องตรงตัว');
  const angle = { coverLines: ['อายุ 19 ปี'], mustKeep: ['อายุ 19 ปี', 'ไม่มีในโพสต์เลย'] };
  const r = checkTeacherForm(good(), { rawText: RAW, angle });
  const dropped = r.fails.find((f) => f.code === 'ANGLE_DROPPED');
  assert.ok(dropped && dropped.message.includes('ไม่มีในโพสต์เลย') && !dropped.message.includes('อายุ 19 ปี'), 'โพสต์เขียน "วัย 19 ปี" — ไม่ตก');
  assert.ok(!r.fails.some((f) => f.code === 'OPENING_MISSES_POINT'));
});

test('ถ้อยคำตรงกับเนื้อข่าวมาก = เตือน · ยกทั้งประโยคยาวมาวาง = ตก', () => {
  // เนื้อดิบสั้นพอๆ กับโพสต์และเขียนเป็นท่อนสั้นๆ: สัดส่วนสูงได้โดยไม่ได้ยกทั้งประโยค
  const chunks = good().replace(/\n\n/g, ' ').split(' ').filter((c) => c.length >= 12);
  const shortRaw = chunks.map((c) => c.slice(0, 40)).join(' คั่น ');
  const r = checkTeacherForm(good(), { rawText: shortRaw });
  assert.ok(r.metrics.rawRun <= TEACHER_FORM.maxRawRun, `ท่อนยาวสุด ${r.metrics.rawRun}`);
  assert.ok(r.metrics.rawCopyPct > TEACHER_FORM.maxRawCopy * 100, `สัดส่วน ${r.metrics.rawCopyPct}%`);
  assert.ok(!r.fails.some((f) => f.code === 'RAW_COPY'), 'สัดส่วนสูงอย่างเดียวไม่ตีตก');
  assert.ok(r.warns.some((w) => w.code === 'RAW_COPY'), 'แต่ต้องเตือนให้คนตรวจเห็น');
  const lifted = checkTeacherForm(good(), { rawText: good() }).fails.find((f) => f.code === 'RAW_COPY');
  assert.ok(lifted && lifted.message.includes('ทั้งท่อน'));
});

test('ทุกรอบที่เขียนถูกบันทึกเหตุที่ตก (ไม่แก้เงียบ)', async () => {
  let n = 0;
  const r = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW,
    callModel: async () => (++n === 1 ? good() + ' 🙏' : good()),
    callChecker: async () => ({ issues: [] }),
    callReader: async () => ({ gist: 'ก', opening: 'บอกเรื่อง', hardParts: [] }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trail, [
    { attempt: 1, fails: ['EMOJI'], factMajor: 0, factChecked: true, readerClear: true },
    { attempt: 2, fails: [], factMajor: 0, factChecked: true, readerClear: true },
  ]);
  const plain = await writeWithTeacher({ teacher: LONG_TEACHER, rawText: RAW, callModel: async () => good() });
  assert.deepEqual(plain.trail, [{ attempt: 1, fails: [], factMajor: 0, factChecked: null, readerClear: null }], 'ไม่ได้ต่อด่าน = null ไม่ใช่ "ผ่าน"');
});

test('ถ้อยคำที่ต้องคง: เครื่องหมายคำพูดต่างแบบ / แทรกคำกลางวลี = ยังอยู่ · คำส่วนใหญ่หาย หรือชื่อสั้นไม่ตรง = หาย', () => {
  assert.equal(keepsPhrase('มิ้ลค์ตอบว่า “ไม่อาย เพราะเป็นอาชีพสุจริต” ทันที', '"ไม่อาย เพราะเป็นอาชีพสุจริต"'), true, 'เครื่องหมายคำพูดคนละแบบ');
  assert.equal(keepsPhrase('ชมพู่จึงถอดเสื้อของตัวเองให้ใส่ทันที', 'ถอดให้ใส่ทันที'), true, 'แทรกคำกลางวลี ความหมายเดิม');
  assert.equal(keepsPhrase('พร้อมให้หน่วยงานรัฐตรวจสอบ', 'พร้อมให้ตรวจสอบตามกฎหมายทุกประการ'), false, 'ครึ่งหลังของวลีหาย');
  assert.equal(keepsPhrase('ป้าเจี๊ยบไม่ได้พกเสื้อ', 'ป้าเจี้ยบ'), false, 'ชื่อสั้นต้องตรงตัว');
  assert.equal(keepsPhrase('เจ้าตัวถึงกับอึ้ง', 'สะอึก'), false);
  assert.equal(keepsPhrase('อะไรก็ได้', ''), true, 'ถ้อยคำว่าง = ไม่มีอะไรต้องคง');
});

test('เนื้อดิบยาวพอให้เลือกเล่าใหม่ + ถ้อยคำตรงกันมาก = ตก (เนื้อดิบสั้น = เตือนเท่านั้น)', () => {
  const chunks = good().replace(/\n\n/g, ' ').split(' ').filter((c) => c.length >= 12);
  const shortRaw = chunks.map((c) => c.slice(0, 40)).join(' คั่น ');
  const extra = ' รายละเอียดอื่นของข่าวที่โพสต์ไม่ได้เล่าถึง ซึ่งทีมส่งมาเพิ่มเติมอีกหลายบรรทัดเพื่อให้เห็นภาพรวมของเหตุการณ์ทั้งหมด'.repeat(8);
  const short = checkTeacherForm(good(), { rawText: shortRaw });
  assert.ok(!short.fails.some((f) => f.code === 'RAW_COPY') && short.warns.some((w) => w.code === 'RAW_COPY'));
  const long = checkTeacherForm(good(), { rawText: shortRaw + extra });
  assert.ok((shortRaw + extra).replace(/\s+/g, '').length >= long.metrics.chars * TEACHER_FORM.retellMinRawRatio, 'ข้อสอบต้องมีเนื้อดิบยาวพอ');
  const f = long.fails.find((x) => x.code === 'RAW_COPY');
  assert.ok(f && f.message.includes('มากเกินไป') && f.message.includes('ข้อเท็จจริง ชื่อ ตัวเลข และคำพูดต้องคงเดิม'), 'ต้องสั่งเล่าใหม่โดยย้ำว่าห้ามเปลี่ยนข้อเท็จจริง');
});

test('นักเขียนล่มในรอบแก้ = ส่งฉบับที่เขียนได้แล้วพร้อมเหตุ (ไม่ทิ้งทั้งเวอร์ชัน) · รอบแรกล่ม = โยนต่อ · หมดเวลา = ไม่เริ่มรอบแก้', async () => {
  let n = 0;
  const kept = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW, maxAttempts: 3,
    callModel: async () => { if (++n === 2) throw new Error('โมเดลแน่น'); return good() + ' 🙏'; },
    callChecker: async () => ({ issues: [] }),
  });
  assert.equal(n, 2);
  assert.equal(kept.ok, false);
  assert.ok(kept.content.includes('🙏'), 'ฉบับรอบแรกต้องยังอยู่');
  assert.deepEqual(kept.check.fails.map((f) => f.code), ['EMOJI'], 'ผลตรวจของฉบับที่ส่งต้องติดไปด้วย');
  assert.match(kept.stopped, /นักเขียนล่มในรอบแก้ที่ 2: โมเดลแน่น/);
  assert.equal(kept.attempts, 1);

  await assert.rejects(() => writeWithTeacher({ teacher: LONG_TEACHER, rawText: RAW, callModel: async () => { throw new Error('ล่มตั้งแต่รอบแรก'); } }), /ล่มตั้งแต่รอบแรก/);

  let w = 0;
  const outOfTime = await writeWithTeacher({
    teacher: LONG_TEACHER, rawText: RAW, maxAttempts: 3, canRetry: () => false,
    callModel: async () => { w++; return good() + ' 🙏'; },
  });
  assert.equal(w, 1, 'เวลาใกล้หมด ต้องไม่เริ่มรอบแก้');
  assert.match(outOfTime.stopped, /เวลาของงานใกล้หมด/);
  assert.ok(outOfTime.content.length > 0 && outOfTime.ok === false);

  let w2 = 0;
  const fine = await writeWithTeacher({ teacher: LONG_TEACHER, rawText: RAW, canRetry: () => false, callModel: async () => { w2++; return good(); } });
  assert.deepEqual([fine.ok, fine.stopped, w2], [true, undefined, 1], 'ผ่านรอบแรก ไม่เกี่ยวกับเส้นตายรอบแก้');
});
