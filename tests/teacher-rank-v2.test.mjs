// 🎯 ข้อสอบกติกาหยิบครูใหม่ rank-v2 (src/lib/services/teacherRank.js + สายเชื่อมใน viralFewshot.js) — 2 ก.ย. 69
// รัน: node --test tests/teacher-rank-v2.test.mjs (ไม่ต้องตั้ง env) · import โค้ดจริงตรงๆ (ห้ามก๊อปฟังก์ชันมาเทส)
// ข้อ 13ก-13จ = สนามจำลอง: ยิง getViralFewshotBlock จริงกับ PostgREST จำลองบน 127.0.0.1 (ไม่แตะ Supabase จริง · ไม่ต้องมี .env)
//   ตรวจพฤติกรรมบนเส้นลวด (สิ่งที่ส่งไป DB / สิ่งที่จดลงสมุด / เนื้อบล็อกที่นักเขียนได้) — ไม่ค้นคำใน source
//
// ผลทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนโค้ดไบต์เดิม (ทำจริง 2 ก.ย. 69 ด้วย harness ที่คืนไบต์เดิมและตรวจ md5):
//   M1 ด่านแมตช์: ตัด `x.matched &&` ออก (teacherRank)         → ข้อ 1 แดง (ใบเกราะ 1 score 2.6 ไลก์ 500k หลุดเข้ามา)
//      ⚠️ รอบแรก M1 รอด เพราะฟิกซ์เจอร์ไม่มีใบเกราะ 1 ที่ score ≥ 2 — เติม G2-guard แล้วจึงแดง (บทเรียน: ต้องมีเคสที่เงื่อนไขนั้น "ตัดสินจริง")
//   M2 เรียงไลก์: กลับทิศเป็นน้อย→มาก                          → แดง 10 ข้อ (1-8ข, 10)
//   M3 พื้น: hasGood = false ตายตัว                            → ข้อ 5, 6 แดง
//   M4 cap: ตัดเงื่อนไข `x.used >= cap`                         → ข้อ 6 แดง + ข้อ 13จ แดง (สนามจำลอง: ใบติด cap ถูกหยิบ)
//   M5 หมุน: idx = 0 ตายตัว (หยิบหัวแถวเสมอ)                    → ข้อ 7, 9 แดง
//   M6 ผ่อนด่าน: ตัดชั้น loose                                   → ข้อ 8, 8ข แดง
//   M7 เติม: ตัดลูป backfill                                     → ข้อ 5, 6 แดง (ครูไม่ครบ 2)
//   M8 สายเชื่อม viralFewshot: `slCands = null`                   → ข้อ 13ก/13ค/13ง/13จ แดง (สนามจำลอง: สมุดจด mode shortlist ไม่ใช่ rank-v2)
//   M9 shortlistExamples ส่ง cands.score = 0 (ไม่ใช่คะแนนจริง)   → ข้อ 11, 12 แดง
//   ── รอบผู้ตรวจไขว้ 2 ก.ย. 69 (ของเดิมข้อ 13 ค้นคำใน source → ทุบสายเชื่อมจริงแล้วไม่มีข้อไหนแดง) — harness: scratchpad/mutate-rank-v2-round2.mjs ──
//   MA _cnt นับเฉพาะอาเรย์ (ตัวเลข/บูลีนไม่นับ)                  → ข้อ 10 แดง (gate ตกเป็น loose · lo 9k หลุดเข้ามา)
//   MB พื้น `>= floor` → `> floor`                               → ข้อ 5 แดง (ใบ 50,000 พอดี ไม่ทำให้พื้นบังคับ)
//   MB2 คัดใบ `< floor` → `<= floor`                             → ข้อ 5 แดง (ใบ 50,000 พอดี ถูกข้าม)
//   ME สายเชื่อม `picks = rk.picks.map((c) => c.row)` → `rk.picks` → ข้อ 13ก/13ค/13ง/13จ แดง (บล็อกไม่มีเนื้อครู = ครูเนื้อว่าง)
//   MF `pickMode = 'rank-v2'` → 'rank-v3'                        → ข้อ 13ก/13ค/13ง/13จ แดง (สมุดจด mode ผิด)
//   MG `rank: rankInfo ? …` → `rank: null && …`                  → ข้อ 13ก/13ค/13ง/13จ แดง (สมุดไม่มีช่อง rank)
//   MH isShortlist = /^(shortlist)/ (ตัด rank-v2)                → ข้อ 13ก แดง (สมุดไม่มี libSize)
//   MI สวิตช์ `TEACHER_RANK_V2 !== '0'` → `=== '0'`               → ข้อ 13ก/13ข/13ค/13ง/13จ แดง
//   MJ อ่านสมุด `.select('data->picks')` → `.select('data')`      → ข้อ 13ก แดง (เส้นลวดขอ data ทั้งก้อน)
//   MK อ่านสมุด `r?.picks ?? r?.data?.picks` → `r?.data?.picks`   → ข้อ 13จ แดง (นับใช้ซ้ำไม่ได้ → ใบติด cap ถูกหยิบ)
//   ML สวิตช์ `LIB_CLASSIFIER_V2 !== '0'` → `=== '0'`            → ข้อ 13ก/13ง แดง (สมุดจดหมวดสลับตัว)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rankTeachers, likesFromMap, RANK_DEFAULTS } from '../src/lib/services/teacherRank.js';
import { shortlistExamples, getViralFewshotBlock, pickLibraryCategory, pickLibraryCategoryV2 } from '../src/lib/services/viralFewshot.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // รากรีโป — viralFewshot อ่าน data/*.json ผ่าน process.cwd()
const SELF = fileURLToPath(import.meta.url);

