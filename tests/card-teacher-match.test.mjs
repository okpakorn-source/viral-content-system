// 🎴 ข้อสอบ "การ์ดนำทางครู" (CARD_TEACHER_MATCH) — ทาง ก: โค้ดล้วน ไม่เพิ่ม AI call
// สัญญา: ป้ายสาระการ์ดที่เลือก (card-essences) เข้าเป็น "สัญญาณเชื่อถือได้" ของตัวคัดโผครู
//   เฉพาะเมื่อ CARD_TEACHER_MATCH เปิด (1/true/on/yes) และ VIRAL_SHORTLIST เปิดอยู่เท่านั้น
//   ไม่ตั้งสวิตช์ = ระบบเดิม 100% ทุกไบต์ · โหมดเก่า VIRAL_MATCH_MODE (ai/score) ห้ามได้รับผลกระทบ
// รัน: node --test tests/card-teacher-match.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortlistExamples } from '../src/lib/services/viralFewshot.js';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(TESTS, '..');
const fewshotSource = readFileSync(join(ROOT, 'src', 'lib', 'services', 'viralFewshot.js'), 'utf8').replace(/\r\n/g, '\n');
const analyzeSource = readFileSync(join(ROOT, 'src', 'lib', 'services', 'summarizeServiceText.js'), 'utf8').replace(/\r\n/g, '\n');

// ── ของปลอมคุมผลได้ (แบบแผนเดียวกับ viral-shortlist.test.mjs) ──
const mkRow = (id, cat, title) => ({ id, category: cat, title, content: 'x'.repeat(300), engagement_likes: 0 });
const ROWS = [
  mkRow('a1', 'ดราม่าครอบครัว', 'แม่เลี้ยงลูกคนเดียว'),
  mkRow('a2', 'ดราม่าครอบครัว', 'พ่อกลับมาหาลูก'),
  mkRow('b1', 'ความรักสัตว์', 'หมาเฝ้าเจ้าของ'),
  mkRow('b2', 'ความรักสัตว์', 'แมวรอหน้าบ้าน'),
  mkRow('c1', 'สู้ชีวิต', 'ขายของหาเงินเรียน'),
  mkRow('c2', 'สู้ชีวิต', 'ปั่นจักรยานไปทำงาน'),
  mkRow('d1', 'ข่าวกีฬา', 'นักวิ่งทีมชาติ'),
];
const ESS = {
  a1: { emotion: ['ซาบซึ้ง'], themes: ['ครอบครัว', 'แม่ลูก', 'ความรัก'], tone: 'อบอุ่น', structure: 'เปิดด้วยความยากลำบาก-เล่าการต่อสู้-จบด้วยความสำเร็จ' },
  a2: { emotion: ['ซาบซึ้ง'], themes: ['ครอบครัว', 'พ่อลูก'], tone: 'อบอุ่น', structure: 'เปิดด้วยการจากลา-เล่าการรอคอย-จบด้วยการกลับมา' },
  b1: { emotion: ['ประทับใจ'], themes: ['สุนัข', 'ความซื่อสัตย์'], tone: 'อบอุ่น', structure: 'เปิดด้วยภาพสัตว์-เล่าความผูกพัน-จบด้วยการรอคอย' },
  b2: { emotion: ['ประทับใจ'], themes: ['แมว', 'ความผูกพัน'], tone: 'อบอุ่น', structure: 'เปิดด้วยภาพสัตว์-เล่าชีวิตประจำวัน-จบด้วยความอบอุ่น' },
  c1: { emotion: ['ชื่นชม'], themes: ['การศึกษา', 'ความยากจน', 'ความพยายาม'], tone: 'ฮึกเหิม', structure: 'เปิดด้วยความยากจน-เล่าความพยายาม-จบด้วยผลลัพธ์' },
  c2: { emotion: ['ชื่นชม'], themes: ['ความพยายาม', 'การเดินทาง'], tone: 'ฮึกเหิม', structure: 'เปิดด้วยระยะทาง-เล่าความอดทน-จบด้วยความภูมิใจ' },
  d1: { emotion: ['ตื่นเต้น'], themes: ['กีฬา', 'ชัยชนะ'], tone: 'ฮึกเหิม', structure: 'เปิดด้วยการแข่งขัน-เล่าการฝึกซ้อม-จบด้วยเหรียญรางวัล' },
};
// ข่าวกลางๆ ที่ตั้งใจไม่เอ่ยธีมสัตว์เลย — การ์ดเป็นผู้ชี้ทางไปหาครูสาย "ความซื่อสัตย์/สุนัข"
const BRIEF_NEUTRAL = {
  title: 'เรื่องเล่าจากหมู่บ้านเล็กๆ', category: 'ทั่วไป', libCat: 'ดราม่าครอบครัว',
  coreStory: 'เหตุการณ์ประจำวันในหมู่บ้าน', excerpt: 'ชาวบ้านเล่าเหตุการณ์ที่เกิดขึ้นเมื่อวานนี้ให้ฟัง',
};
const CARD_DOG = 'ข่าวโทนอบอุ่นเรื่องสุนัขกับความซื่อสัตย์ต่อเจ้าของ เล่าความผูกพันจากเหตุการณ์จริง';

