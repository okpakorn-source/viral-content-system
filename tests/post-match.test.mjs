// ★ 2 ก.ย. 69 — ข้อ 5 ป้อนกลับผลจริง: parser CSV เพจ · grams/similarity · matchPosts (รวมเคสชน) · planImport (idempotent)
// รัน: node --test tests/post-match.test.mjs (ไม่แตะเครือข่าย/DB — ฟิกซ์เจอร์ล้วน)
// ผลทุบ (2 ก.ย. 69 — ทุบแล้วคืนโค้ดเดิมทุกไบต์):
//   M1 ตัดด่าน usedPost ใน matchPosts (ให้ 1 โพสต์ตกหลายเคส)   ⇒ แดง "เคสชน: เคสที่คล้ายกว่าได้โพสต์ไป อีกเคสตกไปอันดับถัดไป"
//   M2 toNumber ไม่ตัดจุลภาค ("33,460" → 33)                    ⇒ แดง "parser: quote/ขึ้นบรรทัดในช่อง/BOM/ตัวเลขมีจุลภาค"
//   M3 parseCsvRows ไม่ตัด BOM                                   ⇒ แดง (หาคอลัมน์ ID โพสต์ ไม่พบ → throw) เคสเดียวกัน
//   M4 similarity หารด้วยชุดใหญ่แทนชุดเล็ก                        ⇒ แดง "similarity: เหมือนกันทุกตัว = 1 · ไม่สนช่องว่าง · สมมาตร"
//   M5 planImport ไม่เทียบยอด (มี id เดิม = ข้ามเสมอ)            ⇒ แดง "planImport: ยอดเปลี่ยน = อัปเดต คง importedAt เดิม"
//   สรุป 5/5 กัด · ตัวรัน scratchpad/mutate.mjs · คืนไฟล์แล้วเทียบ md5 ตรงเดิมทุกท่า
// ผลจริง 2 ก.ย. 69: parseFbCsv ไฟล์เพจ มิ.ย.–ก.ค. = 1,927 โพสต์ ตรงกับต้นแบบทุกฟิลด์ 1,927/1,927 · จับคู่เวอร์ชันระบบ 407 ใบ (ต้นแบบ 409 คู่ = 406 โพสต์ เพราะ 3 โพสต์ถูกจับซ้ำ)
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MATCH_THRESHOLD,
  buildPostIndex,
  grams,
  matchPosts,
  parseCsvRows,
  parseFbCsv,
  parseFbTime,
  rankPostsFor,
  similarity,
  toNumber,
} from '../src/lib/feedback/postMatch.js';
import {
  buildItem,
  itemChanged,
  parseArgs as parseImportArgs,
  planImport,
  textHash,
} from '../scripts/import-fb-metrics.mjs';

// ─── ฟิกซ์เจอร์ CSV (รูปเดียวกับไฟล์ส่งออกจริง: BOM + CRLF + ช่องมี "" และขึ้นบรรทัด + ตัวเลขมีจุลภาค) ───
const HEADER = '"ID โพสต์","ID เพจ",ชื่อเพจ,ชื่อ,คำอธิบาย,เวลาที่เผยแพร่,ลิงก์ถาวร,ประเภทโพสต์,ยอดดู,การเข้าถึง,"ความรู้สึก ความคิดเห็น และการแชร์",ความรู้สึก,ความคิดเห็น,การแชร์';
const ROW1 = '1001,100,รวมไอจีดารา,"บรรทัดแรก ""คำพูดในเครื่องหมาย"" ต่อ\nบรรทัดสอง, มีจุลภาค",,07/30/2026 22:48,https://fb/1001,รูปภาพ,"771,812","508,158","35,218","33,460","1,377",381';
const ROW2 = '1002,100,รวมไอจีดารา,ข้อความธรรมดา,,06/01/2026 00:05,https://fb/1002,วิดีโอ,10,20,30,5,2,1';
const ROW_NO_ID = ',,,,,,,,,,,,,';
const CSV = '﻿' + [HEADER, ROW1, ROW2, ROW_NO_ID, ''].join('\r\n');