// ── โหมดโปรเซสลูกของสนามจำลอง (ข้อ 13): งานเดียว = เรียก getViralFewshotBlock ด้วย brief จาก stdin แล้วพิมพ์ผลเป็น JSON ──
//   ทำไมต้องแยกโปรเซสต่อฉาก: viralFewshot.js แคชคลังครู 10 นาที / สมุดประวัติ 5 นาที / ไคลเอนต์ Supabase ไว้ระดับโมดูล
//   ฉากที่วิ่งก่อนจะทำให้ฉากถัดไป "ไม่ยิง DB" = พิสูจน์อะไรไม่ได้ · env ตั้งจากแม่ก่อนโปรเซสเกิด → ทุกสวิตช์อ่านค่าของฉากนั้นแน่นอน
//   บล็อกนี้อยู่ก่อน test() ทุกข้อ → ลูกไม่ลงทะเบียนข้อสอบ ไม่พิมพ์ TAP ซ้อน
if (process.env.RANK_FIELD_CHILD === '1') {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  let block = '', err = null;
  try {
    const brief = JSON.parse(readFileSync(0, 'utf8'));
    block = await getViralFewshotBlock(brief);
  } catch (e) { err = String(e?.stack || e?.message || e); }
  console.log = orig;
  // stdout ที่เป็นไปป์บน Windows เขียนแบบ async → ต้องรอเขียนเสร็จก่อน exit ไม่งั้น JSON หาย
  process.stdout.write(`\n__RANK_FIELD_JSON__${JSON.stringify({ block, logs, err })}\n`, () => process.exit(0));
  await new Promise(() => {}); // รอ callback ข้างบนปิดโปรเซส
}

const seeded = (s) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const C = (id, score, { theme = [], emo = [], guard = false } = {}) => ({ id, score, hitsTheme: theme, hitsEmo: emo, guard, row: { id } });
const ids = (r) => r.picks.map((c) => c.id);
const NOROT = { rotate: 1, cap: 0, floor: 0 }; // ปิดหมุน/cap/พื้น เพื่อแยกทดสอบทีละกติกา

test('1 ด่านแมตช์: ใบเกราะ 1 (ไม่มี hit) ไลก์สูงสุด และใบ score < 2 ต้องไม่ถูกหยิบเมื่อมีใบแมตช์พอ', () => {
  const cands = [
    C('G-guard', 0.8, { guard: true }),             // เข้าโผเพราะเกราะ 1 อย่างเดียว (score ต่ำ)
    C('G2-guard', 2.6, { guard: true }),            // เกราะ 1 + คะแนนโครงเรื่อง/โบนัสชั้น ≥ 2 แต่ "ไม่มี hit" — ตัวจริงที่ด่านแมตช์ต้องกัน
    C('A', 3.0, { theme: ['ครอบครัว'] }),
    C('B', 2.5, { emo: ['ซาบซึ้ง'] }),
    C('L-low', 1.5, { theme: ['น้ำใจ'] }),           // มี hit แต่ score < 2
  ];
  const likes = { 'G-guard': 300000, 'G2-guard': 500000, A: 100000, B: 80000, 'L-low': 200000 };
  const r = rankTeachers(cands, { likesById: likes, ...NOROT });
  assert.deepEqual(ids(r), ['A', 'B']);
  assert.equal(r.debug.gate, 'strict');
  assert.deepEqual(r.debug.sortedIds, ['A', 'B'], 'แถวที่เรียงต้องมีเฉพาะใบผ่านด่าน (ไม่มี G2 แม้ score 2.6 ไลก์ 500k)');
});

test('2 ผลคืนอ็อบเจกต์ใบเดิม (identity) — ผู้เรียกใช้ .row ต่อได้ · debug.reason เป็นไทยและบอกด่าน', () => {
  const a = C('A', 3, { theme: ['x'] }), b = C('B', 3, { theme: ['y'] });
  const r = rankTeachers([a, b], { likesById: { A: 5000, B: 4000 }, ...NOROT });
  assert.equal(r.picks[0], a); assert.equal(r.picks[1], b);
  assert.equal(r.picks[0].row.id, 'A');
  assert.match(r.debug.reason, /ด่านแมตช์/u);
  assert.match(r.debug.reason, /หยิบ A/u);
});

test('3 เรียงไลก์จริงมาก→น้อย (rotate=1 = หยิบหัวแถว)', () => {
  const cands = [C('S', 2, { theme: ['a'] }), C('M', 2, { theme: ['a'] }), C('B', 2, { theme: ['a'] })];
  const r = rankTeachers(cands, { likesById: { S: 10000, M: { likes: 70000 }, B: 120000 }, ...NOROT });
  assert.deepEqual(ids(r), ['B', 'M']);
  assert.deepEqual(r.debug.sortedIds, ['B', 'M', 'S']);
});

test('4 ไม่มีข้อมูลไลก์ = ท้ายแถว (แม้ score สูงกว่า) · ค่าขยะ/0/ติดลบ = ไม่มีข้อมูล', () => {
  const cands = [C('X-nolikes', 5, { theme: ['a'] }), C('Y', 2, { theme: ['a'] }), C('Z', 2, { theme: ['a'] })];
  const r = rankTeachers(cands, { likesById: { Y: 20000, Z: 60000, 'X-nolikes': -5 }, ...NOROT });
  assert.deepEqual(ids(r), ['Z', 'Y']);
  assert.equal(r.debug.sortedIds.at(-1), 'X-nolikes');
  assert.equal(likesFromMap({ a: 0, b: 'x', c: { likes: '12' }, d: { likes: 3 } }, 'a'), null);
  assert.equal(likesFromMap({ a: 0, b: 'x', c: { likes: '12' }, d: { likes: 3 } }, 'b'), null);
  assert.equal(likesFromMap({ a: 0, b: 'x', c: { likes: '12' }, d: { likes: 3 } }, 'c'), 12);
  assert.equal(likesFromMap({ a: 0, b: 'x', c: { likes: '12' }, d: { likes: 3 } }, 'd'), 3);
  assert.equal(likesFromMap(null, 'a'), null);
});

