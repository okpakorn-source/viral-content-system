// 🎯 ข้อสอบระบบหมุนเวียนตัวอย่างไวรัล — import โค้ดจริงตรงๆ (ห้ามก๊อปฟังก์ชันมาเทส)
// รัน: node tests/viral-fewshot-rotation.test.mjs — ต้องผ่านครบทุกเคสก่อนถือว่าเสร็จ
import { weightedSample, pickLibraryCategory } from '../src/lib/services/viralFewshot.js';

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

console.log(`\n${pass}/14 ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
