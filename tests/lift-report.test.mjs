// ★ 2 ก.ย. 69 — ข้อ 5 ป้อนกลับผลจริง: รายงาน lift (การ์ด/ครู/ความยาว/วิธีเปิด) + ตัวอ่านแบ่งหน้า (sb ปลอม) + route GET /api/feedback/lift
// รัน: node --test tests/lift-report.test.mjs (ไม่แตะเครือข่าย/DB — ฟิกซ์เจอร์ 12 เวอร์ชัน · sb ปลอม · route โหลดแบบ new Function)
// ผลทุบ (2 ก.ย. 69 — ทุบแล้วคืนโค้ดเดิมทุกไบต์):
//   M1 median ใช้ค่าเฉลี่ยแทน                                   ⇒ แดง "ฟิกซ์เจอร์ 12 เวอร์ชัน: ค่ากลาง/lift ต่อการ์ดถูก · n<5 ไม่สรุป"
//   M2 groupStats ไม่ตั้ง insufficient (n < minN = false เสมอ)   ⇒ แดง เคสเดียวกัน (การ์ด C n=1 โผล่ใน ranked)
//   M3 lift หารด้วย mean ทั้งเพจแทน median                        ⇒ แดง เคสเดียวกัน (×3.50 → ×1.80)
//   M4 linkPickHistory ไม่เช็คระยะเวลา (จับหัวข่าวซ้ำคนละสัปดาห์) ⇒ แดง "linkPickHistory: หัวข่าวเดียวกัน+เวลาใกล้ = จับ · ห่าง 15 วัน = ไม่จับ"
//   M5 route: ตัดด่าน _authorized                               ⇒ แดง "route: ไม่มีกุญแจ → 403 ไม่คำนวณ"
//   M6 loadGenerations ไม่ขยาย ±padDays                          ⇒ แดง "loadLiftInputs: เคส/สมุดครูอ่านช่วง ±3 วัน · แบ่งหน้าจนหมด" + runLiftReport
//   M7 openingType เช็คตัวเลขก่อนคำพูด                            ⇒ แดง "openingType: …" (เคส "3 ปีที่รอคอย" ต้องเป็นคำพูด) — รอบแรกไม่กัด จึงเพิ่มเคสนี้
//   สรุป 7/7 กัด · ตัวรัน scratchpad/mutate.mjs · คืนไฟล์แล้วเทียบ md5 ตรงเดิมทุกท่า
// ผลทุบรอบแก้ผู้ตรวจ (2 ก.ย. 69 — 13 ท่า · คืนไฟล์แล้วเทียบ sha1 ตรงเดิมทุกท่า):
//   M8/M9/M10 ตัดคีย์เรียงสำรอง (id/case_id/id) ใน loadPostMetrics/loadGenerations/loadPickHistory ⇒ แดง "loadLiftInputs: …" ทั้ง 3 ท่า
//   M11 readStoreRows (สคริปต์นำเข้า) ตัดคีย์สำรอง id                 ⇒ แดง "readStoreRows (สคริปต์นำเข้า): …"
//   M12a/M12b groupStats lift/liftMean ไม่เช็ค n=0 (คืน 0)             ⇒ แดง "groupStats: …" ทั้ง 2 ท่า
//   M13a route ไม่ trim กุญแจ/env · M13b configured เช็ค env ดิบ        ⇒ แดง "route: กุญแจ/ค่า env มีช่องว่าง-ขึ้นบรรทัดท้าย …" ทั้ง 2 ท่า
//   M14 versionWords หยิบ v.wordCount (สเกลช่องว่าง) ก่อน               ⇒ แดง "buildCandidates: versionWords …"
//   M15 TITLE_KEY_LEN กลับเป็น 140 (เท่าเพดานเก็บสมุดครู)               ⇒ แดง "linkPickHistory: หัวข่าวยาวเกิน 140 …"
//   M16 DEFAULT_OUT_DIR กลับ docs/ · M17 LOCAL_DIR กลับ data/            ⇒ แดง "ไฟล์ผลลัพธ์ + สำเนา store ในเครื่อง …" ทั้ง 2 ท่า
//   M18 โหมดไฟล์อ่านสมุดครูจาก _planD/lift แทน data/                     ⇒ แดง "buildFromLocalFiles (โหมดไฟล์ …)"
//   สรุป 13/13 กัด
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { similarity } from '../src/lib/feedback/postMatch.js';
import {
  BIG_HIT_REACTIONS,
  LENGTH_BANDS,
  buildCandidates,
  buildLiftReport,
  countWords,
  groupStats,
  lengthBand,
  linkPickHistory,
  loadLiftInputs,
  mean,
  median,
  normalizeGeneration,
  openingType,
  padWindow,
  pageAll,
  renderLiftMarkdown,
  runLiftReport,
  spearman,
} from '../src/lib/feedback/liftReport.js';
import { LOCAL_DIR, ROOT, localStorePath, readStoreRows } from '../scripts/import-fb-metrics.mjs';
import { DEFAULT_OUT_DIR, buildFromLocalFiles, parseArgs as parseLiftArgs } from '../scripts/lift-report.mjs';

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

// ─── หน่วยย่อย: ช่วงความยาว / วิธีเปิด / นับคำ / สถิติ ───

test('lengthBand: ขอบล่างรวม ขอบบนไม่รวม (0-170/170-200/200-230/230-270/270+)', () => {
  assert.deepEqual([0, 169, 170, 199, 200, 229, 230, 269, 270, 900].map(lengthBand),
    ['0-170', '0-170', '170-200', '170-200', '200-230', '200-230', '230-270', '230-270', '270+', '270+']);
  assert.equal(LENGTH_BANDS.length, 5);
});