function ids(result) { return result.list.map((r) => r.id); }

// ═══ ① พาริตี้: ไม่ส่ง cardEssence → ตัวคัดโผให้ผลเดิมนิ่ง 100% (ต้องเขียวทั้งก่อนและหลังแก้) ═══
test('ไม่ส่ง cardEssence: โผนิ่งและซ้ำได้ 100%', () => {
  const r1 = shortlistExamples(BRIEF_NEUTRAL, ROWS, ESS, 8);
  const r2 = shortlistExamples({ ...BRIEF_NEUTRAL }, ROWS, ESS, 8);
  assert.deepEqual(ids(r1), ids(r2), 'ข่าวเดิมต้องได้โผเดิมเสมอ');
});

// ═══ ② ฟีเจอร์: ป้ายการ์ดใน brief ต้องดันครูที่เข้ากับการ์ดขึ้น (แดงก่อนแก้ เขียวหลังแก้) ═══
test('brief.cardEssence ที่ชี้ทางสัตว์ ต้องเปลี่ยนคะแนน/โผจากกรณีไม่ส่ง', () => {
  const plain = shortlistExamples(BRIEF_NEUTRAL, ROWS, ESS, 8);
  const withCard = shortlistExamples({ ...BRIEF_NEUTRAL, cardEssence: CARD_DOG }, ROWS, ESS, 8);
  assert.notDeepEqual(
    { ids: ids(withCard), reason: withCard.reason },
    { ids: ids(plain), reason: plain.reason },
    'ป้ายการ์ดต้องมีผลต่อการคัดโผ (โผหรือเหตุผล/คะแนนต้องต่างจากไม่ส่ง)',
  );
  // ครูสายสุนัข/ความซื่อสัตย์ (b1) ต้องติดโผเมื่อการ์ดชี้ทางนั้น
  assert.ok(ids(withCard).includes('b1'), 'การ์ดชี้ทางสุนัข/ความซื่อสัตย์ → b1 ต้องติดโผ');
});

test('cardEssence เข้าช่อง strong เท่านั้น — ห้ามรั่วเข้าโครงเรื่อง (gramSet)', () => {
  // สัญญา minimal ของทาง ก: ป้ายการ์ดเป็นคำบรรยาย ไม่ใช่โครงเรื่อง 3 ท่อน
  // จึงเข้าเฉพาะช่องสัญญาณเชื่อถือได้ (strong) — ห้ามเข้าตัวหั่นโครงเรื่อง 5-gram
  const strongLine = fewshotSource.match(/const strong = \[[^\]]*\]/su)?.[0] || '';
  assert.ok(strongLine.includes('brief.cardEssence'), 'การ์ดต้องอยู่ใน strong');
  const gramParts = fewshotSource.match(/for \(const part of \[[^\]]*\]\) \{\s*\n\s*for \(const g of _grams/su)?.[0] || '';
  assert.ok(gramParts.length > 0, 'ต้องพบจุดหั่นโครงเรื่อง (gramSet)');
  assert.ok(!gramParts.includes('cardEssence'), 'การ์ดห้ามรั่วเข้าตัวหั่นโครงเรื่อง');
});

// ═══ ③ ทนค่าพิการ: cardEssence เพี้ยนต้องไม่ล้มและไม่เปลี่ยนผลจากไม่ส่ง ═══
test('cardEssence ค่าพิการ (null/ตัวเลข/ว่าง) ไม่ล้มและเท่ากรณีไม่ส่ง', () => {
  const base = ids(shortlistExamples(BRIEF_NEUTRAL, ROWS, ESS, 8));
  for (const junk of [null, undefined, '', 0, 123, false]) {
    const r = shortlistExamples({ ...BRIEF_NEUTRAL, cardEssence: junk }, ROWS, ESS, 8);
    assert.deepEqual(ids(r), base, `cardEssence=${String(junk)} ต้องเท่ากรณีไม่ส่ง`);
  }
});

