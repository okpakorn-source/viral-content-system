// 🧭 ข้อสอบตัวจับคู่ครูด้วยความหมาย (25 ต.ค. 69 · เจ้าของสั่ง "โค้ดจับคู่ที่แม่นยำ แทน AI เพราะไม่นิ่ง")
//   A. teacherConceptMatch.js ฟังก์ชันล้วน: นิ่ง 100% · ลำดับแถวไม่มีผล · ตรงเรื่องชนะ · คำสั้นกำกวมไม่จับผิด · ไม่ตรงพอ = ถอย · ไม่ซ้ำโพสต์
//   B. ต่อเข้า viralFewshot: จับคู่ได้ = 2 ใบนี้ ไม่ผ่านตัวสุ่ม · จับไม่ได้/ปิดสวิตช์ = ตัวคัดโผ+สุ่มเดิม
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { matchTeachers, conceptsIn, newsProfile } from '../src/lib/services/teacherConceptMatch.js';
import { _hasWord } from '../src/lib/services/viralFewshot.js';

const row = (id, category, title) => ({ id, category, title, content: title });
const ROWS = [
  row('cpr', 'ช่วยเหลือกัน', 'ผู้ป่วยหมดสติกลางสถานี มีมือคู่หนึ่งปั๊มหัวใจทันที'),
  row('kid', 'สู้ชีวิต', 'ลูกอมถุงละ 10 บาท ในมือเด็กชายตัวเล็ก'),
  row('fam', 'ดราม่าครอบครัว', 'ลูกดูแลแม่ป่วยติดเตียงมาสิบปี'),
  row('pol', 'ข่าวการเมือง', 'ผู้ว่าฯ ลงพื้นที่แก้ปัญหาน้ำท่วม'),
  row('dup', 'ช่วยเหลือกัน', 'ผู้ป่วยหมดสติกลางสถานี มีมือคู่หนึ่งปั๊มหัวใจทันที'),
];
const ESS = {
  cpr: { emotion: ['ลุ้นระทึก', 'ชื่นชม'], themes: ['CPR', 'ช่วยชีวิต', 'ทักษะฉุกเฉิน'], tone: 'ฮึกเหิม', structure: 'เปิดด้วยผู้ป่วยหมดสติ-เล่าการทำ CPR-จบด้วยทักษะช่วยชีวิต' },
  kid: { emotion: ['สะเทือนใจ', 'ชื่นชม'], themes: ['สู้ชีวิต', 'เด็ก', 'กตัญญู'], tone: 'อบอุ่น', structure: 'เปิดด้วยเด็กขายลูกอม-เล่าการหาเงินช่วยครอบครัว' },
  fam: { emotion: ['ซาบซึ้ง'], themes: ['ครอบครัว', 'กตัญญู', 'ดูแลแม่'], tone: 'อบอุ่น', structure: 'เปิดด้วยลูกดูแลแม่ป่วย-เล่าความเหนื่อย' },
  pol: { emotion: ['ชื่นชม'], themes: ['การเมือง', 'น้ำท่วม', 'ผู้นำ'], tone: 'จริงจัง', structure: 'เปิดด้วยผู้ว่าลงพื้นที่-เล่าการแก้ปัญหา' },
  dup: { emotion: ['ลุ้นระทึก', 'ชื่นชม'], themes: ['CPR', 'ช่วยชีวิต', 'ทักษะฉุกเฉิน'], tone: 'ฮึกเหิม', structure: 'เปิดด้วยผู้ป่วยหมดสติ-เล่าการทำ CPR-จบด้วยทักษะช่วยชีวิต' },
};
const NURSE = { title: 'พยาบาลจอดรถลงไปปั๊มหัวใจคุณยายที่หมดสติริมถนน', coreStory: 'พยาบาลช่วยชีวิตคุณยายไม่มีชีพจร', excerpt: 'ที่จังหวัดร้อยเอ็ด คุณยายวัย 81 ปี หมดสติ พยาบาลปั๊มหัวใจจนกลับมามีชีพจร', cardEssence: '' };
const KID = { title: 'เด็กชายวัย 11 ขวบ ขายน้ำชงหาเงินเรียน', coreStory: 'เด็กสู้ชีวิตช่วยแบ่งเบาภาระครอบครัว', excerpt: 'ขายน้ำชงที่ศูนย์อนุรักษ์พันธุ์สัตว์ป่า จังหวัดนครนายก', cardEssence: '' };