test('5 พื้นคุณภาพ: มีใบ ≥ floor อยู่ → ใบต่ำกว่าพื้นถูกข้าม · ไม่พอ 2 ใบค่อยเติมจากใบที่ข้ามตามลำดับไลก์ · ไม่มีใบถึงพื้น = ไม่บังคับ · ขอบ 50,000 พอดี = ถึงพื้น', () => {
  const cands = [C('P', 2, { theme: ['a'] }), C('Q', 2, { theme: ['a'] }), C('R', 2, { theme: ['a'] })];
  const r = rankTeachers(cands, { likesById: { P: 60000, Q: 30000, R: 40000 }, rotate: 1, cap: 0, floor: 50000 });
  assert.equal(r.debug.hasGood, true);
  assert.equal(ids(r)[0], 'P');
  assert.deepEqual(ids(r), ['P', 'R'], 'เติมใบที่ข้ามตามลำดับไลก์ (R 40k ก่อน Q 30k)');
  assert.deepEqual(r.debug.skipped.map((s) => s.id), ['R', 'Q']);
  assert.ok(r.debug.skipped.every((s) => /ต่ำกว่าพื้น/u.test(s.why)));
  assert.deepEqual(r.debug.backfilled, ['R']);
  // ไม่มีใบไหนถึงพื้น → ไม่บังคับพื้น ไม่ข้ามใคร
  const r2 = rankTeachers(cands, { likesById: { P: 45000, Q: 30000, R: 40000 }, rotate: 1, cap: 0, floor: 50000 });
  assert.equal(r2.debug.hasGood, false);
  assert.deepEqual(ids(r2), ['P', 'R']);
  assert.equal(r2.debug.skipped.length, 0);
  // ใบถึงพื้น 2 ใบพอดี → ใบต่ำกว่าพื้นไม่มีทางถูกหยิบ
  const r3 = rankTeachers([...cands, C('T', 2, { theme: ['a'] })], { likesById: { P: 60000, T: 55000, Q: 30000, R: 40000 }, rotate: 1, cap: 0, floor: 50000 });
  assert.deepEqual(ids(r3), ['P', 'T']);
  // ขอบพื้น (ผู้ตรวจไขว้ 2 ก.ย. 69): ไลก์ = 50,000 พอดี ต้อง "ถึงพื้น" ทั้งตอนตัดสินว่าพื้นบังคับ (>=) และตอนคัดใบ (< ไม่ใช่ <=)
  const edgeOnly = rankTeachers([C('E', 2, { theme: ['a'] }), C('Q', 2, { theme: ['a'] }), C('R', 2, { theme: ['a'] })], { likesById: { E: 50000, Q: 30000, R: 40000 }, rotate: 1, cap: 0, floor: 50000 });
  assert.equal(edgeOnly.debug.hasGood, true, 'ใบ 50,000 พอดีใบเดียวก็ทำให้พื้นบังคับ');
  assert.deepEqual(ids(edgeOnly), ['E', 'R']);
  assert.deepEqual(edgeOnly.debug.skipped.map((s) => s.id), ['R', 'Q'], 'E (50,000 พอดี) ห้ามถูกข้าม');
  assert.deepEqual(edgeOnly.debug.backfilled, ['R']);
  const edgeMix = rankTeachers([...cands, C('E', 2, { theme: ['a'] })], { likesById: { P: 60000, E: 50000, Q: 30000, R: 40000 }, rotate: 1, cap: 0, floor: 50000 });
  assert.deepEqual(ids(edgeMix), ['P', 'E']);
  assert.deepEqual(edgeMix.debug.skipped.map((s) => s.id), ['R', 'Q']);
  assert.deepEqual(edgeMix.debug.backfilled, [], 'E ถึงพื้น → ครบ 2 ใบโดยไม่ต้องเติมจากใบที่ข้าม');
});

test('6 กันซ้ำ: ใช้ไป ≥ cap ใน 7 วัน → ข้าม · เหลือไม่พอค่อยยอม (เติมใบแรงที่ติด cap ก่อนใบต่ำกว่าพื้น) · cap=0 ปิด', () => {
  const cands = [C('H', 2, { theme: ['a'] }), C('I', 2, { theme: ['a'] }), C('J', 2, { theme: ['a'] })];
  const likes = { H: 200000, I: 150000, J: 120000 };
  const r = rankTeachers(cands, { likesById: likes, recentUsageById: { H: 8, I: 2 }, rotate: 1, cap: 8, floor: 0 });
  assert.deepEqual(ids(r), ['I', 'J']);
  assert.deepEqual(r.debug.skipped, [{ id: 'H', why: 'ใช้ไป 8 ครั้ง/7วัน ≥ cap 8' }]);
  // ต่ำกว่า cap 1 ครั้ง = ยังใช้ได้
  assert.deepEqual(ids(rankTeachers(cands, { likesById: likes, recentUsageById: { H: 7 }, rotate: 1, cap: 8, floor: 0 })), ['H', 'I']);
  // ติด cap หมด → ยอม (เติมตามลำดับไลก์)
  const all = rankTeachers(cands, { likesById: likes, recentUsageById: { H: 9, I: 8, J: 20 }, rotate: 1, cap: 8, floor: 0 });
  assert.deepEqual(ids(all), ['H', 'I']);
  assert.deepEqual(all.debug.backfilled, ['H', 'I']);
  // ใบแรงติด cap มาก่อนใบต่ำกว่าพื้น เมื่อต้องเติม
  const mix = rankTeachers([...cands, C('K', 2, { theme: ['a'] })], { likesById: { ...likes, K: 30000 }, recentUsageById: { H: 9, I: 9 }, rotate: 1, cap: 8, floor: 50000 });
  assert.deepEqual(ids(mix), ['J', 'H'], 'J ผ่าน · เติม H (ติด cap แต่ 200k) ก่อน K (30k ต่ำกว่าพื้น)');
  // cap=0 = ปิดกันซ้ำ
  assert.deepEqual(ids(rankTeachers(cands, { likesById: likes, recentUsageById: { H: 99 }, rotate: 1, cap: 0, floor: 0 })), ['H', 'I']);
});

