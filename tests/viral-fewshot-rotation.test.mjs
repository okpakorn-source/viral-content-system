// 🎯 ข้อสอบระบบหมุนเวียนตัวอย่างไวรัล — import โค้ดจริงตรงๆ (ห้ามก๊อปฟังก์ชันมาเทส)
// รัน: node tests/viral-fewshot-rotation.test.mjs — ต้องผ่านครบทุกเคสก่อนถือว่าเสร็จ
import { weightedSample, pickLibraryCategory, scoreMatchExamples, matchModeName } from '../src/lib/services/viralFewshot.js';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// สุ่มแบบคุมผลได้ (deterministic) สำหรับข้อสอบ
const seededRand = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

// ── ① หมวดครบทั้ง 14 ของคลังจริง — ทุกหมวด map กลับหาตัวเองได้ ──
const ALL_LIBS = ['ดราม่าครอบครัว', 'ข่าวเศร้า', 'ข่าวการเมือง', 'ช่วยเหลือกัน', 'สู้ชีวิต', 'ข่าวบันเทิง',
  'พลิกชีวิต', 'ข่าวเตือนใจ', 'ความรักสัตว์', 'ข่าวชาวบ้าน', 'ข่าวกีฬา', 'คนดังตกต่ำ', 'nostalgia', 'moral conflict'];
t('1 ทั้ง 14 หมวดของคลังมีทางเข้า (ชื่อหมวดตรง → หมวดนั้น)',
  ALL_LIBS.every((lib) => pickLibraryCategory({ category: lib }) === lib));

// ── ② หมวดใหม่จับจากคีย์เวิร์ดข่าวจริงได้ ──
t('2 ข่าวหมาแมว → ความรักสัตว์', pickLibraryCategory({ category: 'ทั่วไป', emotionalTags: ['สุนัข', 'อบอุ่น'] }) === 'ความรักสัตว์');
t('3 ข่าวนักกีฬาทีมชาติ → ข่าวกีฬา', pickLibraryCategory({ category: 'นักกีฬาทีมชาติคว้าเหรียญ' }) === 'ข่าวกีฬา');

// ── ③ ของเดิมต้องไม่ถอยหลัง ──
t('4 ข่าวแม่ลูก → ดราม่าครอบครัว (เดิม)', pickLibraryCategory({ category: 'แม่ลูกผูกพัน' }) === 'ดราม่าครอบครัว');
t('5 ไม่เข้าเงื่อนไขไหนเลย → default ดราม่าครอบครัว', pickLibraryCategory({ category: 'xyz' }) === 'ดราม่าครอบครัว');

// ── ④ กลไกสุ่มถ่วงน้ำหนัก ──
const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ title: 'P' + i, engagement_likes: (n - i) * 1000, content: 'x'.repeat(300) }));

{ // ทุกใบมีสิทธิ์จริง: 12 ใบ สุ่ม 600 รอบ ทุกใบต้องเคยถูกเลือก
  const rows = mkRows(12);
  const seen = new Set();
  const rand = seededRand(7);
  for (let i = 0; i < 600; i++) weightedSample(rows, 2, rand).forEach((r) => seen.add(r.title));
  t('6 ทุกใบในโผถูกเลือกจริงอย่างน้อย 1 ครั้ง (600 รอบ)', seen.size === 12);
}
{ // คุณภาพนำจริง: ใบไลก์สูงสุดต้องถูกเลือกบ่อยกว่าใบท้ายชัดเจน
  const rows = mkRows(12);
  const count = {};
  const rand = seededRand(99);
  for (let i = 0; i < 600; i++) weightedSample(rows, 2, rand).forEach((r) => { count[r.title] = (count[r.title] || 0) + 1; });
  t('7 ใบไลก์สูงสุดถูกเลือกบ่อยกว่าใบท้ายสุด ≥3 เท่า', count['P0'] >= count['P11'] * 3);
}
{ // ไม่คืนใบซ้ำในการเรียกเดียว
  const rows = mkRows(5);
  const rand = seededRand(3);
  let dup = false;
  for (let i = 0; i < 200; i++) { const p = weightedSample(rows, 2, rand); if (p[0].title === p[1].title) dup = true; }
  t('8 สุ่ม 2 ใบไม่มีทางได้ใบเดียวกันซ้ำ', !dup);
}
t('9 โผว่าง → คืนว่าง ไม่พัง', weightedSample([], 2).length === 0);
t('10 โผมีใบเดียว → คืน 1 ใบ', weightedSample(mkRows(1), 2).length === 1);
t('11 ไลก์เพี้ยน (null/0) → ไม่หาร 0 ไม่พัง',
  weightedSample([{ title: 'a', engagement_likes: null }, { title: 'b', engagement_likes: 0 }], 2).length === 2);

// ── ⑤ การหมุนเวียนเกิดจริงข้ามการเรียก (ต่างจากระบบเดิมที่ตายตัว) ──
{
  const rows = mkRows(12);
  const rand = seededRand(42);
  const firstPicks = new Set();
  for (let i = 0; i < 30; i++) firstPicks.add(weightedSample(rows, 2, rand).map((r) => r.title).join('+'));
  t('12 เรียก 30 ครั้งได้ชุดตัวอย่างต่างกัน >5 แบบ (เดิม = 1 แบบตายตัว)', firstPicks.size > 5);
}