test('A1 ตรงเรื่องชนะ: ข่าวพยาบาลปั๊มหัวใจ → ครู CPR · ข่าวเด็กขายของ → ครูเด็กขายลูกอม', () => {
  assert.equal(matchTeachers(NURSE, ROWS, ESS, _hasWord).list[0].id, 'cpr');
  assert.equal(matchTeachers(KID, ROWS, ESS, _hasWord).list[0].id, 'kid');
});

test('A2 นิ่ง 100%: รันซ้ำ/สลับลำดับแถว ได้ผลเดิมทุกตัวอักษร', () => {
  const a = matchTeachers(NURSE, ROWS, ESS, _hasWord);
  const b = matchTeachers(NURSE, [...ROWS].reverse(), ESS, _hasWord);
  assert.deepEqual(a.list.map((r) => r.id), b.list.map((r) => r.id));
  assert.equal(a.reason, matchTeachers(NURSE, ROWS, ESS, _hasWord).reason);
});

test('A3 ไม่ซ้ำโพสต์: ครูซ้ำ 2 id หัวเดียวกัน ได้แค่ใบเดียว', () => {
  const ids = matchTeachers(NURSE, ROWS, ESS, _hasWord).list.map((r) => r.id);
  assert.ok(!(ids.includes('cpr') && ids.includes('dup')), JSON.stringify(ids));
});

test('A4 คำสั้นกำกวมไม่จับผิด: "จังหวัด" ≠ วัด · "ศูนย์อนุรักษ์พันธุ์สัตว์ป่า" ≠ สัตว์เลี้ยง · "แฟนเพลง" ≠ คู่รัก', () => {
  const p = conceptsIn('ขายน้ำชงที่ศูนย์อนุรักษ์พันธุ์สัตว์ป่า จังหวัดนครนายก แฟนเพลงมาเชียร์', _hasWord);
  assert.equal(p['พระศาสนา'], undefined);
  assert.equal(p['สัตว์'], undefined);
  assert.equal(p['คู่รัก'], undefined);
  assert.equal(newsProfile(KID, _hasWord)['สู้ชีวิต'] > 0, true);
  // รอบ 3 (ผู้ตรวจรอบ 2): คำทั่วไปที่เคยจับผิด
  const q = conceptsIn('ญาตินำส่งโรงพยาบาล ก่อนเดินจากไปเงียบๆ ได้ค่าตอบแทนวันละ 300 ได้เจอเพื่อนเก่าแล้วกลับบ้าน เรื่องตลกในมูลนิธิ ตามระเบียบ', _hasWord);
  for (const id of ['บุคลากรการแพทย์', 'การสูญเสีย', 'กตัญญู', 'พบกันอีกครั้ง', 'คนดัง', 'กู้ภัยอาสา', 'นโยบายรัฐ']) assert.equal(q[id], undefined, id);
  assert.ok(conceptsIn('พว.สมศรี พยาบาลวิชาชีพ', _hasWord)['บุคลากรการแพทย์'] > 0, 'พยาบาลจริงยังต้องจับได้');
});

test('A5 ไม่มีครูที่ตรงพอ = คืนว่าง (fell) ให้ผู้เรียกถอยวิธีเดิม · ข้อมูลพัง = คืนว่าง ไม่ล้ม', () => {
  assert.equal(matchTeachers({ title: 'ราคาน้ำมันขึ้นลิตรละ 50 สตางค์' }, ROWS, ESS, _hasWord).fell, true);
  assert.equal(matchTeachers(NURSE, [], ESS, _hasWord).fell, true);
  assert.equal(matchTeachers(NURSE, ROWS, {}, _hasWord).fell, true);
  assert.equal(matchTeachers(null, ROWS, ESS, _hasWord).fell, true);
});

const SRC = readFileSync(new URL('../src/lib/services/viralFewshot.js', import.meta.url), 'utf8');