// ═══ ④ สัญญา wiring ใน viralFewshot.js (source contract — แบบแผนเดียวกับข้อสอบ contract อื่นของ repo) ═══
test('viralFewshot: มีตัวอ่านสวิตช์ CARD_TEACHER_MATCH แบบแผนเดียวกับสวิตช์พี่น้อง', () => {
  assert.match(fewshotSource, /CARD_TEACHER_MATCH/u, 'ต้องมีสวิตช์ CARD_TEACHER_MATCH');
  assert.match(fewshotSource, /_cardTeacherOn\s*\(/u, 'ต้องอ่านผ่านฟังก์ชันจุดเดียว _cardTeacherOn');
  assert.match(fewshotSource, /_envTok\('CARD_TEACHER_MATCH'\)/u, 'ต้องอ่านผ่าน _envTok (ทนอัญประกาศ/ตัวพิมพ์) เหมือนสวิตช์พี่น้อง');
});

test('viralFewshot: getViralFewshotBlock รับ cardEssence และส่งเข้า brief เฉพาะใต้สวิตช์', () => {
  assert.match(fewshotSource, /getViralFewshotBlock\(\{[^)]*cardEssence[^)]*\}\s*=\s*\{\}\)/su,
    'getViralFewshotBlock ต้องรับพารามิเตอร์ cardEssence');
  // จุดใช้ต้องครอบด้วย _cardTeacherOn() — ห้ามส่งเข้า brief แบบไร้เงื่อนไข
  assert.match(fewshotSource, /_cardTeacherOn\(\)[^\n]*cardEssence|cardEssence[^\n]*_cardTeacherOn\(\)/u,
    'การใช้ cardEssence ต้องผูกกับ _cardTeacherOn()');
});

test('viralFewshot: ตัวคัดโผรวม brief.cardEssence ในช่องสัญญาณเชื่อถือได้ (strong)', () => {
  const strongLine = fewshotSource.match(/const strong = \[[^\]]*\]/su)?.[0] || '';
  assert.ok(strongLine.includes('brief.cardEssence'), 'strong array ต้องมี brief.cardEssence');
  assert.ok(strongLine.indexOf('brief.title') < strongLine.indexOf('brief.cardEssence'),
    'ช่องเดิมต้องคงลำดับเดิม (ของใหม่ต่อท้าย)');
});

test('viralFewshot: โหมดเก่า ai/score ต้องไม่ถูกแตะ (brief ของ ai/score ห้ามมี cardEssence)', () => {
  // brief ของโหมดจับคู่เก่าอยู่ใน block ที่สร้างก่อน aiMatchExamples — ต้องคงหน้าตาเดิม
  const aiBriefBlock = fewshotSource.match(/const brief = \{ title: newsTitle[^}]*\};/su)?.[0] || '';
  assert.ok(aiBriefBlock.length > 0, 'ต้องพบ brief ของโหมดจับคู่เก่า');
  assert.ok(!aiBriefBlock.includes('cardEssence'), 'brief โหมด ai/score ต้องไม่มี cardEssence (จำกัดขอบเขตทาง ก ที่ชั้นคัดโผ)');
});

test('viralFewshot: เปิดการ์ดแต่ชั้นคัดโผปิด ต้องตะโกนบอก (แบบแผนเกราะ 4/5)', () => {
  assert.match(fewshotSource, /CARD_TEACHER_MATCH=1[^\n]*VIRAL_SHORTLIST|_cardTeacherOn\(\)\s*&&\s*!shortlistOn/u,
    'ต้องมี log เตือนเมื่อ CARD_TEACHER_MATCH เปิดแต่ VIRAL_SHORTLIST ปิด (การ์ดไม่มีตัวคัดให้ผล)');
});