test('7 หมุน: สุ่มถ่วง sqrt(likes) ในหัวแถว rotate ใบ — อันดับ 1 ไม่ผูกขาด แต่ยังได้บ่อยสุด · rotate=1 = ตายตัว', () => {
  const cands = [C('T1', 2, { theme: ['a'] }), C('T2', 2, { theme: ['a'] }), C('T3', 2, { theme: ['a'] }), C('T4', 2, { theme: ['a'] })];
  // sqrt(likes) = 632 : 316 : 158 → โอกาสเป็นใบแรก ≈ 57% : 29% : 14% (600 รอบ ≈ 343 : 171 : 86 — ห่างพอไม่ให้สถิติหลอก)
  const likes = { T1: 400000, T2: 100000, T3: 25000, T4: 20000 };
  const rnd = seeded(7);
  const first = {};
  for (let i = 0; i < 600; i++) { const r = rankTeachers(cands, { likesById: likes, rotate: 3, cap: 0, floor: 0, rnd }); first[ids(r)[0]] = (first[ids(r)[0]] || 0) + 1; }
  assert.deepEqual(Object.keys(first).sort(), ['T1', 'T2', 'T3'], 'หัวแถว 3 ใบต้องเคยได้เป็นใบแรกทุกใบ · T4 (นอกกลุ่มหมุน) ห้ามเป็นใบแรก');
  assert.ok(first.T1 > first.T2 * 1.3 && first.T2 > first.T3 * 1.3, `ไลก์สูงกว่าได้บ่อยกว่าชัดเจน: ${JSON.stringify(first)}`);
  assert.ok(first.T1 < 600 * 0.75, `ไม่ผูกขาด (T1 ได้ ${first.T1}/600)`);
  // rnd ชี้ 0 = หัวแถว · ชี้ 0.999 = ใบท้ายของกลุ่มหมุน
  assert.equal(ids(rankTeachers(cands, { likesById: likes, rotate: 3, cap: 0, floor: 0, rnd: () => 0 }))[0], 'T1');
  assert.equal(ids(rankTeachers(cands, { likesById: likes, rotate: 3, cap: 0, floor: 0, rnd: () => 0.999999 }))[0], 'T3');
  // rotate=1 ตายตัว
  for (let i = 0; i < 20; i++) assert.deepEqual(ids(rankTeachers(cands, { likesById: likes, rotate: 1, cap: 0, floor: 0, rnd })), ['T1', 'T2']);
});

test('8 ผ่อนด่าน: ผ่าน strict น้อยกว่า k → รับทุกใบ score > 0 (loose) แล้วเรียงไลก์ตามปกติ', () => {
  const cands = [C('A', 3, { theme: ['a'] }), C('B', 1.2, { theme: ['b'] }), C('G', 0.8, { guard: true })];
  const r = rankTeachers(cands, { likesById: { A: 50000, B: 90000, G: 400000 }, ...NOROT });
  assert.equal(r.debug.gate, 'loose', 'strict ผ่านแค่ A (1 < k=2) → ต้องผ่อน');
  assert.deepEqual(r.debug.sortedIds, ['G', 'B', 'A'], 'loose รับ B (1.2) และ G (0.8) เพราะ score > 0');
  assert.deepEqual(ids(r), ['G', 'B']);
  // มีใบผ่าน strict ครบ k → ห้ามผ่อน (G ไม่มีสิทธิ์)
  const strict = rankTeachers([...cands, C('D', 2.1, { emo: ['x'] })], { likesById: { A: 50000, B: 90000, G: 400000, D: 20000 }, ...NOROT });
  assert.equal(strict.debug.gate, 'strict');
  assert.deepEqual(ids(strict), ['A', 'D']);
});

test('8ข ผ่อนด่าน (ตรวจซ้ำแบบชัด): loose = score > 0 ทุกใบรวมใบเกราะ · any = แม้ score 0', () => {
  const r = rankTeachers([C('A', 3, { theme: ['a'] }), C('G', 0.8, { guard: true })], { likesById: { A: 50000, G: 400000 }, ...NOROT });
  assert.equal(r.debug.gate, 'loose');
  assert.deepEqual(ids(r), ['G', 'A'], 'เมื่อผ่อนด่านแล้ว ใบเกราะ 1 ที่ score > 0 เข้าแถวและเรียงตามไลก์');
  const any = rankTeachers([C('Z1', 0), C('Z2', 0)], { likesById: {}, ...NOROT });
  assert.equal(any.debug.gate, 'any');
  assert.equal(any.picks.length, 2);
  assert.deepEqual(rankTeachers([], { ...NOROT }).picks, []);
  assert.deepEqual(rankTeachers(null).picks, []);
});

test('9 นิ่งเมื่อส่ง rnd เอง: เมล็ดเดียวกัน = ผลเดียวกันทั้ง picks และ debug · เมล็ดต่างกันหมุนได้จริง', () => {
  const cands = [C('T1', 2, { theme: ['a'] }), C('T2', 2, { theme: ['a'] }), C('T3', 2, { theme: ['a'] })];
  const likes = { T1: 100000, T2: 90000, T3: 80000 };
  const run = (seed) => { const r = rankTeachers(cands, { likesById: likes, rotate: 3, cap: 0, floor: 0, rnd: seeded(seed) }); return JSON.stringify({ ids: ids(r), d: r.debug }); };
  assert.equal(run(42), run(42));
  assert.equal(run(9), run(9));
  const firsts = new Set(); for (let s = 1; s <= 30; s++) firsts.add(JSON.parse(run(s)).ids[0]);
  assert.ok(firsts.size > 1, 'เมล็ดต่างกันต้องได้ใบแรกต่างกันบ้าง');
});