test('B1 ต่อเข้า viralFewshot: จับคู่ก่อนตัวคัดโผ · ได้ = 2 ใบไม่สุ่ม · ไม่ได้ = ตัวคัดโผเดิม · สวิตช์ถอย TEACHER_CONCEPT_MATCH', () => {
  assert.match(SRC, /import \{ matchTeachers \} from '\.\/teacherConceptMatch\.js'/u);
  assert.match(SRC, /function _teacherConceptOn\(\) \{\s*return !\/\^\(0\|false\|off\|no\)\$\/\.test\(_envTok\('TEACHER_CONCEPT_MATCH'\)\);/u);
  const concept = SRC.indexOf('if (shortlistOn && teacherGuideEligible && _teacherConceptOn()) {'); // ผูกสาย TEXT (ผู้ตรวจรอบ 2: สาย URL ห้ามเปลี่ยน)
  const old = SRC.indexOf('if (shortlistOn && !conceptPicked) {');
  assert.ok(concept > 0 && old > concept, 'จับคู่ความหมายต้องมาก่อนตัวคัดโผ');
  assert.match(SRC, /picks = conceptPicked \? usable\.slice\(0, 2\) : \(rotate \? weightedSample\(usable, 2\) : usable\.slice\(0, 2\)\);/u);
  assert.match(SRC, /pickMode === 'shortlist' \|\| pickMode === 'concept'\)/u, 'หัวบล็อกต้องบอกว่าเป็นครูที่จับคู่');
});

// 🚫 25 ต.ค. 69 เจ้าของเคาะ "ปิดครูไม่ใช้ ใช้การ์ด" — นักเขียนสาย TEXT ได้แค่ Style Pack · VIRAL_TEACHERS=1 เปิดคืน · สาย URL/polish ไม่ถูกแตะ
test('C1 ปิดคลังครูเป็นค่าเริ่มต้นเฉพาะสาย TEXT: ได้ Style Pack ไม่มีโพสต์ครู · VIRAL_STYLE_PACK=0 = ว่าง', async () => {
  const { getViralFewshotBlock } = await import('../src/lib/services/viralFewshot.js');
  const keep = { t: process.env.VIRAL_TEACHERS, s: process.env.VIRAL_STYLE_PACK };
  const log = console.log; console.log = () => {};
  try {
    delete process.env.VIRAL_TEACHERS; delete process.env.VIRAL_STYLE_PACK;
    const block = await getViralFewshotBlock({ category: 'ช่วยเหลือกัน', newsTitle: 'ทดสอบ', teacherGuideEligible: true });
    assert.match(block, /VIRAL STYLE PACK/u);
    assert.doesNotMatch(block, /โพสต์ไวรัลจริง|--- ตัวอย่าง 1 ---/u);
    for (const v of ['0', 'off', '', 'x']) {
      process.env.VIRAL_TEACHERS = v;
      assert.doesNotMatch(await getViralFewshotBlock({ teacherGuideEligible: true }), /โพสต์ไวรัลจริง/u, `VIRAL_TEACHERS=${v}`);
    }
    delete process.env.VIRAL_TEACHERS; process.env.VIRAL_STYLE_PACK = '0';
    assert.equal(await getViralFewshotBlock({ teacherGuideEligible: true }), '');
  } finally {
    console.log = log;
    if (keep.t === undefined) delete process.env.VIRAL_TEACHERS; else process.env.VIRAL_TEACHERS = keep.t;
    if (keep.s === undefined) delete process.env.VIRAL_STYLE_PACK; else process.env.VIRAL_STYLE_PACK = keep.s;
  }
});

test('C2 ซอร์ส: ด่านปิดครูผูกกับ teacherGuideEligible (สาย URL/polish คงเดิม) · เปิดคืนด้วย VIRAL_TEACHERS ค่าเปิดเท่านั้น', () => {
  assert.match(SRC, /function _teachersOn\(\) \{\s*return SL_ON_RE\.test\(_envTok\('VIRAL_TEACHERS'\)\);/u);
  assert.match(SRC, /if \(teacherGuideEligible && !_teachersOn\(\)\) \{[\s\S]{0,200}return process\.env\.VIRAL_STYLE_PACK === '0' \? '' : getViralStylePack\(\);/u);
});