test('openingType: คำพูด → ตัวเลข → ชื่อ+การกระทำ → ภาพ → อื่นๆ (regex ง่าย + กันเศษคำ)', () => {
  assert.equal(openingType('"ไม่เคยคิดว่าจะได้กลับบ้าน" ลุงพูดทั้งน้ำตา'), 'คำพูด');
  assert.equal(openingType('ลุงพูดว่า "ไม่เคยคิดว่าจะได้กลับบ้าน" ทั้งน้ำตา'), 'คำพูด', 'คำพูดใน 12 ตัวแรก');
  assert.equal(openingType('"3 ปีที่รอคอย" ลุงพูดทั้งน้ำตา'), 'คำพูด', 'มีทั้งคำพูดและตัวเลข → คำพูดมาก่อน');
  assert.equal(openingType('อายุ 72 ปี ยังปั่นสามล้อส่งหลานเรียน'), 'ตัวเลข');
  assert.equal(openingType('ลุงสมชายปั่นสามล้อส่งหลานเรียนจนจบ'), 'ชื่อ+การกระทำ');
  assert.equal(openingType('ท่ามกลางสายฝนกลางดึก ชายคนหนึ่งยืนรอรถเมล์คันสุดท้าย'), 'ภาพ');
  assert.equal(openingType('ความกตัญญูไม่ต้องรอให้พร้อม'), 'อื่นๆ');
  assert.equal(openingType(''), 'อื่นๆ');
  // เศษคำที่เคยหลอกให้เป็น "ชื่อ": ตาม/ขยาย/หน้า/ป้าย/คุณภาพ/อย่า ต้องไม่ใช่คน
  assert.equal(openingType('ตามหาเจ้าของกระเป๋าที่ทำหล่นไว้บนรถไฟฟ้า'), 'อื่นๆ');
  assert.equal(openingType('ขยายผลเรื่องราวที่ชาวเน็ตแชร์กันจนกลายเป็นกระแส'), 'อื่นๆ');
  assert.equal(openingType('คุณภาพชีวิตของชาวบ้านริมคลองเปลี่ยนไปหลังโครงการนี้'), 'อื่นๆ');
  assert.equal(openingType('อย่าเพิ่งตัดสินเรื่องราวจากภาพเดียวที่เห็น'), 'อื่นๆ');
  assert.equal(openingType('ป้ายกำกับใหม่ของเพจทำให้ชาวเน็ตสับสน'), 'อื่นๆ');
  assert.equal(openingType('คุณยายวัยเก้าสิบยังเดินไปตลาดเองทุกเช้า'), 'ชื่อ+การกระทำ');
});

test('countWords: นับคำไทย/อังกฤษ · ว่าง = 0 · คงที่', () => {
  assert.equal(countWords('หนึ่ง สอง สาม'), 3);
  assert.equal(countWords('one two three'), 3);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords(null), 0);
  const w = countWords('ลุงวัยเจ็ดสิบปั่นสามล้อรับจ้างส่งหลานเรียนจนจบปริญญา');
  assert.ok(w >= 8 && w <= 16, `นับคำไทยได้ช่วงสมเหตุสมผล (ได้ ${w})`);
  assert.equal(countWords('ลุงวัยเจ็ดสิบปั่นสามล้อรับจ้างส่งหลานเรียนจนจบปริญญา'), w);
});

test('median/mean/spearman', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([]), 0);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  assert.equal(spearman([1, 1, 2], [1, 2, 3]), 0.866, 'อันดับซ้ำใช้ค่าเฉลี่ยอันดับ');
  assert.equal(spearman([1, 2], [1, 2]), null);
  assert.equal(spearman([5, 5, 5], [1, 2, 3]), null);
});

test('groupStats: n/median/mean/≥50k%/lift เทียบฐาน · n<minN = insufficient · ฐาน 0 = lift null', () => {
  const s = groupStats([10000, 20000, 30000, 40000, 60000, 80000], { median: 10000, mean: 20000 }, 5);
  assert.deepEqual(s, { n: 6, median: 35000, mean: 40000, bigHitPct: 33.3, lift: 3.5, liftMean: 2, insufficient: false });
  assert.equal(groupStats([1, 2, 3], { median: 1, mean: 1 }, 5).insufficient, true);
  assert.equal(groupStats([1, 2, 3], { median: 0, mean: 0 }, 1).lift, null);
  // กลุ่มว่าง (n=0) ต้อง null ไม่ใช่ ×0.00 — รายงานที่จับคู่ไม่ได้เลยต้องพิมพ์ '—' (ผู้ตรวจ 2 ก.ย.)
  const empty = groupStats([], { median: 7752, mean: 16841 }, 5);
  assert.deepEqual([empty.n, empty.lift, empty.liftMean, empty.insufficient], [0, null, null, true]);
  assert.equal(BIG_HIT_REACTIONS, 50000);
});

// ─── รูปข้อมูลเคส / สมุดครู ───

test('normalizeGeneration: snake_case (Supabase) · camelCase (ไฟล์) · promptName/promptId ที่ PostgREST ตั้งชื่อ', () => {
  const a = normalizeGeneration({ case_id: '00001', created_at: 'T', news_title: 'ข่าว', versions: [{ content: 'x' }], pipeline_info: { promptName: 'การ์ด A', promptId: 'a' } });
  const b = normalizeGeneration({ caseId: '00001', createdAt: 'T', newsTitle: 'ข่าว', versions: [{ content: 'x' }], pipelineInfo: { promptName: 'การ์ด A', promptId: 'a' } });
  const c = normalizeGeneration({ case_id: '00001', created_at: 'T', news_title: 'ข่าว', versions: [{ content: 'x' }], promptName: 'การ์ด A', promptId: 'a' });
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(a.promptName, 'การ์ด A');
  assert.equal(normalizeGeneration({ versions: [] }), null);
  assert.equal(normalizeGeneration(null), null);
});

test('buildCandidates: การ์ดชื่อซ้ำคนละ id ได้ป้ายต่อท้ายเศษ id · เวอร์ชันว่างไม่เป็น candidate · ไม่มีการ์ด = (ไม่ระบุการ์ด)', () => {
  const gens = [
    { case_id: '1', created_at: 'T', news_title: 'a', versions: [{ content: 'เนื้อ 1' }, { content: '   ' }], pipeline_info: { promptName: 'การ์ดเดียวกัน', promptId: 'id-aaaaaaaa-1' } },
    { case_id: '2', created_at: 'T', news_title: 'b', versions: [{ content: 'เนื้อ 2' }], pipeline_info: { promptName: 'การ์ดเดียวกัน', promptId: 'id-bbbbbbbb-2' } },
    { case_id: '3', created_at: 'T', news_title: 'c', versions: [{ content: 'เนื้อ 3' }], pipeline_info: { promptName: 'การ์ดเดี่ยว', promptId: 'id-c' } },
    { case_id: '4', created_at: 'T', news_title: 'd', versions: [{ content: 'เนื้อ 4', promptId: 'id-c' }], pipeline_info: {} },
    { case_id: '5', created_at: 'T', news_title: 'e', versions: [{ content: 'เนื้อ 5' }], pipeline_info: {} },
  ].map(normalizeGeneration);
  const { candidates, metaById } = buildCandidates(gens);
  assert.deepEqual(candidates.map((c) => c.id), ['1#0', '2#0', '3#0', '4#0', '5#0']);
  assert.equal(metaById.get('1#0').cardName, 'การ์ดเดียวกัน [id-aaaaa]');
  assert.equal(metaById.get('2#0').cardName, 'การ์ดเดียวกัน [id-bbbbb]');
  assert.equal(metaById.get('3#0').cardName, 'การ์ดเดี่ยว');
  assert.equal(metaById.get('4#0').cardName, 'การ์ดเดี่ยว', 'promptId ของเวอร์ชันหาชื่อจากเคสอื่นได้');
  assert.equal(metaById.get('4#0').cardKey, 'id-c');
  assert.equal(metaById.get('5#0').cardKey, '(ไม่ระบุการ์ด)');
  assert.equal(metaById.get('5#0').cardName, '(ไม่ระบุการ์ด)');
});