test('parser: quote/ขึ้นบรรทัดในช่อง/BOM/ตัวเลขมีจุลภาค', () => {
  const rows = parseCsvRows(CSV);
  assert.equal(rows[0][0], 'ID โพสต์', 'BOM ต้องถูกตัดออกจากช่องแรก');
  assert.equal(rows[0].length, 14);
  assert.equal(rows[1].length, 14, 'ขึ้นบรรทัด/จุลภาคในช่องที่มี quote ต้องไม่แตกแถว');

  const posts = parseFbCsv(CSV);
  assert.equal(posts.length, 2, 'แถวไม่มี ID โพสต์ ต้องถูกข้าม');
  const [p1, p2] = posts;
  assert.equal(p1.postId, '1001');
  assert.equal(p1.text, 'บรรทัดแรก "คำพูดในเครื่องหมาย" ต่อ\nบรรทัดสอง, มีจุลภาค');
  assert.equal(p1.reactions, 33460, 'ต้องอ่านคอลัมน์ "ความรู้สึก" ไม่ใช่คอลัมน์รวม "ความรู้สึก ความคิดเห็น และการแชร์"');
  assert.equal(p1.comments, 1377);
  assert.equal(p1.shares, 381);
  assert.equal(p1.reach, 508158);
  assert.equal(p1.views, 771812);
  assert.equal(p1.type, 'รูปภาพ');
  assert.equal(p1.permalink, 'https://fb/1001');
  assert.equal(p1.time, '07/30/2026 22:48');
  assert.equal(p1.publishedAt, '2026-07-30T15:48:00.000Z', 'เวลาไทย UTC+7 → ISO UTC');
  assert.equal(p2.reactions, 5);
  assert.equal(p2.publishedAt, '2026-05-31T17:05:00.000Z');
});

test('parser: ไฟล์ผิดชนิด (ไม่มีคอลัมน์ ID โพสต์) ต้อง throw ไม่ใช่คืนว่างเงียบๆ', () => {
  assert.throws(() => parseFbCsv('a,b,c\n1,2,3'), /ID โพสต์/);
  assert.deepEqual(parseFbCsv(''), []);
});

test('toNumber / parseFbTime', () => {
  assert.equal(toNumber('1,234'), 1234);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber('N/A'), 0);
  assert.equal(toNumber('31.07'), 31.07);
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber(undefined), 0);
  assert.equal(parseFbTime('07/30/2026 22:48'), '2026-07-30T15:48:00.000Z');
  assert.equal(parseFbTime('2026-06-01T00:00:00.000Z'), '2026-06-01T00:00:00.000Z');
  assert.equal(parseFbTime('abc'), null);
  assert.equal(parseFbTime(''), null);
});

// ─── grams / similarity ───
const A = 'ลุงวัย 70 ปั่นสามล้อรับจ้างส่งหลานเรียนจนจบปริญญา วันรับปริญญาหลานพาลุงขึ้นเวทีขอบคุณต่อหน้าทุกคน น้ำตาไหลทั้งงาน';
const B = 'สาวโรงงานเก็บเงินสิบปีซื้อบ้านให้แม่ วันย้ายเข้าแม่ร้องไห้กอดลูกไม่ปล่อย บอกว่าไม่เคยคิดว่าจะได้มีบ้านเป็นของตัวเอง';
const C = 'ช่างตัดผมริมทางตัดฟรีให้เด็กยากจนก่อนเปิดเทอมมาแล้ว 12 ปี บอกแค่อยากให้เด็กมั่นใจในวันแรกของการเรียน';
const D = 'นักเรียนชั้น ม.6 ปลูกผักขายหลังเลิกเรียนส่งตัวเองเรียนต่อ ครูทั้งโรงเรียนแอบช่วยซื้อทุกวันจนได้ทุนไปมหาวิทยาลัย';

test('grams: ตัดช่องว่าง → ชิ้นละ size ก้าว step', () => {
  assert.deepEqual([...grams('ab cd ef', { size: 3, step: 1 })], ['abc', 'bcd', 'cde', 'def']);
  assert.equal(grams('สั้นไป').size, 0, 'สั้นกว่า 12 ตัว = ไม่มีชิ้น');
  assert.equal(grams(A).size, grams(A.replace(/ /g, '\n')).size);
});

test('similarity: เหมือนกันทุกตัว = 1 · ไม่สนช่องว่าง · สมมาตร · คนละเรื่อง = 0 · ชุดว่าง = 0', () => {
  assert.equal(similarity(A, A), 1);
  assert.equal(similarity(A, '  ' + A.replace(/ /g, '\n\n') + ' '), 1);
  assert.equal(similarity(A, B), similarity(B, A));
  assert.equal(similarity(A, D), 0);
  assert.equal(similarity('สั้น', A), 0);
  // ตัดหางออกครึ่งหนึ่ง: ชิ้นที่เหลืออยู่ในต้นฉบับครบ → เทียบกับชุดเล็ก = 1 (ไม่ใช่ ~0.5 ถ้าหารชุดใหญ่)
  const half = A.replace(/\s+/g, '').slice(0, 60);
  assert.equal(similarity(half, A), 1);
});