test('10 ทนอินพุตพิการ: ใบไม่มี id ถูกทิ้ง · opts ว่าง/ค่าเพี้ยนใช้ค่าเริ่มต้น · hits เป็นตัวเลข/บูลีนนับเข้าด่าน strict จริง (ไม่ใช่รอดเพราะผ่อนด่าน)', () => {
  // ok (hitsTheme=1 ตัวเลข) · ok2 (hitsEmo=true) · arr (อาเรย์) ผ่าน strict ครบ 3 ≥ k → gate strict · lo (score 1.5 ไลก์สูงสุด) ต้องตกด่าน
  // ถ้าตัวเลข/บูลีนไม่ถูกนับ: strict เหลือ arr ใบเดียว → ผ่อน loose → lo หลุดเข้ามาเป็นใบแรก (ผู้ตรวจไขว้ 2 ก.ย. 69: ข้อเดิมไม่กัดเพราะไม่มี lo)
  const r = rankTeachers([
    { id: 'ok', score: 3, hitsTheme: 1 }, { score: 9, hitsTheme: ['x'] }, null, { id: '', score: 5 },
    { id: 'ok2', score: 2, hitsEmo: true }, { id: 'arr', score: 2, hitsTheme: ['x'] }, { id: 'lo', score: 1.5, hitsTheme: ['y'] },
  ], { likesById: { ok: 1000, ok2: 500, arr: 5000, lo: 9000 }, k: 'x', cap: 'y', floor: null, rotate: -3 });
  assert.equal(r.debug.gate, 'strict', 'hits ตัวเลข/บูลีนต้องนับเป็นแมตช์ → strict ผ่าน 3 ใบ ไม่ต้องผ่อน');
  assert.deepEqual(r.debug.sortedIds, ['arr', 'ok', 'ok2'], 'lo (score < 2) ต้องไม่อยู่ในแถว');
  assert.deepEqual(ids(r), ['arr', 'ok']);
  assert.deepEqual(RANK_DEFAULTS, { k: 2, cap: 8, floor: 50000, rotate: 3 });
  const r2 = rankTeachers([C('a', 3, { theme: ['x'] }), C('b', 3, { theme: ['x'] }), C('c', 3, { theme: ['x'] })]); // ไม่ส่ง opts เลย = Math.random
  assert.equal(r2.picks.length, 2);
});