test('buildCandidates: versionWords ใช้ตัวนับเดียวกับ words ของโพสต์จริง (Intl.Segmenter) เสมอ — ไม่หยิบ v.wordCount ที่ generationLogger นับด้วยช่องว่าง (ผู้ตรวจ 2 ก.ย.)', () => {
  const content = 'ลุงวัยเจ็ดสิบปั่นสามล้อรับจ้างส่งหลานเรียนจนจบปริญญา';
  const ws = content.split(' ').filter(Boolean).length; // = 1 — วิธีเดียวกับ generationLogger (split ช่องว่าง) เมื่อไทยไม่มีช่องว่าง
  const seg = countWords(content);
  assert.ok(seg > ws, `ฟิกซ์เจอร์ต้องแยกสเกลได้: Segmenter ${seg} > ช่องว่าง ${ws}`);
  const gens = [normalizeGeneration({
    case_id: '1', created_at: 'T', news_title: 'a', pipeline_info: { promptName: 'x', promptId: 'x' },
    versions: [{ content, wordCount: ws }, { content }],
  })];
  const { metaById } = buildCandidates(gens);
  assert.equal(metaById.get('1#0').versionWords, seg, 'มี wordCount (สเกลช่องว่าง) ก็ต้องนับใหม่ด้วย Segmenter');
  assert.equal(metaById.get('1#1').versionWords, seg);
});

test('linkPickHistory: หัวข่าวเดียวกัน+เวลาใกล้ = จับ · ห่าง 15 วัน = ไม่จับ · หลายแถวรวมครูไม่ซ้ำ', () => {
  const gens = [
    normalizeGeneration({ case_id: '1', created_at: '2026-08-10T10:00:00.000Z', news_title: 'ข่าว ก', versions: [] }),
    normalizeGeneration({ case_id: '2', created_at: '2026-08-25T10:00:00.000Z', news_title: 'ข่าว ก', versions: [] }),
  ];
  const picks = [
    { ts: '2026-08-10T09:58:00.000Z', newsTitle: 'ข่าว  ก ', picks: [{ id: 'T1', title: 'ครู1' }, { id: 'T2', title: 'ครู2' }] },
    { data: { ts: '2026-08-10T10:01:00.000Z', newsTitle: 'ข่าว ก', picks: [{ id: 'T2', title: 'ครู2' }, { id: 'T3' }] } },
    { ts: '2026-08-10T10:01:00.000Z', newsTitle: 'ข่าว ข', picks: [{ id: 'T9', title: 'ครู9' }] },
  ];
  const linked = linkPickHistory(gens, picks);
  assert.deepEqual(linked.get('1'), [{ id: 'T1', title: 'ครู1' }, { id: 'T2', title: 'ครู2' }, { id: 'T3', title: 'T3' }]);
  assert.equal(linked.has('2'), false, 'หัวข่าวซ้ำแต่ห่าง 15 วัน = คนละเคส');
  assert.equal(linkPickHistory(gens, []).size, 0);
});

test('linkPickHistory: หัวข่าวยาวเกิน 140 มีช่องว่างคู่/ขึ้นบรรทัดในต้น — สมุดครูเก็บตัดดิบ 140 (viralFewshot) ยังต้องจับได้ (ผู้ตรวจ 2 ก.ย.)', () => {
  // 160 ตัว: ช่องว่างคู่ที่ตำแหน่ง 4 + ขึ้นบรรทัดที่ 59 → ยุบแล้วสั้นกว่าดิบ 2 ตัว (สมุดตัดดิบ 140 → ยุบเหลือ 139 · เคสยุบเต็มแล้วตัด 140 = ไม่เท่ากันถ้าคีย์ยาว 140)
  const long = 'ข่าว  ยาว' + 'ก'.repeat(50) + NL + 'ข'.repeat(100);
  assert.equal(long.length, 160);
  const storedByFewshot = long.slice(0, 140); // แบบที่ viralFewshot._recordPickHistory เก็บ: String(newsTitle).slice(0, 140) ตัดดิบก่อนยุบ
  const gens = [normalizeGeneration({ case_id: '1', created_at: '2026-08-10T10:00:00.000Z', news_title: long, versions: [] })];
  const picks = [{ ts: '2026-08-10T10:01:00.000Z', newsTitle: storedByFewshot, picks: [{ id: 'T1', title: 'ครู1' }] }];
  assert.deepEqual(linkPickHistory(gens, picks).get('1'), [{ id: 'T1', title: 'ครู1' }]);
  // หัวข่าวคนละเรื่องที่ต้นเหมือนกัน 59 ตัวแต่ต่างกันก่อนถึงตัวที่ 120 ต้องไม่จับ
  const other = 'ข่าว  ยาว' + 'ก'.repeat(50) + NL + 'ค'.repeat(100);
  assert.equal(linkPickHistory([normalizeGeneration({ case_id: '2', created_at: '2026-08-10T10:00:00.000Z', news_title: other, versions: [] })], picks).size, 0);
});