// ═══ ⑤ สัญญา wiring ใน summarizeServiceText.js ═══
test('summarizeServiceText: จุดเรียกเลือกครูส่งป้ายสาระการ์ดที่เลือกจริง', () => {
  // [\s\S]*? ถึงบรรทัดปิด `});` — จุดเรียกมี object ซ้อน (newsBrief) ห้ามใช้ [^}]* เพราะหยุดที่วงเล็บซ้อนแรก
  const callBlock = analyzeSource.match(/viralFewshotBlock = await getViralFewshotBlock\(\{[\s\S]*?\n\s*\}\);/u)?.[0] || '';
  assert.ok(callBlock.length > 0, 'ต้องพบจุดเรียก getViralFewshotBlock');
  assert.ok(callBlock.includes('cardEssence'), 'จุดเรียกต้องส่ง cardEssence');
  assert.match(analyzeSource, /loadCardEssences[\s\S]{0,600}viralFewshotBlock = await getViralFewshotBlock/u,
    'ป้ายสาระต้องมาจาก loadCardEssences (คลังเดียวกับสารบัญการ์ด) ใกล้จุดเรียก');
  assert.match(callBlock, /smartPrompt\?\.id/u, 'ต้องเปิดป้ายด้วยรหัสการ์ดที่เลือก (smartPrompt?.id)');
});

test('summarizeServiceText: สาย URL (summarizeService.js) ต้องไม่ถูกแตะโดยงานนี้', () => {
  // สาย URL มี import 'cardEssences' (สารบัญการ์ด) อยู่เดิม — ห้ามนับเป็นร่องรอยฟีเจอร์นี้
  // ร่องรอยจริงของงานนี้คือสวิตช์ กับการส่ง field `cardEssence:` เข้า brief เท่านั้น
  const urlSource = readFileSync(join(ROOT, 'src', 'lib', 'services', 'summarizeService.js'), 'utf8');
  assert.ok(!urlSource.includes('CARD_TEACHER_MATCH') && !/cardEssence\s*:/u.test(urlSource),
    'summarizeService.js (สาย URL) ต้องไม่มีร่องรอยฟีเจอร์นี้');
});

// ═══ ⑤ก อุดช่อง M4 (ผู้ตรวจไขว้ทุบเจอ): brief ชั้นคัดโผต้องกิน "ค่าที่ถูกล้าง" ไม่ใช่ param ดิบ ═══
test('จุดประกอบ brief ชั้นคัดโผใช้ cardEss (ผ่านประตูสวิตช์แล้ว) ห้ามใช้ param ดิบ cardEssence', () => {
  // ประตูพาริตี้อยู่ที่ `const cardEss = (_cardTeacherOn() && shortlistOn) ? ... : ''`
  // ถ้าจุดส่งเข้า shortlist สลับไปใช้ param ดิบ ผู้เรียกที่ป้อนป้ายมาเสมอจะทะลุประตู = พาริตี้แตกเงียบ
  const wired = fewshotSource.match(/const sl = shortlistExamples\(\s*\{[\s\S]*?\}\s*,/su)?.[0] || '';
  assert.ok(wired.length > 0, 'ต้องพบจุดประกอบ brief ของชั้นคัดโผ');
  assert.match(wired, /cardEssence:\s*cardEss\s*[,}]/u, 'ต้องส่ง cardEss (ค่าหลังประตูสวิตช์)');
  assert.doesNotMatch(wired, /cardEssence:\s*cardEssence\b/u, 'ห้ามส่ง param ดิบ cardEssence ทะลุประตู');
});

// ═══ ⑥ กันสวิตช์รั่ว: ไม่ตั้ง env ระหว่างรันข้อสอบนี้ ต้องไม่มีทางที่ brief จุด shortlist ได้ค่าการ์ด ═══
test('ค่าเริ่มต้น (ไม่ตั้ง env): เงื่อนไขสวิตช์ต้องปิดทาง cardEssence ทั้งเส้น', () => {
  assert.ok(!process.env.CARD_TEACHER_MATCH, 'ข้อสอบนี้ต้องรันโดยไม่ตั้ง CARD_TEACHER_MATCH');
  // สัญญาระดับ source: ทุกจุดที่ประกอบ brief ให้ shortlistExamples ใน getViralFewshotBlock
  // ค่า cardEssence ต้องมาจากตัวแปรที่ถูกล้างเป็นค่าว่างเมื่อสวิตช์ปิด
  const wired = fewshotSource.match(/shortlistExamples\(\s*\{[^}]*\}/su)?.[0] || '';
  assert.ok(wired.includes('cardEssence'), 'จุดประกอบ brief ของชั้นคัดโผต้องมีช่อง cardEssence');
});