// ─── matchPosts: 3 โพสต์ 4 เคส รวมเคสชน ───
const posts = [A, B, C].map((text, i) => ({
  postId: `P${i + 1}`, text, reactions: [50000, 30000, 10000][i], comments: i, shares: i * 2, reach: 100 * (i + 1), views: 0,
  time: `07/0${i + 1}/2026 10:00`,
}));
const sA = A.replace(/\s+/g, '');
const sB = B.replace(/\s+/g, '');
// c2 = หน้าของ A (72 ตัว) + หางของ B ตั้งแต่ตัวที่ 54 — ตำแหน่งหาร 3 ลงตัว ให้ชิ้น step 3 เรียงตรงกับต้นฉบับ
//   วัดจริง: c2~A 0.636 > c2~B 0.471 ≥ 0.4 (ชนที่ P1 แล้วต้องตกไป P2)
const c2Text = sA.slice(0, 72) + sB.slice(54);
const candidates = [
  { id: 'c1', text: A },
  { id: 'c2', text: c2Text },
  { id: 'c3', text: C },
  { id: 'c4', text: D },
];

test('เคสชน: เคสที่คล้ายกว่าได้โพสต์ไป อีกเคสตกไปอันดับถัดไป · ไม่ถึงเกณฑ์ = ไม่มีคีย์', () => {
  const simA = similarity(c2Text, A);
  const simB = similarity(c2Text, B);
  assert.ok(simA > simB && simB >= DEFAULT_MATCH_THRESHOLD, `ฟิกซ์เจอร์ต้องชนจริง: c2~A ${simA.toFixed(2)} > c2~B ${simB.toFixed(2)} ≥ 0.4`);

  // ไม่มี c1 มาแย่ง → c2 ได้ P1 (โพสต์ที่คล้ายที่สุดของตัวเอง)
  const alone = matchPosts(posts, [candidates[1]]);
  assert.equal(alone.c2.postId, 'P1');

  const out = matchPosts(posts, candidates);
  assert.equal(out.c1.postId, 'P1');
  assert.equal(out.c1.sim, 1);
  assert.equal(out.c2.postId, 'P2', 'c2 แพ้ c1 ที่ P1 (sim 1 > sim ' + simA.toFixed(2) + ') ต้องตกไป P2');
  assert.equal(out.c2.sim, Math.round(simB * 10000) / 10000);
  assert.equal(out.c3.postId, 'P3');
  assert.equal(out.c4, undefined, 'เรื่องอื่น = ไม่จับคู่');
  assert.deepEqual(Object.keys(out).sort(), ['c1', 'c2', 'c3']);
  // ยอดจากโพสต์ที่จับได้ + เวลา
  assert.equal(out.c2.reactions, 30000);
  assert.equal(out.c1.shares, 0);
  assert.equal(out.c3.reach, 300);
  assert.equal(out.c1.publishedAt, '2026-07-01T03:00:00.000Z');
  // 1 โพสต์ตกเป็นของเคสเดียวเสมอ
  const claimed = Object.values(out).map((m) => m.postId);
  assert.equal(new Set(claimed).size, claimed.length);
});

test('threshold ปรับได้: 0.9 → c2 ไม่ถึงเกณฑ์ · 0.35 (ครู) ผ่านเหมือนเดิม', () => {
  assert.deepEqual(matchPosts(posts, [candidates[1]], { threshold: 0.9 }), {});
  assert.equal(matchPosts(posts, [candidates[1]], { threshold: 0.35 }).c2.postId, 'P1');
});

test('rankPostsFor: เรียงจากคล้ายมากไปน้อย ตัดที่เกณฑ์', () => {
  const index = buildPostIndex(posts);
  const ranked = rankPostsFor(index, c2Text, { threshold: 0.4 });
  assert.deepEqual(ranked.map((r) => r.postIndex), [0, 1]);
  assert.ok(ranked[0].sim > ranked[1].sim);
  assert.deepEqual(rankPostsFor(index, D, { threshold: 0.4 }), []);
});

test('ทนข้อมูลเพี้ยน: posts/candidates ไม่ใช่ array · candidate ไม่มีข้อความ', () => {
  assert.deepEqual(matchPosts(null, null), {});
  assert.deepEqual(matchPosts(posts, [{ id: 'x' }, { id: 'y', text: '' }]), {});
});

// ─── planImport (สคริปต์นำเข้า — ส่วนที่ไม่แตะฐานข้อมูล) ───
const importPosts = parseFbCsv(CSV);