// ─── ฟิกซ์เจอร์หลัก: 15 โพสต์ (12 ที่ระบบเขียน + 3 โพสต์อื่นของเพจ) · 12 เวอร์ชัน/12 เคส · การ์ด A×6 B×5 C×1 ───
const TEXTS = [
  'ลุงวัยเจ็ดสิบปั่นสามล้อรับจ้างส่งหลานเรียนจนจบปริญญา วันรับปริญญาหลานพาลุงขึ้นเวทีขอบคุณต่อหน้าทุกคน น้ำตาไหลทั้งงาน',
  'สาวโรงงานเก็บเงินสิบปีซื้อบ้านให้แม่ วันย้ายเข้าแม่ร้องไห้กอดลูกไม่ปล่อย บอกว่าไม่เคยคิดว่าจะได้มีบ้านเป็นของตัวเอง',
  'ช่างตัดผมริมทางตัดฟรีให้เด็กยากจนก่อนเปิดเทอมมาแล้วสิบสองปี บอกแค่อยากให้เด็กมั่นใจในวันแรกของการเรียน',
  'นักเรียนชั้นมอหกปลูกผักขายหลังเลิกเรียนส่งตัวเองเรียนต่อ ครูทั้งโรงเรียนแอบช่วยซื้อทุกวันจนได้ทุนไปมหาวิทยาลัย',
  'คนขับแท็กซี่เก็บกระเป๋าเงินสดสามแสนคืนเจ้าของโดยไม่รับสินน้ำใจ บอกว่าถ้าเป็นเงินตัวเองหายก็คงร้อนใจเหมือนกัน',
  'พยาบาลเกษียณเปิดบ้านเป็นห้องเรียนฟรีให้เด็กในชุมชนทุกเย็น สอนมาสิบปีเด็กสอบติดหมอแล้วสามคน',
  'แม่ค้าข้าวแกงแจกข้าวฟรีให้คนตกงานช่วงโควิดทุกวันจนเงินเก็บหมด วันนี้ลูกค้าเก่ากลับมาช่วยกันอุดหนุนจนขายดีกว่าเดิม',
  'เด็กชายวัยสิบขวบเดินเท้าสองกิโลไปโรงเรียนทุกวันเพราะไม่มีเงินค่ารถ ครูใหญ่รู้เรื่องจึงซื้อจักรยานให้เป็นของขวัญ',
  'คุณตาวัยแปดสิบเรียนจบปริญญาตรีพร้อมหลานสาว บอกว่าไม่มีคำว่าสายเกินไปสำหรับการเรียนรู้',
  'พ่อค้าลอตเตอรี่ตาบอดถูกโกงเงินทอน ชาวเน็ตรวมตัวกันซื้อเกลี้ยงแผงภายในวันเดียวเพื่อให้กำลังใจ',
  'ทหารเกณฑ์ปลดประจำการเดินทางกลับบ้านพบว่าแม่เก็บเงินเดือนที่ส่งให้ไว้ทุกบาทเพื่อเปิดร้านให้ลูก',
  'หมอหนุ่มลาออกจากโรงพยาบาลใหญ่กลับไปเปิดคลินิกราคาถูกที่บ้านเกิด บอกว่าอยากรักษาคนที่เคยดูแลตัวเองตอนเด็ก',
  'สุนัขจรจัดเฝ้าหน้าโรงพยาบาลรอเจ้าของที่จากไปแล้วนานหนึ่งปี พยาบาลผลัดกันให้อาหารจนกลายเป็นสมาชิกประจำ',
  'พนักงานเก็บขยะเจอแหวนเพชรในถุงขยะรีบตามหาเจ้าของจนเจอ ปรากฏว่าเป็นแหวนแต่งงานของคุณยายที่ทำหายมาสามเดือน',
  'ครูดอยเดินขึ้นเขาสี่ชั่วโมงทุกสัปดาห์ไปสอนเด็กชาวเขาสิบคน ทำมายี่สิบปีไม่เคยขอย้ายไปไหน',
];
const REACTIONS = [10000, 20000, 30000, 40000, 60000, 80000, 1000, 2000, 3000, 4000, 5000, 100000, 7000, 9000, 11000];
const CARD_OF = ['a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'c'];
const CARD_NAME = { a: 'การ์ด A', b: 'การ์ด B', c: 'การ์ด C' };
const day = (i) => `2026-07-${String(i + 1).padStart(2, '0')}T03:00:00.000Z`;

const fixturePosts = TEXTS.map((text, i) => ({
  postId: `P${i + 1}`, text, reactions: REACTIONS[i], comments: 10, shares: 5, reach: 1000, views: 0,
  time: `07/${String(i + 1).padStart(2, '0')}/2026 10:00`,
}));
const fixtureGenerations = TEXTS.slice(0, 12).map((text, i) => ({
  case_id: String(i + 1).padStart(5, '0'),
  created_at: day(i),
  news_title: `ข่าวที่ ${i + 1}`,
  versions: [{ index: 0, content: text, promptId: '' }],
  pipeline_info: { promptName: CARD_NAME[CARD_OF[i]], promptId: `card-${CARD_OF[i]}` },
}));
// สมุดครู: 6 เคสของการ์ด A มีครู T1 · 2 ในนั้นมี T2 ด้วย · แถวหลงมาจากอีก 20 วัน (หัวข่าวเดียวกัน) ต้องไม่ถูกนับ
const fixturePicks = [
  ...[0, 1, 2, 3, 4, 5].map((i) => ({
    ts: `2026-07-${String(i + 1).padStart(2, '0')}T02:59:00.000Z`, newsTitle: `ข่าวที่ ${i + 1}`,
    picks: [{ id: 'T1', title: 'ครูหนึ่ง' }, ...(i < 2 ? [{ id: 'T2', title: 'ครูสอง' }] : [])],
  })),
  { ts: '2026-07-21T02:59:00.000Z', newsTitle: 'ข่าวที่ 1', picks: [{ id: 'T7', title: 'ครูหลง' }] },
];

test('ฟิกซ์เจอร์ต้องไม่คล้ายกันเอง (ทุกคู่ < 0.4) — กันเทสผ่านเพราะบังเอิญ', () => {
  for (let i = 0; i < TEXTS.length; i++) {
    for (let j = i + 1; j < TEXTS.length; j++) {
      assert.ok(similarity(TEXTS[i], TEXTS[j]) < 0.4, `โพสต์ ${i + 1} กับ ${j + 1} คล้ายกันเกิน`);
    }
  }
});

test('ฟิกซ์เจอร์ 12 เวอร์ชัน: ค่ากลาง/lift ต่อการ์ดถูก · n<5 ไม่สรุป · ครูจากสมุด · ความยาว/วิธีเปิดครบทุกใบ', () => {
  const report = buildLiftReport({ posts: fixturePosts, generations: fixtureGenerations, pickHistory: fixturePicks, now: '2026-09-02T00:00:00.000Z' });

  assert.equal(report.page.posts, 15);
  assert.equal(report.page.median, 10000, 'ค่ากลางทั้งเพจ 15 โพสต์ = ตัวที่ 8 เมื่อเรียง');
  assert.equal(report.page.bigHitPct, 20, '3/15 โพสต์ ≥ 50k');
  assert.equal(report.input.versions, 12);
  assert.equal(report.input.generations, 12);
  assert.equal(report.matched.versions, 12);
  assert.equal(report.matched.posts, 12);
  assert.equal(report.matched.cases, 12);
  assert.equal(report.matched.median, 15000);
  assert.equal(report.matched.lift, 1.5);
  assert.deepEqual(report.window, { from: day(0), to: day(14), days: 14, padDays: 3 });

  const card = report.dimensions.card;
  assert.deepEqual(card.ranked.map((g) => [g.label, g.n, g.median, g.lift, g.bigHitPct]),
    [['การ์ด A', 6, 35000, 3.5, 33.3], ['การ์ด B', 5, 3000, 0.3, 0]]);
  assert.deepEqual(card.insufficient, [{ key: 'card-c', label: 'การ์ด C', n: 1, median: 100000 }]);
  assert.equal(card.groups.length, 3);
  assert.equal(card.groups.at(-1).insufficient, true, 'กลุ่ม n<5 อยู่ท้าย');
  assert.equal(card.ranked[0].key, 'card-a');
  assert.equal(card.ranked[0].cases, 6);
  assert.equal(card.ranked[0].liftMean, Math.round((40000 / report.page.mean) * 100) / 100);

  const teacher = report.dimensions.teacher;
  assert.deepEqual(teacher.ranked.map((g) => [g.key, g.label, g.n, g.median, g.lift]), [['T1', 'ครูหนึ่ง', 6, 35000, 3.5]]);
  assert.deepEqual(teacher.insufficient.map((g) => [g.key, g.n]), [['T2', 2]]);
  assert.equal(teacher.coverage, 6);
  assert.equal(teacher.pickRows, 7);
  assert.ok(!teacher.groups.some((g) => g.key === 'T7'), 'แถวสมุดที่ห่าง 20 วัน ต้องไม่ถูกนับ');

  const length = report.dimensions.length;
  const bandKeys = new Set(LENGTH_BANDS.map((b) => b.key));
  assert.equal(length.groups.reduce((s, g) => s + g.n, 0), 12);
  assert.ok(length.groups.every((g) => bandKeys.has(g.key)));
  assert.equal(length.records, 12);

  const opening = report.dimensions.opening;
  assert.equal(opening.groups.reduce((s, g) => s + g.n, 0), 12);
  const openingByPost = Object.fromEntries(report.links.map((l) => [l.postId, l.opening]));
  assert.equal(openingByPost.P9, 'ชื่อ+การกระทำ', 'คุณตา… = ชื่อ+การกระทำ');
  assert.equal(openingByPost.P1, 'ชื่อ+การกระทำ', 'ลุง… = ชื่อ+การกระทำ');

  assert.equal(report.links.length, 12);
  assert.equal(report.links[0].reactions, 100000, 'links เรียงจากไลก์มากไปน้อย');
  assert.deepEqual(report.links[0].teachers, []);
  assert.equal(report.links.find((l) => l.caseId === '00001').teachers.length, 2);
  assert.ok(report.links.every((l) => l.words > 0 && bandKeys.has(l.band) && typeof l.sim === 'number'));
  assert.ok(report.notes.some((n) => n.includes('การ์ด C n=1')), 'ต้องรายงานกลุ่ม n<5 ในหมายเหตุ');
  assert.ok(report.notes.some((n) => n.startsWith('ครู:') && n.includes('ครูสอง n=2')));
  assert.ok(['number', 'object'].includes(typeof report.correlation.lengthVsReactionsPage));
});

test('minN ปรับได้ · threshold ปรับได้ · window กรองโพสต์ทั้งเพจ', () => {
  const loose = buildLiftReport({ posts: fixturePosts, generations: fixtureGenerations, minN: 1 });
  assert.equal(loose.dimensions.card.insufficient.length, 0);
  assert.equal(loose.dimensions.card.ranked.length, 3);
  assert.equal(loose.dimensions.card.ranked[0].label, 'การ์ด C', 'lift ×10 ต้องขึ้นหัวเมื่อยอมรับ n=1');

  const strict = buildLiftReport({ posts: fixturePosts, generations: fixtureGenerations, threshold: 1.01 });
  assert.equal(strict.matched.versions, 0);
  assert.equal(strict.dimensions.card.records, 0);

  const windowed = buildLiftReport({ posts: fixturePosts, generations: fixtureGenerations, window: { from: day(5), to: day(9) } });
  assert.equal(windowed.page.posts, 5);
  assert.equal(windowed.matched.versions, 5);
  assert.equal(windowed.window.from, day(5));
});

test('ไม่มีสมุดครูในช่วง → มิติครูว่าง + หมายเหตุบอกชัด · ไม่มีโพสต์ → หมายเหตุ', () => {
  const r = buildLiftReport({ posts: fixturePosts, generations: fixtureGenerations, pickHistory: [] });
  assert.equal(r.dimensions.teacher.groups.length, 0);
  assert.equal(r.dimensions.teacher.coverage, 0);
  assert.ok(r.notes.some((n) => n.includes('viral_pick_history')));
  const empty = buildLiftReport({});
  assert.equal(empty.page.posts, 0);
  assert.equal(empty.matched.versions, 0);
  assert.equal(empty.window.from, null);
  assert.ok(empty.notes.some((n) => n.includes('ไม่มีโพสต์')));
});

test('renderLiftMarkdown: หัวรายงาน · ตารางการ์ด/ครู · กลุ่ม n<5 แยกชัด', () => {
  const report = buildLiftReport({ posts: fixturePosts, generations: fixtureGenerations, pickHistory: fixturePicks, now: '2026-09-02T00:00:00.000Z' });
  const md = renderLiftMarkdown(report);
  assert.match(md, /^# LIFT REPORT/);
  assert.match(md, /\| การ์ด A \| 6 \| 6 \| 35,000 \| 40,000 \| 33\.3% \| ×3\.50 \|/);
  assert.match(md, /\| การ์ด B \| 5 \| 5 \| 3,000 \|/);
  assert.match(md, /ยังสรุปไม่ได้ \(n < 5\)\*\*: การ์ด C \(n=1, ค่ากลาง 100,000\)/);
  assert.match(md, /\| ครูหนึ่ง \| 6 \|/);
  assert.match(md, /ครูสอง \(n=2/);
  assert.match(md, /## ความยาว/);
  assert.match(md, /## วิธีเปิดเรื่อง/);
  assert.match(md, /Spearman ความยาว↔ไลก์/);
  assert.doesNotMatch(md.split('## ครู')[1].split('## ความยาว')[0], /ครูหลง/);
  const emptyReport = buildLiftReport({});
  assert.equal(emptyReport.matched.lift, null, 'ไม่มีคู่เลย = lift null');
  const emptyMd = renderLiftMarkdown(emptyReport);
  assert.match(emptyMd, /ไม่มีข้อมูลในมิตินี้/);
  assert.ok(emptyMd.includes('lift — เทียบทั้งเพจ'), 'ต้องพิมพ์ — ไม่ใช่ ×0.00 เมื่อไม่มีคู่');
  assert.ok(!emptyMd.includes('×0.00'), 'ห้ามมี ×0.00 ที่ไหนเลยในรายงานว่าง');
});

// ─── ตัวอ่านแบ่งหน้า (sb ปลอม — บันทึกทุก query ไม่แตะเครือข่าย) ───

function fakeSb(handler) {
  const queries = [];
  return {
    queries,
    from(table) {
      const q = { table, ops: [] };
      const chain = {};
      for (const op of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in']) {
        chain[op] = (...args) => { q.ops.push([op, ...args]); return chain; };
      }
      chain.range = (from, to) => { q.ops.push(['range', from, to]); queries.push(q); return Promise.resolve(handler(q)); };
      return chain;
    },
  };
}
const opsOf = (q, name) => q.ops.filter((o) => o[0] === name);
const storeOf = (q) => opsOf(q, 'eq').find((o) => o[1] === 'store_name')?.[2];

test('pageAll: ดึงจนหน้าสั้นกว่า pageSize · error หน้าไหน = throw · เกิน maxPages = truncated', async () => {
  const pages = [Array(3).fill({ x: 1 }), Array(3).fill({ x: 2 }), [{ x: 3 }]];
  const r = await pageAll((from) => ({ data: pages[from / 3] || [] }), { pageSize: 3 });
  assert.equal(r.rows.length, 7);
  assert.equal(r.truncated, false);
  await assert.rejects(pageAll(() => ({ error: { message: 'boom' } }), { label: 'gen' }), /gen: boom/);
  const t = await pageAll(() => ({ data: [1, 2] }), { pageSize: 2, maxPages: 2 });
  assert.deepEqual([t.rows.length, t.truncated], [4, true]);
});

test('padWindow ±3 วัน', () => {
  assert.deepEqual(padWindow({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T00:00:00.000Z' }),
    { from: '2026-06-28T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' });
  assert.equal(padWindow(null), null);
});

test('loadLiftInputs: เคส/สมุดครูอ่านช่วง ±3 วัน · แบ่งหน้าจนหมด · โพสต์กรองด้วยหน้าต่าง', async () => {
  const genRows = (n, offset) => Array.from({ length: n }, (_, i) => ({
    case_id: String(offset + i), created_at: '2026-07-10T00:00:00.000Z', news_title: 't', versions: [], promptName: 'x', promptId: 'x',
  }));
  const sb = fakeSb((q) => {
    if (q.table === 'store_items' && storeOf(q) === 'post-metrics') {
      return { data: fixturePosts.map((p) => ({ data: p })) };
    }
    if (q.table === 'generation_logs') {
      const [, from] = opsOf(q, 'range')[0];
      return { data: from === 0 ? genRows(500, 0) : genRows(3, 500) };
    }
    if (q.table === 'store_items' && storeOf(q) === 'viral_pick_history') return { data: [{ data: { ts: 't', newsTitle: 't', picks: [{ id: 'T1' }] } }] };
    throw new Error('unexpected query ' + JSON.stringify(q));
  });
  const window = { from: day(5), to: day(9) };
  const out = await loadLiftInputs(sb, { window });
  assert.equal(out.posts.length, 5, 'โพสต์นอกหน้าต่างถูกกรอง');
  assert.equal(out.generations.length, 503, 'อ่านครบ 2 หน้า (500 + 3)');
  assert.equal(out.pickHistory.length, 1);
  assert.deepEqual(out.generationWindow, padWindow(window, 3));
  assert.deepEqual(out.truncated, { posts: false, generations: false, pickHistory: false });

  const postQ = sb.queries.find((q) => storeOf(q) === 'post-metrics');
  assert.deepEqual(opsOf(postQ, 'gte'), [['gte', 'data->>publishedAt', window.from]]);
  assert.deepEqual(opsOf(postQ, 'lte'), [['lte', 'data->>publishedAt', window.to]]);

  const genQs = sb.queries.filter((q) => q.table === 'generation_logs');
  assert.equal(genQs.length, 2);
  assert.deepEqual(opsOf(genQs[0], 'gte'), [['gte', 'created_at', '2026-07-03T03:00:00.000Z']]);
  assert.deepEqual(opsOf(genQs[0], 'lte'), [['lte', 'created_at', '2026-07-13T03:00:00.000Z']]);
  assert.deepEqual(opsOf(genQs[0], 'range')[0], ['range', 0, 499]);
  assert.deepEqual(opsOf(genQs[1], 'range')[0], ['range', 500, 999]);
  assert.match(opsOf(genQs[0], 'select')[0][1], /versions/);

  const pickQ = sb.queries.find((q) => storeOf(q) === 'viral_pick_history');
  assert.deepEqual(opsOf(pickQ, 'gte'), [['gte', 'created_at', '2026-07-03T03:00:00.000Z']]);
  // ★ ผู้ตรวจ 2 ก.ย.: แถวนำเข้ารอบเดียว created_at เท่ากันหมด → ทุกตัวอ่านที่ใช้ range ต้องมีคีย์เรียงสำรองที่ไม่ซ้ำ ไม่งั้นหน้าซ้ำ/หล่นแถวเงียบๆ
  assert.deepEqual(opsOf(postQ, 'order'), [['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: true }]], 'post-metrics: created_at แล้ว id');
  assert.deepEqual(opsOf(genQs[0], 'order'), [['order', 'created_at', { ascending: true }], ['order', 'case_id', { ascending: true }]], 'generation_logs: created_at แล้ว case_id (UNIQUE)');
  assert.deepEqual(opsOf(pickQ, 'order'), [['order', 'created_at', { ascending: true }], ['order', 'id', { ascending: true }]], 'viral_pick_history: created_at แล้ว id');

  // ไม่ส่ง window: ใช้ช่วงจากโพสต์เอง แล้วยังขยาย ±3 วันให้เคส
  const sb2 = fakeSb((q) => (storeOf(q) === 'post-metrics' ? { data: fixturePosts.map((p) => ({ data: p })) } : { data: [] }));
  const out2 = await loadLiftInputs(sb2, {});
  assert.deepEqual(out2.window, { from: day(0), to: day(14) });
  assert.equal(out2.generationWindow.from, '2026-06-28T03:00:00.000Z');
  // error ระหว่างทาง = โยนทั้งก้อน ไม่คืนรายงานครึ่งเดียว
  const sb3 = fakeSb((q) => (q.table === 'generation_logs' ? { error: { message: 'db down' } } : { data: [] }));
  await assert.rejects(loadLiftInputs(sb3, { window }), /generation_logs: db down/);
  await assert.rejects(loadLiftInputs(null, {}), /ไม่มี Supabase/);
});

test('runLiftReport: days → หน้าต่างย้อนหลังจาก now · คืน report+markdown · posts ส่งเองได้', async () => {
  const now = '2026-07-16T03:00:00.000Z';
  const sb = fakeSb((q) => {
    if (storeOf(q) === 'post-metrics') return { data: fixturePosts.map((p) => ({ data: p })) };
    if (q.table === 'generation_logs') return { data: fixtureGenerations };
    return { data: fixturePicks.map((p) => ({ data: p })) };
  });
  const { report, markdown } = await runLiftReport({ sb, days: 10, now });
  assert.equal(report.window.from, '2026-07-06T03:00:00.000Z');
  assert.equal(report.window.to, now);
  assert.equal(report.window.requestedDays, 10);
  assert.equal(report.window.generationFrom, '2026-07-03T03:00:00.000Z');
  assert.equal(report.page.posts, 10, 'โพสต์ 6-15 อยู่ในหน้าต่าง 10 วัน');
  assert.equal(report.matched.versions, 7, 'เคส 6-12 จับคู่ได้ (โพสต์ 1-5 อยู่นอกหน้าต่าง)');
  assert.match(markdown, /^# LIFT REPORT/);
  assert.equal(report.dimensions.teacher.ranked.length, 0, 'ครู T1 เหลือ n=1 ในหน้าต่างนี้ = ยังสรุปไม่ได้');

  const preset = await runLiftReport({ sb, posts: fixturePosts, now });
  assert.equal(preset.report.page.posts, 15);
  assert.equal(sb.queries.filter((q) => storeOf(q) === 'post-metrics').length, 1, 'ส่ง posts เอง = ไม่อ่าน store');
});

test('readStoreRows (สคริปต์นำเข้า): แบ่งหน้าจนหมด · เรียง created_at แล้ว id (คีย์สำรองไม่ซ้ำ) · error = throw (ผู้ตรวจ 2 ก.ย.)', async () => {
  const sb = fakeSb((q) => {
    const [, from] = opsOf(q, 'range')[0];
    const n = from === 0 ? 1000 : 2;
    return { data: Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, data: { postId: `p${from + i}` } })) };
  });
  const rows = await readStoreRows(sb, 'post-metrics');
  assert.equal(rows.size, 1002, 'อ่านครบ 2 หน้า (1000 + 2)');
  assert.deepEqual(rows.get('p1001'), { postId: 'p1001' });
  assert.equal(sb.queries.length, 2);
  for (const q of sb.queries) {
    assert.equal(q.table, 'store_items');
    assert.equal(storeOf(q), 'post-metrics');
    assert.deepEqual(opsOf(q, 'order'), [['order', 'created_at', { ascending: true }], ['order', 'id', { ascending: true }]]);
  }
  assert.deepEqual(opsOf(sb.queries[1], 'range')[0], ['range', 1000, 1999]);
  await assert.rejects(readStoreRows(fakeSb(() => ({ error: { message: 'nope' } })), 'post-metrics'), /post-metrics.*nope/);
});

test('ไฟล์ผลลัพธ์ + สำเนา store ในเครื่อง ต้องอยู่ใต้ _planD/ ที่ .gitignore กัน (/_*) — ไม่ใช่ docs/ หรือ data/ ที่ tracked (ผู้ตรวจ 2 ก.ย.)', () => {
  const relOut = path.relative(ROOT, DEFAULT_OUT_DIR).split(path.sep);
  assert.equal(relOut[0], '_planD', `--out ค่าเริ่มต้นต้องอยู่ใต้ _planD/ (ได้ ${relOut.join('/')})`);
  assert.equal(path.relative(ROOT, path.join(ROOT, LOCAL_DIR)).split(path.sep)[0], '_planD');
  const relStore = path.relative(ROOT, localStorePath('post-metrics')).split(path.sep);
  assert.equal(relStore[0], '_planD');
  assert.equal(relStore.at(-1), 'post-metrics.json');
  const ignoreRules = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(NL).map((l) => l.trim());
  assert.ok(ignoreRules.includes('/_*'), '.gitignore ต้องมีแพตเทิร์น /_* — ไม่งั้นข้อสอบนี้ไม่คุ้มครองอะไร');
  // --out ปรับได้ · สมุดครูในโหมดไฟล์ยังอ่านจาก data/ (รูป persistStore) ผ่านพารามิเตอร์ dir
  assert.equal(parseLiftArgs(['--out', 'x']).out, path.resolve('x'));
  assert.equal(parseLiftArgs([]).out, DEFAULT_OUT_DIR);
  assert.equal(localStorePath('viral_pick_history', ROOT, 'data'), path.join(ROOT, 'data', 'viral_pick_history.json'));
});

test('buildFromLocalFiles (โหมดไฟล์ ไม่มี Supabase): โพสต์จาก _planD/lift/<store>.json · เคสจาก data/generation-logs.json · สมุดครูจาก data/viral_pick_history.json', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lift-local-'));
  try {
    mkdirSync(path.join(root, LOCAL_DIR), { recursive: true });
    mkdirSync(path.join(root, 'data'), { recursive: true });
    writeFileSync(path.join(root, LOCAL_DIR, 'post-metrics.json'), JSON.stringify(fixturePosts.map((p) => ({ ...p, id: p.postId }))));
    writeFileSync(path.join(root, 'data', 'generation-logs.json'), JSON.stringify(fixtureGenerations));
    writeFileSync(path.join(root, 'data', 'viral_pick_history.json'), JSON.stringify(fixturePicks.map((p, i) => ({ ...p, id: `h${i}` }))));
    const { report, markdown } = buildFromLocalFiles(parseLiftArgs([]), root);
    assert.equal(report.page.posts, 15);
    assert.equal(report.matched.versions, 12);
    assert.equal(report.dimensions.teacher.coverage, 6, 'สมุดครูต้องอ่านจาก data/ (รูป persistStore) ไม่ใช่ _planD/lift/');
    assert.ok(report.notes.some((n) => n.includes(path.join(LOCAL_DIR, 'post-metrics.json'))), 'หมายเหตุต้องบอกที่มาไฟล์จริง');
    assert.match(markdown, /^# LIFT REPORT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── route GET /api/feedback/lift — โหลดโค้ดจริงแทน import/ฐานข้อมูลด้วยตัวปลอม (แบบเดียวกับ tests/queue-clear-guard.test.mjs) ───
const routeSrc = readFileSync(new URL('../src/app/api/feedback/lift/route.js', import.meta.url), 'utf8')
  .replace(/^import .*$/mg, '')
  .replace(/^export const .*$/mg, '')
  .replace('export async function GET', 'async function GET');

function loadRoute({ adminKey, botSecret, sb = {}, run, timeoutMs } = {}) {
  const NextResponse = { json: (body, init) => ({ body, status: init?.status || 200 }) };
  const calls = [];
  const runLiftReport = run || (async (opts) => { calls.push(opts); return { report: { page: { posts: 1 }, matched: {} }, markdown: '' }; });
  let code = routeSrc;
  if (timeoutMs) {
    assert.ok(code.includes('const LIFT_TIMEOUT_MS = 20000'), 'route ต้องมีเพดาน 20 วิ');
    code = code.replace('const LIFT_TIMEOUT_MS = 20000', `const LIFT_TIMEOUT_MS = ${timeoutMs}`);
  }
  const GET = new Function('NextResponse', 'getSupabase', 'runLiftReport', 'process', `${code}\nreturn GET;`)(
    NextResponse, () => sb, runLiftReport, { env: { ADMIN_API_KEY: adminKey, DISCORD_API_SECRET: botSecret } });
  return { GET, calls };
}
const req = (query = '', headers = {}) => ({
  url: `http://localhost/api/feedback/lift${query}`,
  headers: { get: (h) => headers[h.toLowerCase()] || '' },
});

test('route: ไม่มีกุญแจ → 403 ไม่คำนวณ · กุญแจผิด → 403 · ไม่ตั้ง env เลย → 403 เสมอ (fail-closed)', async () => {
  const { GET, calls } = loadRoute({ adminKey: 'K' });
  assert.equal((await GET(req('?days=30'))).status, 403);
  const wrong = await GET(req('?days=30', { 'x-admin-key': 'nope' }));
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.errorType, 'ADMIN_KEY_REQUIRED');
  assert.equal(calls.length, 0);
  const none = loadRoute({});
  assert.equal((await none.GET(req('', { 'x-admin-key': 'anything' }))).status, 403);
  assert.equal(none.calls.length, 0);
  // กุญแจทาง query string ต้องไม่ผ่าน
  assert.equal((await GET(req('?key=K'))).status, 403);
});

test('route: กุญแจถูก → 200 + JSON รายงาน · days ค่าเริ่มต้น 60 · เพดาน 365 · ค่าเพี้ยน = 60 · บอทใช้ x-bot-secret ได้', async () => {
  const { GET, calls } = loadRoute({ adminKey: 'K', botSecret: 'B' });
  const ok = await GET(req('?days=30', { 'x-admin-key': 'K' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.success, true);
  assert.equal(ok.body.days, 30);
  assert.deepEqual(ok.body.page, { posts: 1 });
  assert.equal(calls[0].days, 30);
  assert.equal(calls[0].threshold, undefined);
  await GET(req('', { 'x-admin-key': 'K' }));
  assert.equal(calls[1].days, 60);
  await GET(req('?days=9999&threshold=0.35', { 'x-admin-key': 'K' }));
  assert.equal(calls[2].days, 365);
  assert.equal(calls[2].threshold, 0.35);
  await GET(req('?days=abc&threshold=7', { 'x-admin-key': 'K' }));
  assert.equal(calls[3].days, 60);
  assert.equal(calls[3].threshold, undefined);
  const bot = await GET(req('?days=7', { 'x-bot-secret': 'B' }));
  assert.equal(bot.status, 200);
  assert.equal(calls[4].days, 7);
});

test('route: ไม่มี Supabase → 503 NO_DB · คำนวณล้ม → 500 LIFT_REPORT_ERROR · เกินเวลา → 504 LIFT_TIMEOUT', async () => {
  const noDb = loadRoute({ adminKey: 'K', sb: null });
  const r1 = await noDb.GET(req('', { 'x-admin-key': 'K' }));
  assert.deepEqual([r1.status, r1.body.errorType], [503, 'NO_DB']);

  const boom = loadRoute({ adminKey: 'K', run: async () => { throw new Error('db exploded'); } });
  const r2 = await boom.GET(req('', { 'x-admin-key': 'K' }));
  assert.deepEqual([r2.status, r2.body.errorType, r2.body.success], [500, 'LIFT_REPORT_ERROR', false]);
  assert.match(r2.body.error, /db exploded/);

  const slow = loadRoute({ adminKey: 'K', run: () => new Promise(() => {}), timeoutMs: 30 });
  const r3 = await slow.GET(req('', { 'x-admin-key': 'K' }));
  assert.deepEqual([r3.status, r3.body.errorType], [504, 'LIFT_TIMEOUT']);
});

test('route: กุญแจ/ค่า env มีช่องว่าง-ขึ้นบรรทัดท้าย ต้องผ่าน (trim ทั้งคู่ — บทเรียน /api/bot/tracking 2 ก.ย.) · env ว่างล้วนหลัง trim = ยังไม่ตั้ง = 403', async () => {
  const { GET, calls } = loadRoute({ adminKey: 'K' + NL, botSecret: ' B ' + CRLF });
  assert.equal((await GET(req('?days=3', { 'x-admin-key': 'K' }))).status, 200, 'env มีขึ้นบรรทัดท้าย');
  assert.equal((await GET(req('?days=3', { 'x-admin-key': 'K' + NL }))).status, 200, 'header มีขึ้นบรรทัดท้าย');
  assert.equal((await GET(req('?days=3', { 'x-bot-secret': 'B' }))).status, 200, 'บอท: env มีช่องว่าง+CRLF ท้าย');
  assert.equal((await GET(req('?days=3', { 'x-bot-secret': ' B' + NL }))).status, 200);
  assert.equal(calls.length, 4);
  assert.equal((await GET(req('?days=3', { 'x-admin-key': 'K x' }))).status, 403, 'trim ไม่ใช่ตัดช่องว่างกลาง');
  const blank = loadRoute({ adminKey: '  ' + NL, botSecret: NL });
  const r = await blank.GET(req('', { 'x-admin-key': '' }));
  assert.equal(r.status, 403, 'env ว่างล้วนหลัง trim = ยังไม่ตั้ง = ปฏิเสธ');
  assert.match(r.body.error, /ตั้ง ADMIN_API_KEY/, 'ข้อความต้องบอกว่ายังไม่ตั้ง ไม่ใช่ "รหัสผิด"');
  assert.equal(blank.calls.length, 0);
});