// ═══ สายเชื่อมกับชั้นเฉพาะกิจ (viralFewshot.shortlistExamples → cands → rankTeachers) ═══
const mkRow = (id, cat, title) => ({ id, category: cat, title, content: 'x'.repeat(300), engagement_likes: 0 });
const ROWS = [
  mkRow('a1', 'ดราม่าครอบครัว', 'แม่เลี้ยงลูกคนเดียว'), mkRow('a2', 'ดราม่าครอบครัว', 'พ่อกลับมาหาลูก'),
  mkRow('b1', 'ความรักสัตว์', 'หมาเฝ้าเจ้าของ'), mkRow('b2', 'ความรักสัตว์', 'แมวรอหน้าบ้าน'),
  mkRow('c1', 'สู้ชีวิต', 'ขายของหาเงินเรียน'), mkRow('c2', 'สู้ชีวิต', 'ปั่นจักรยานไปทำงาน'),
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
const BRIEF = {
  title: 'แม่เลี้ยงลูกคนเดียวจนลูกเรียนจบ', category: 'ครอบครัว', libCat: 'ดราม่าครอบครัว',
  coreStory: 'เปิดด้วยความยากลำบาก เล่าการต่อสู้ของแม่ จบด้วยความสำเร็จของลูก',
  excerpt: 'เรื่องราวความรักของแม่ลูกที่ต่อสู้กับความยากจน จนลูกเรียนจบมีงานทำ',
};

test('11 shortlistExamples ส่ง cands คู่ขนานกับ list: id/row ตรงใบ · score = เลขใน reason · guard ตรงป้าย เกราะ1 · hits เป็นอาเรย์', () => {
  const sl = shortlistExamples(BRIEF, ROWS, ESS, 8);
  assert.ok(sl.list.length >= 2 && !sl.fell);
  assert.equal(sl.cands.length, sl.list.length);
  const segs = sl.reason.split(' | ');
  sl.cands.forEach((c, i) => {
    assert.equal(c.id, sl.list[i].id);
    assert.equal(c.row, sl.list[i], 'row ต้องเป็นอ็อบเจกต์แถวเดียวกัน (ผู้เรียกเอาไปเป็น picks ได้ตรงๆ)');
    assert.ok(Array.isArray(c.hitsTheme) && Array.isArray(c.hitsEmo));
    assert.equal(typeof c.score, 'number');
    assert.ok(segs[i].includes(` ${c.score.toFixed(2)} `), `score ต้องตรงกับเลขใน reason: ${segs[i]}`);
    assert.equal(c.guard, /เกราะ1/u.test(segs[i]), `ธง guard ต้องตรงกับป้าย เกราะ1 ใน reason: ${segs[i]}`);
  });
  assert.ok(sl.cands.some((c) => c.guard), 'ชั้นเดิมมี 2 ใบ → ต้องมีใบเกราะ 1 ในโผ');
  // โผเดิม (list/reason) ต้องไม่เปลี่ยนเพราะเพิ่มช่อง cands (พาริตี้ผู้เรียกเก่า)
  assert.deepEqual(Object.keys(sl).filter((k) => k !== 'cands').sort(), ['fell', 'forced', 'forcedReal', 'head', 'list', 'note', 'quota', 'reason', 'shelfTxt', 'tail']);
});

test('12 ต่อสาย: cands จากชั้นเฉพาะกิจเข้า rankTeachers ได้ตรงๆ — picks เป็นแถวจริง และใบเกราะ 1 ที่ไม่มี hit ไม่ถูกหยิบ', () => {
  const sl = shortlistExamples(BRIEF, ROWS, ESS, 8);
  const likes = Object.fromEntries(sl.cands.map((c, i) => [c.id, { likes: 60000 + i * 1000 }]));
  const r = rankTeachers(sl.cands, { likesById: likes, recentUsageById: {}, k: 2, cap: 8, floor: 50000, rotate: 3, rnd: () => 0 });
  assert.equal(r.picks.length, 2);
  for (const p of r.picks) {
    assert.ok(ROWS.includes(p.row), 'row ต้องเป็นแถวจากคลัง');
    assert.ok(p.hitsTheme.length + p.hitsEmo.length > 0 && p.score >= 2, 'ใบที่หยิบต้องผ่านด่านแมตช์');
  }
});

// ═══ 13 สนามจำลอง: getViralFewshotBlock ยิงจริงกับ PostgREST จำลองบน 127.0.0.1 (ผู้ตรวจไขว้ 2 ก.ย. 69 — ข้อเดิมค้นคำใน source ทุบสายเชื่อมแล้วไม่แดง) ═══
// ฟิกซ์เจอร์: ครูจริง 12 ใบจากบัตรลักษณะ (data/viral-essences.json) ที่มีไลก์จริง ≥ 60k และธีม "ช่วยเหลือ/น้ำใจ/พระสงฆ์/สูญเสีย"
//   ต้องเป็น id จริง เพราะ viralFewshot อ่านบัตรลักษณะ + ไลก์จริงจากไฟล์เอง (ไม่มีทางฉีด) · เนื้อ/ชื่อ/หมวดของแถวปลอมทั้งหมด
//   ข่าวสมมติเขียนให้แมตช์ธีม+อารมณ์หลายใบ → โผผ่านด่าน strict ≥ 3 ใบ (ฉาก cap ต้องมีใบเหลือพอให้ "ข้ามแล้วไม่หยิบ" ไม่ใช่ข้ามแล้วเติมกลับ)
const ESS_FILE = JSON.parse(readFileSync(new URL('../data/viral-essences.json', import.meta.url), 'utf8'));
const LIKES_FILE = JSON.parse(readFileSync(new URL('../data/viral-likes-real.json', import.meta.url), 'utf8')).byId;
const FIELD_KEYS = ['ช่วยเหลือ', 'น้ำใจ', 'พระสงฆ์', 'สูญเสีย'];
const FIELD_IDS = Object.keys(ESS_FILE)
  .filter((id) => likesFromMap(LIKES_FILE, id) >= 60000 && (ESS_FILE[id]?.themes || []).some((t) => FIELD_KEYS.some((k) => String(t).includes(k))))
  .sort((a, b) => likesFromMap(LIKES_FILE, b) - likesFromMap(LIKES_FILE, a) || (a < b ? -1 : 1))
  .slice(0, 12);
const FIELD_ROWS = FIELD_IDS.map((id, i) => ({
  id, title: `ครูสนาม${i}`, content: `เนื้อครู-${id.slice(0, 8)} ` + 'ก'.repeat(280),
  writing_notes: 'โน้ตสนาม', category: i % 2 ? 'ช่วยเหลือกัน' : 'สู้ชีวิต', engagement_likes: 0,
}));
const FIELD_BRIEF = {
  category: 'สังคม', emotionalTags: ['ซาบซึ้ง', 'สะเทือนใจ', 'ชื่นชม'], archetype: 'เรื่องราวของคนคนหนึ่ง',
  newsTitle: 'ชาวบ้านร่วมใจช่วยเหลือครอบครัวผู้สูญเสีย',
  newsBrief: { coreStory: 'เปิดด้วยเหตุสูญเสีย เล่าการช่วยเหลือของพระสงฆ์และชุมชน จบด้วยน้ำใจ', excerpt: 'พระสงฆ์ ตำรวจ และชาวบ้านช่วยเหลือครอบครัวที่สูญเสีย ด้วยน้ำใจ' },
};
// คำตอบคาดหวังคำนวณจากโค้ดจริงชิ้นเดียวกัน (ไม่ก๊อปกติกา) เฉพาะส่วนที่นิ่ง: หมวดของตัวจำแนก 2 รุ่น / โผชั้นเฉพาะกิจ / ด่าน / ลำดับไลก์
//   (การหยิบในหัวแถว 3 ใบสุ่มจริงในโปรดักชัน → ข้อสอบตรวจ "อยู่ในแถวผ่านด่าน" ไม่ล็อกว่าใบไหน)
const EXP = {
  libV2: pickLibraryCategoryV2({ category: FIELD_BRIEF.category, emotionalTags: FIELD_BRIEF.emotionalTags, archetype: FIELD_BRIEF.archetype }),
  libOld: pickLibraryCategory({ category: FIELD_BRIEF.category, emotionalTags: FIELD_BRIEF.emotionalTags, archetype: FIELD_BRIEF.archetype }),
};
const fieldExpect = (libCat) => {
  const sl = shortlistExamples(
    { title: FIELD_BRIEF.newsTitle, category: FIELD_BRIEF.category, emotionalTags: FIELD_BRIEF.emotionalTags, archetype: FIELD_BRIEF.archetype, libCat,
      coreStory: FIELD_BRIEF.newsBrief.coreStory, excerpt: FIELD_BRIEF.newsBrief.excerpt, cardEssence: '' },
    FIELD_ROWS, ESS_FILE, 8,
  );
  const rk = rankTeachers(sl.cands || [], { likesById: LIKES_FILE, recentUsageById: {}, k: 2, cap: 8, floor: 50000, rotate: 1 });
  return { listIds: sl.list.map((r) => r.id), gate: rk.debug.gate, sortedIds: rk.debug.sortedIds };
};

// PostgREST จำลอง: ตอบ viral_examples (คลังครู) + store_items (GET = สมุดประวัติ 7 วัน · POST = จดสมุด) · จดทุกคำขอไว้ให้ข้อสอบดู
//   เลียนแบบของจริงเรื่อง select ของ JSON path (เอกสาร PostgREST/supabase-js "Querying JSON data": ชื่อคีย์ = ส่วนท้ายของ path)
//   select=data->picks → { picks: [...] } · select=data → { data: { picks } } · อย่างอื่น → แถวว่าง (ขอคอลัมน์อื่นก็ไม่ได้ picks)
async function withMockDb({ rows, usageRows = [] }, fn) {
  const st = { requests: [], inserted: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const select = u.searchParams.get('select') || '';
      st.requests.push({ m: req.method, path: u.pathname, select, url: req.url });
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'content-range': '0-0/*' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'GET' && u.pathname === '/rest/v1/viral_examples') return json(200, rows);
      if (req.method === 'GET' && u.pathname === '/rest/v1/store_items') {
        if (select === 'data->picks') return json(200, usageRows.map((r) => ({ picks: r.picks })));
        if (select === 'data') return json(200, usageRows.map((r) => ({ data: { picks: r.picks } })));
        return json(200, usageRows.map(() => ({})));
      }
      if (req.method === 'POST' && u.pathname === '/rest/v1/store_items') { try { st.inserted.push(JSON.parse(body)); } catch { st.inserted.push({ raw: body }); } return json(201, undefined); }
      return json(404, []);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn({ port: server.address().port, st }); }
  finally { await new Promise((r) => server.close(r)); }
}
// ยิงโปรเซสลูก (ไฟล์นี้เองในโหมด RANK_FIELD_CHILD) ให้เรียก getViralFewshotBlock ครั้งเดียวด้วย env ของฉากนั้น
//   ล้าง env ที่เกี่ยวกับ Supabase/สวิตช์ครูออกก่อน (เชลล์คนรันอาจ export .env.local ไว้) แล้วชี้ Supabase ไปที่ตัวจำลอง
//   🔴 ต้องเป็น spawn แบบ async: spawnSync จะบล็อกลูปของแม่ → เซิร์ฟเวอร์จำลอง (อยู่ในแม่) ตอบลูกไม่ได้ = ค้างจนหมดเวลา (เจอจริง 2 ก.ย. 69)
function runFieldChild(port, envOverride) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(NODE_TEST|SUPABASE|NEXT_PUBLIC_SUPABASE|VIRAL_|TEACHER_RANK|LIB_CLASSIFIER|CARD_TEACHER)/.test(k)) delete env[k];
  Object.assign(env, {
    RANK_FIELD_CHILD: '1',
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_KEY: 'fake-key-for-mock-only',
    SUPABASE_RESILIENCE_MODE: 'off', VIRAL_SHORTLIST: '1',
  }, envOverride);
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, [SELF], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    ch.stdout.setEncoding('utf8'); ch.stderr.setEncoding('utf8');
    ch.stdout.on('data', (c) => { stdout += c; });
    ch.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => { ch.kill(); reject(new Error(`โปรเซสลูกค้างเกิน 60 วิ · stderr: ${stderr.slice(-800)}`)); }, 60000);
    ch.on('error', (e) => { clearTimeout(timer); reject(e); });
    ch.on('close', (code) => {
      clearTimeout(timer);
      try {
        const m = stdout.match(/__RANK_FIELD_JSON__(\{.*\})/su);
        assert.ok(m, `โปรเซสลูกไม่คืนผล (exit ${code}) stderr: ${stderr.slice(-800)}`);
        const out = JSON.parse(m[1]);
        assert.equal(out.err, null, `getViralFewshotBlock โยน: ${out.err}`);
        resolve(out);
      } catch (e) { reject(e); }
    });
    ch.stdin.end(JSON.stringify(FIELD_BRIEF));
  });
}
const historyRow = (st) => { assert.equal(st.inserted.length, 1, 'ต้องจดสมุดประวัติ 1 แถว'); assert.equal(st.inserted[0].store_name, 'viral_pick_history'); return st.inserted[0].data; };
const historyReads = (st) => st.requests.filter((r) => r.m === 'GET' && r.path === '/rest/v1/store_items');
const assertBlockHasTeachers = (block, pickIds) => {
  assert.equal(pickIds.length, 2, 'ครู 2 ใบเสมอ');
  for (const id of pickIds) assert.ok(block.includes(`เนื้อครู-${String(id).slice(0, 8)}`), `บล็อกต้องมีเนื้อครู ${String(id).slice(0, 8)} ที่สมุดบอกว่าหยิบ (ไม่ใช่ครูเนื้อว่าง)`);
  assert.ok(block.includes('โพสต์ไวรัลจริงที่จับคู่กับข่าวนี้'), 'หัวบล็อก = แบบจับคู่');
};