test('planImport: ครั้งแรก = ใหม่ทั้งหมด · แถวมี id/textHash/importedAt', () => {
  const now = '2026-09-02T10:00:00.000Z';
  const { toWrite, summary } = planImport(importPosts, new Map(), { now });
  assert.deepEqual(summary, { rows: 2, new: 2, updated: 0, unchanged: 0, noText: 0, noId: 0, duplicateInCsv: 0 });
  assert.equal(toWrite.length, 2);
  assert.equal(toWrite[0].id, '1001');
  assert.equal(toWrite[0].postId, '1001');
  assert.match(toWrite[0].textHash, /^[0-9a-f]{40}$/);
  assert.equal(toWrite[0].importedAt, now);
  assert.equal(toWrite[0].updatedAt, now);
  assert.equal(toWrite[0].reactions, 33460);
  assert.equal(toWrite[0].publishedAt, '2026-07-30T15:48:00.000Z');
});

test('planImport: นำเข้าซ้ำ = ข้ามทั้งหมด ไม่มีอะไรต้องเขียน (idempotent)', () => {
  const first = planImport(importPosts, new Map(), { now: '2026-09-02T10:00:00.000Z' });
  const existing = new Map(first.toWrite.map((it) => [it.id, it]));
  const again = planImport(importPosts, existing, { now: '2026-09-03T10:00:00.000Z' });
  assert.equal(again.toWrite.length, 0);
  assert.equal(again.summary.unchanged, 2);
  assert.equal(again.summary.new + again.summary.updated, 0);
  // รับ existing เป็น object ธรรมดาได้ด้วย
  const asObject = planImport(importPosts, Object.fromEntries(existing), { now: '2026-09-03T10:00:00.000Z' });
  assert.equal(asObject.summary.unchanged, 2);
});

test('planImport: ยอดเปลี่ยน = อัปเดต คง importedAt เดิม · ข้อความเปลี่ยน = อัปเดต (textHash)', () => {
  const t1 = '2026-09-02T10:00:00.000Z';
  const t2 = '2026-09-09T10:00:00.000Z';
  const existing = new Map(planImport(importPosts, new Map(), { now: t1 }).toWrite.map((it) => [it.id, it]));
  const grown = importPosts.map((p) => (p.postId === '1002' ? { ...p, reactions: p.reactions + 500 } : p));
  const { toWrite, summary } = planImport(grown, existing, { now: t2 });
  assert.equal(summary.updated, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(toWrite[0].id, '1002');
  assert.equal(toWrite[0].reactions, 505);
  assert.equal(toWrite[0].importedAt, t1, 'importedAt ต้องเป็นของครั้งแรก');
  assert.equal(toWrite[0].updatedAt, t2);

  const edited = importPosts.map((p) => (p.postId === '1001' ? { ...p, text: p.text + ' (แก้ไข)' } : p));
  assert.equal(planImport(edited, existing, { now: t2 }).summary.updated, 1);
});

test('planImport: ไม่มีข้อความ/ไม่มี id/ซ้ำในไฟล์ ถูกนับแยก ไม่ถูกเขียน', () => {
  const rows = [
    { postId: '1', text: 'มีข้อความ', reactions: 1 },
    { postId: '2', text: '   ', reactions: 1 },
    { postId: '', text: 'ไม่มี id', reactions: 1 },
    { postId: '1', text: 'มีข้อความ', reactions: 1 },
  ];
  const { toWrite, summary } = planImport(rows, new Map(), { now: '2026-09-02T10:00:00.000Z' });
  assert.equal(toWrite.length, 1);
  assert.equal(summary.noText, 1);
  assert.equal(summary.noId, 1);
  assert.equal(summary.duplicateInCsv, 1);
});

test('textHash/buildItem/itemChanged/parseArgs', () => {
  assert.equal(textHash('ก  ข'), textHash('ก ข\n'), 'ช่องว่างต่างกัน = ข้อความเดียวกัน');
  assert.notEqual(textHash('ก ข'), textHash('ก ค'));
  const item = buildItem({ postId: ' 9 ', text: ' x ', reactions: '7' }, { now: 'T' });
  assert.equal(item.id, '9');
  assert.equal(item.text, 'x');
  assert.equal(item.reactions, 7);
  assert.equal(item.source, 'fb-csv');
  assert.equal(itemChanged(null, item), true);
  assert.equal(itemChanged({ ...item }, item), false);
  assert.equal(itemChanged({ ...item, views: 1 }, item), true);
  assert.deepEqual(parseImportArgs(['file.csv', '--dry-run', '--store', 'x', '--no-mirror']),
    { csv: 'file.csv', dryRun: true, store: 'x', mirror: false });
  assert.equal(parseImportArgs(['--store=y', 'a.csv']).store, 'y');
});