// ── ⑥ บั๊กที่ Sol จับได้ (7 ส.ค.) — กลายเป็นข้อสอบถาวร ──
t('13 "กฎหมายใหม่" ต้องไม่กลายเป็นข่าวสัตว์ (คีย์ หมา ⊂ กฎหมาย)',
  pickLibraryCategory({ category: 'กฎหมายใหม่มีผลบังคับใช้' }) !== 'ความรักสัตว์');
t('14 "ดราม่าสังคม" → moral conflict (คีย์ยาวชนะคีย์สั้นที่ซ้อน)',
  pickLibraryCategory({ category: 'ประเด็นดราม่าสังคม' }) === 'moral conflict');

// ── ⑦ 8 ส.ค. — คำสั่งเจ้าของ "200+ ใบต้องถูกเรียกใช้จริงได้ทุกใบ": โผเปิดทั้งหมวด ไม่ใช่แค่ท็อป 12 ──
{ // หมวดใหญ่สุดจริง (ช่วยเหลือกัน 64 ใบ) — ทุกใบต้องถูกเลือกจริง ไม่ใช่แค่ "มีสิทธิ์ในทฤษฎี"
  const rows = mkRows(64);
  const seen = new Set();
  const rand = seededRand(11);
  for (let i = 0; i < 4000; i++) weightedSample(rows, 2, rand).forEach((r) => seen.add(r.title));
  t('15 โผ 64 ใบ (เท่าหมวดใหญ่สุดจริง) ทุกใบถูกเลือกจริงครบ', seen.size === 64);
}
t('16 ใบไลก์ต่ำสุดของโผใหญ่ก็ถูกเลือกได้ (rand ชี้ท้ายโผ)',
  weightedSample(mkRows(64), 1, () => 0.999999)[0].title === 'P63');

// ── ⑧ 8 ส.ค. — โหมดจับคู่ "ห้ามสุ่ม" (VIRAL_MATCH_MODE=score): ผลนิ่ง + แมชถูกตัว + มีเหตุผลรองรับ ──
const ROWS = [
  { id: 'a1', category: 'ความรักสัตว์', title: 'ช้างเศร้าอาลัยควาญ', content: 'x'.repeat(300) },
  { id: 'b2', category: 'ข่าวบันเทิง', title: 'ดาราเปิดตัวแฟน', content: 'x'.repeat(300) },
  { id: 'c3', category: 'ข่าวเศร้า', title: 'อาลัยครูใหญ่', content: 'x'.repeat(300) },
];
const ESS = {
  a1: { emotion: ['เศร้า', 'ผูกพัน'], themes: ['ช้าง', 'สูญเสีย', 'สัตว์'], tone: 'เศร้า' },
  b2: { emotion: ['ตื่นเต้น'], themes: ['ความรัก', 'ดารา'], tone: 'สดใส' },
  c3: { emotion: ['เศร้า'], themes: ['สูญเสีย', 'ครู'], tone: 'เศร้า' },
};
const BRIEF = { title: 'ช้างพลายยืนเฝ้าโลงควาญ', emotionalTags: ['เศร้า', 'ผูกพัน'], archetype: '', libCat: 'ความรักสัตว์', coreStory: 'ช้างอาลัยการสูญเสียควาญที่เลี้ยงมา', excerpt: 'ช้างพลายไม่ยอมกินอาหารหลังควาญเสียชีวิต' };
{
  const m1 = scoreMatchExamples(BRIEF, ROWS, ESS);
  const m2 = scoreMatchExamples(BRIEF, ROWS, ESS);
  t('17 ผลนิ่ง 100% (เรียกซ้ำได้ตัวเดิมเป๊ะ = ไม่มีสุ่ม)', JSON.stringify(m1.map(x => x.row.id)) === JSON.stringify(m2.map(x => x.row.id)));
  t('18 แมชถูกตัว: ข่าวช้างเศร้า → ใบช้าง (a1) ชนะใบดารา', m1[0]?.row.id === 'a1' && !m1.some(x => x.row.id === 'b2'));
  t('19 มีเหตุผลรองรับแจกแจงจริง', /อารมณ์ตรง|ธีมตรง/.test(m1[0]?.reason || ''));
}
t('20 ไม่มีอะไรแมชเลย → คืนว่าง (ให้ระบบถอย fallback ไม่ฝืนเลือกมั่ว)',
  scoreMatchExamples({ title: 'zzz', emotionalTags: [], libCat: '', excerpt: 'zzz' }, ROWS, ESS).length === 0);

// ── ⑨ 14 ส.ค. — เจ้าของเคาะกลับ "สุ่มทั้งหมวด" เป็นค่าเริ่มต้น (บรรณารักษ์ = ต้องเปิดเองชัดๆ) ──
t('21 ไม่ตั้งค่า/ค่าว่าง = สุ่มแบบเดิม (ค่าเริ่มต้นที่เจ้าของเคาะ 14 ส.ค.)', matchModeName(undefined) === '' && matchModeName('') === '');
t('22 เปิดบรรณารักษ์ต้องตั้งใจ: ai/AI เท่านั้น', matchModeName('ai') === 'ai' && matchModeName('AI') === 'ai');
t('23 score เลือกได้ · ค่าพิมพ์เพี้ยน (on/off/ขยะ) = สุ่มแบบเดิม ไม่หลุดไปเปิดบรรณารักษ์เงียบๆ',
  matchModeName('score') === 'score' && matchModeName('Score') === 'score' && matchModeName('on') === '' && matchModeName('off') === '' && matchModeName('xyz') === '');

console.log(`\n${pass}/23 ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