test('13 ฟิกซ์เจอร์สนามต้องกัดได้จริง: ตัวจำแนก 2 รุ่นให้หมวดต่างกัน · โผผ่านด่าน strict ≥ 3 ใบ ไลก์ ≥ 50k ทุกใบ', () => {
  assert.ok(FIELD_ROWS.length >= 6, `ครูสนามต้องพอ (ได้ ${FIELD_ROWS.length}) — ถ้าไฟล์ไลก์/บัตรลักษณะเปลี่ยน ให้ปรับ FIELD_KEYS`);
  assert.notEqual(EXP.libV2, EXP.libOld, `ตัวจำแนก V2 (${EXP.libV2}) กับตัวเดิม (${EXP.libOld}) ต้องให้คำตอบต่างกัน ไม่งั้นฉาก LIB_CLASSIFIER_V2=0 พิสูจน์อะไรไม่ได้`);
  for (const lib of [EXP.libV2, EXP.libOld]) {
    const ex = fieldExpect(lib);
    assert.equal(ex.gate, 'strict', `ด่านต้องผ่านแบบ strict (libCat=${lib})`);
    assert.ok(ex.sortedIds.length >= 3, `ต้องมีใบผ่านด่าน ≥ 3 (ได้ ${ex.sortedIds.length})`);
    for (const id of ex.sortedIds) assert.ok(likesFromMap(LIKES_FILE, id) >= 50000, 'ทุกใบต้องถึงพื้น 50k (ฉาก cap ต้องไม่ปนเรื่องพื้น)');
  }
});

test('13ก สนาม (สวิตช์ค่าเริ่มต้น): บล็อกมีเนื้อครูที่หยิบจริง · สมุดจด mode rank-v2 + rank{gate,reason,skipped} + libSize · อ่านสมุด 7 วันแบบเบา (select=data->picks) · หมวดจาก V2', async () => {
  const ex = fieldExpect(EXP.libV2);
  await withMockDb({ rows: FIELD_ROWS }, async ({ port, st }) => {
    const out = await runFieldChild(port, {});
    const d = historyRow(st);
    assert.equal(d.mode, 'rank-v2');
    assert.equal(d.lib, EXP.libV2, 'ค่าเริ่มต้น = หมวดจากตัวจำแนก V2');
    assert.equal(d.libSize, FIELD_ROWS.length, 'rank-v2 นับเป็นสายชั้นเฉพาะกิจ → สมุดมี libSize = คลังทั้งก้อน');
    assert.equal(d.poolSize, ex.listIds.length, 'poolSize = โผชั้นเฉพาะกิจที่กติกาเห็นจริง');
    assert.ok(d.rank && typeof d.rank === 'object', 'สมุดต้องมีช่อง rank');
    assert.equal(d.rank.gate, ex.gate);
    assert.match(String(d.rank.reason), /ด่านแมตช์ ผ่าน/u);
    assert.deepEqual(d.rank.skipped, [], 'ไม่มีใครติด cap/ต่ำกว่าพื้น');
    const picked = d.picks.map((p) => p.id);
    for (const id of picked) assert.ok(ex.sortedIds.includes(id), `ใบที่หยิบต้องอยู่ในแถวผ่านด่าน: ${id}`);
    assertBlockHasTeachers(out.block, picked);
    assert.ok(out.logs.some((l) => l.includes('rank-v2 หยิบ') && l.includes('ด่านแมตช์')), 'log 1 บรรทัดพร้อมเหตุผลกติกา');
    const reads = historyReads(st);
    assert.equal(reads.length, 1, 'อ่านสมุดประวัติ 1 ครั้ง (หน้าเดียวเพราะสมุดว่าง)');
    assert.equal(reads[0].select, 'data->picks', 'ขอเฉพาะ picks ไม่ใช่ data ทั้งก้อน (ผู้ตรวจไขว้: ลดขนาด ~5 เท่า)');
    assert.match(reads[0].url, /store_name=eq\.viral_pick_history/u);
    assert.match(reads[0].url, /created_at=gte\.\d{4}-\d{2}-\d{2}T/u, 'กรองย้อนหลังตามเวลา');
    assert.equal(st.requests.filter((r) => r.m === 'GET' && r.path === '/rest/v1/viral_examples').length, 1, 'ดึงคลังครู 1 ครั้ง');
  });
});

test('13ข สนาม TEACHER_RANK_V2=0: ไม่อ่านสมุดประวัติเลย · สมุดจด mode shortlist · ไม่มีช่อง rank · ครูยังมาจากโผชั้นเฉพาะกิจและมีเนื้อจริง', async () => {
  const ex = fieldExpect(EXP.libV2);
  await withMockDb({ rows: FIELD_ROWS }, async ({ port, st }) => {
    const out = await runFieldChild(port, { TEACHER_RANK_V2: '0' });
    const d = historyRow(st);
    assert.equal(d.mode, 'shortlist');
    assert.ok(!('rank' in d), 'ปิดสวิตช์ = แถวสมุดรูปเดิม ไม่มีช่อง rank');
    assert.equal(historyReads(st).length, 0, 'ปิดสวิตช์ต้องไม่อ่านสมุดประวัติ (ไม่มี GET store_items)');
    const picked = d.picks.map((p) => p.id);
    for (const id of picked) assert.ok(ex.listIds.includes(id), `ตัวสุ่มเดิมหยิบจากโผชั้นเฉพาะกิจ: ${id}`);
    assertBlockHasTeachers(out.block, picked);
    assert.ok(!out.logs.some((l) => l.includes('rank-v2')), 'ไม่มี log rank-v2');
  });
});

test('13ค สนาม TEACHER_RANK_V2=off (ไม่ใช่ "0" ตรงตัว) = ยังเป็น rank-v2', async () => {
  const ex = fieldExpect(EXP.libV2);
  await withMockDb({ rows: FIELD_ROWS }, async ({ port, st }) => {
    const out = await runFieldChild(port, { TEACHER_RANK_V2: 'off' });
    const d = historyRow(st);
    assert.equal(d.mode, 'rank-v2');
    assert.equal(d.rank?.gate, ex.gate);
    assert.equal(historyReads(st).length, 1);
    assertBlockHasTeachers(out.block, d.picks.map((p) => p.id));
  });
});

test('13ง สนาม LIB_CLASSIFIER_V2=0: สมุดจดหมวดจากตัวจำแนกเดิม (default ชั้นใหญ่) · กติกาครูยัง rank-v2', async () => {
  const ex = fieldExpect(EXP.libOld);
  await withMockDb({ rows: FIELD_ROWS }, async ({ port, st }) => {
    const out = await runFieldChild(port, { LIB_CLASSIFIER_V2: '0' });
    const d = historyRow(st);
    assert.equal(d.lib, EXP.libOld, 'ปิดสวิตช์ = หมวดจาก pickLibraryCategory เดิม');
    assert.equal(d.mode, 'rank-v2');
    assert.equal(d.rank?.gate, ex.gate);
    assert.equal(d.poolSize, ex.listIds.length);
    assertBlockHasTeachers(out.block, d.picks.map((p) => p.id));
  });
});

test('13จ สนาม cap: ใบไลก์สูงสุดถูกใช้ไป 8 ครั้งใน 7 วัน (สมุดตอบรูป PostgREST ของ select=data->picks) → ถูกข้ามและ "ไม่ถูกหยิบ" · สมุดจดเหตุผล', async () => {
  const ex = fieldExpect(EXP.libV2);
  const capId = ex.sortedIds[0]; // ใบไลก์สูงสุดของแถวผ่านด่าน — ถ้าไม่มี cap มันคือใบที่ได้บ่อยสุด
  const usageRows = Array.from({ length: 8 }, (_, i) => ({ picks: [{ id: capId, title: `เก่า${i}` }, { id: 'ใบอื่น', title: 'x' }] }));
  await withMockDb({ rows: FIELD_ROWS, usageRows }, async ({ port, st }) => {
    const out = await runFieldChild(port, {});
    const d = historyRow(st);
    assert.equal(d.mode, 'rank-v2');
    assert.equal(historyReads(st).length, 1);
    const hit = (d.rank?.skipped || []).find((s) => s.id === capId);
    assert.ok(hit, `สมุดต้องจดว่า ${capId.slice(0, 8)} ถูกข้าม: ${JSON.stringify(d.rank)}`);
    assert.match(hit.why, /ใช้ไป 8 ครั้ง\/7วัน ≥ cap 8/u);
    const picked = d.picks.map((p) => p.id);
    assert.ok(!picked.includes(capId), `ใบติด cap ต้องไม่ถูกหยิบเมื่อยังมีใบอื่นพอ (หยิบ ${picked.map((x) => x.slice(0, 8))})`);
    for (const id of picked) assert.ok(ex.sortedIds.includes(id), `ใบที่หยิบต้องอยู่ในแถวผ่านด่าน: ${id}`);
    assertBlockHasTeachers(out.block, picked);
    assert.ok(out.logs.some((l) => l.includes('rank-v2 หยิบ') && l.includes('cap 1')), 'log บอกว่าข้ามเพราะ cap 1 ใบ');
  });
});
