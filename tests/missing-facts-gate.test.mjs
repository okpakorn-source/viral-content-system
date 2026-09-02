// 🧪 ข้อสอบด่านข้อเท็จจริงหาย L4.7 — MISSING_FACTS_GATE (2 ก.ย. 69 — จากเทสสนามจริงเคสศรราม V2 รอบ 1 ทำ "ห่วงเรื่องการขับรถ" หาย
//   ทั้งที่อยู่ในต้นฉบับ: ด่านเดิมเทียบร่างนักเขียนกับผลแก้ ไม่ได้เทียบต้นฉบับ)
//   ค่าเริ่มต้นเปิด · ปิดคืน MISSING_FACTS_GATE=0 (รับเฉพาะ '0' ตรงตัว) = ผลลัพธ์เหมือนเดิมทุกไบต์ · เตือนเท่านั้น ห้ามแก้เนื้อ
// missingFactsGate.js ไม่มี import → import ตรง · การต่อสายใน correctionPipeline ดึงซอร์สตั้งแต่ runCorrectionPipeline ถึงท้ายไฟล์ (แบบ tests/correction-fact-stability)
// รัน: node --test tests/missing-facts-gate.test.mjs
// 🔨 ผลการทุบโค้ดจริงในไฟล์ (2 ก.ย. 69 — ทุบทีละข้อ รันเทส แล้วคืนไฟล์ไบต์ต่อไบต์ · ฐานก่อนทุบ 13/13 เขียว):
//   1) ทุบ normalizeFactText: ถอดบรรทัดตัดตัวคั่นหลักพัน `.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')` → 🔴 แดง 5/13 (ตัวเลขหาย/พบ · clean path · main path · ครบทุกข้อเท็จจริง · mutation)
//   2) ทุบ extractDetails: ตัด 'ห่วง' ออกจาก DETAIL_VERBS → 🔴 แดง 2/13 (ประเด็นย่อย · เคสศรราม — V2 ไม่รายงานห่วงเรื่องการขับรถ)
//   3) ทุบ correctionPipeline: `if (process.env.MISSING_FACTS_GATE === '0') return null;` → `=== '1'` → 🔴 แดง 1/13 (สวิตช์ 0)
//   4) ทุบ correctionPipeline: `const _missingFacts = runMissingFactsGate(...)` ใน main path → `null` → 🔴 แดง 1/13 (main path)
//   คืนโค้ดแล้ว 13/13 เขียว · ข้อ 1 + ทุบแปลงเลขไทย มีสำเนา mutation อัตโนมัติอยู่ท้ายไฟล์นี้ด้วย
//   5) รอบแก้ผู้ตรวจไขว้: ทุบข้อความ warning ใน missingFactsDebug กลับเป็น "— ให้พนักงานตรวจก่อนโพสต์" → 🔴 แดง 1/13 (clean path: ต้องบอกว่า diagnostics เท่านั้น) · คืนโค้ดแล้ว 13/13 เขียว
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { extractSourceFacts, findMissingFacts, normalizeFactText, longestCommonRun } from '../src/lib/correction/missingFactsGate.js';
import { envOn } from '../src/lib/utils/envFlag.js';
import { guardedReplace, sortLongestFirst } from '../src/lib/correction/guardedReplace.js';
import { scrubHallucinatedPlaces } from '../src/lib/correction/placeScrub.js';

const GATE_SOURCE = readFileSync(new URL('../src/lib/correction/missingFactsGate.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── เคสจริง: ต้นฉบับศรราม + ผล V1/V2 รอบ 1 (C:\tmp\news-r233-run) — ฝังไว้ให้เทสรันได้ทุกเครื่อง · ถ้าไฟล์สนามยังอยู่จะเทียบกับของจริงด้วย ──
const SORNRAM_RAW = 'หนุ่ม ศรราม เทพพิทักษ์ เล่าความทรงจำถึง ชุมพร เทพพิทักษ์ หรือ “ป๋าเดียร์” ว่า ตอนที่ยังมีชีวิตอยู่ พ่อเลี้ยงดูเขาแบบลูกผู้ชายและเป็นเพื่อน พูดคุยกันตรง ๆ และใช้เวลาทำกิจกรรมร่วมกันตั้งแต่เด็ก ทั้งพาไปกองถ่าย พาไปเล่นน้ำ และพูดคุยเรื่องต่าง ๆ เมื่อศรรามมีปัญหาเรื่องเพื่อน การเรียน หรือทำผิด ป๋าเดียร์จะเลือกพูดคุยและอธิบายเหตุผล พร้อมสอนเรื่องสัมมาคารวะ ระเบียบวินัย และการตรงต่อเวลา จนศรรามบอกว่า “ป๋าเหมือนเพื่อนเรา” ป๋าเดียร์ยังสอนลูกผ่านเรื่องธรรมดาในชีวิตประจำวัน ทั้งพาไปซื้อเนื้อ ทำอาหารเช้าให้หลังเล่นกีฬา และเล่าเรื่องต่าง ๆ ระหว่างนั่งรถไปโรงเรียน แม้จะทำงานในวงการบันเทิงและมีเวลาอยู่กับลูกไม่มาก แต่ทั้งคู่ยังโทรหากันเป็นประจำ โดยป๋าเดียร์มักเป็นห่วงเรื่องการขับรถ และโทรถามตอนกลางคืนว่าศรรามถ่ายละครเสร็จหรือยัง ศรรามเคยรู้สึกว่าตัวเองได้พบแม่บ่อยกว่าพ่อ แต่ให้ความสำคัญกับเวลาที่ได้อยู่กับพ่อมากกว่าสิ่งของที่พ่อซื้อให้';
const SORNRAM_V1 = '"ป๋าเหมือนเพื่อนเรา" ประโยคสั้น ๆ ที่หนุ่ม ศรราม เทพพิทักษ์ ใช้เล่าถึง ชุมพร เทพพิทักษ์ หรือ "ป๋าเดียร์" พ่อที่จากไปแล้ว ตอนที่ยังมีชีวิตอยู่ พ่อเลี้ยงเขาแบบลูกผู้ชาย คุยกันตรง ๆ ไม่มีกำแพง พาไปกองถ่าย พาไปเล่นน้ำ และใช้เวลาทำอะไรด้วยกันตั้งแต่ยังเล็ก คำว่าพ่อกับคำว่าเพื่อนของศรราม มันเป็นคนเดียวกัน\n\nแต่คำว่าเพื่อนของป๋า ไม่ได้แปลว่าปล่อยผ่านทุกเรื่อง เวลาศรรามมีปัญหาเรื่องเพื่อน เรื่องเรียน หรือทำอะไรผิด ป๋าเดียร์ไม่ได้ดุ แต่เลือกนั่งคุยและอธิบายเหตุผลให้ฟัง สอนเรื่องสัมมาคารวะ ระเบียบวินัย และการตรงต่อเวลา บทเรียนหลายอย่างอยู่ในเรื่องธรรมดา ทั้งพาไปซื้อเนื้อ ทำอาหารเช้าให้กินหลังเล่นกีฬา และเล่าเรื่องต่าง ๆ ระหว่างนั่งรถไปโรงเรียน ช่วงเวลาที่อยู่ด้วยกันอาจไม่มาก เพราะพ่อทำงานในวงการบันเทิง แต่รายละเอียดเล็ก ๆ เหล่านี้ศรรามยังจำได้ไม่ลืม เมื่อไม่ได้อยู่ใกล้กัน ความห่วงใยก็เดินทางมาทางสายโทรศัพท์ ป๋ามักห่วงเรื่องขับรถ และโทรถามตอนกลางคืนว่าถ่ายละครเสร็จหรือยัง\n\nศรรามเคยรู้สึกว่าตัวเองได้พบแม่บ่อยกว่าพ่อ แต่สิ่งที่เขาเก็บไว้ในใจไม่ใช่ของที่พ่อซื้อให้ กลับเป็นเวลาธรรมดา ๆ ที่เคยได้อยู่ด้วยกัน';
const SORNRAM_V2 = 'ป๋าเดียร์ทำงานในวงการบันเทิง มีเวลาอยู่กับลูกไม่มาก แต่สายโทรศัพท์กลางดึกยังดังขึ้นเสมอ ปลายสายเป็นเสียงพ่อถามคำเดิม ว่าศรรามถ่ายละครเสร็จหรือยัง นี่คือเรื่องที่ หนุ่ม ศรราม เทพพิทักษ์ ย้อนเล่าถึง ชุมพร เทพพิทักษ์ พ่อที่จากไปแล้ว ผ่านความห่วงใยที่เดินทางมาถึงแม้ตัวจะอยู่ห่างกัน คำที่เขาสรุปความสัมพันธ์นี้ได้ชัดที่สุดคือ "ป๋าเหมือนเพื่อนเรา"\n\nแต่คำว่าเพื่อนของป๋า ไม่ได้แปลว่าปล่อยผ่านทุกเรื่อง เวลาศรรามมีปัญหาเรื่องเพื่อน เรื่องเรียน หรือทำอะไรผิด ป๋าเดียร์ไม่ได้เลือกดุ แต่นั่งคุยและอธิบายเหตุผลให้ฟัง พร้อมสอนเรื่องสัมมาคารวะ ระเบียบวินัย และการตรงต่อเวลา บทเรียนหลายอย่างซ่อนอยู่ในเรื่องธรรมดาที่สุด ทั้งการพาไปซื้อเนื้อ ทำอาหารเช้าให้กินหลังเล่นกีฬา และเรื่องเล่าต่าง ๆ ระหว่างนั่งรถไปโรงเรียน ช่วงเวลาที่อยู่ด้วยกันอาจไม่มาก แต่รายละเอียดเล็ก ๆ พวกนี้กลับจำได้ไม่ลืม ศรรามเคยรู้สึกว่าตัวเองได้พบแม่บ่อยกว่าพ่อ แต่สุดท้ายสิ่งที่ติดอยู่ในใจไม่ใช่ของที่พ่อซื้อให้ มันคือเวลาธรรมดาที่ทั้งคู่เคยมีให้กัน';

function fieldCase() {
  const inputPath = 'C:/tmp/news-r233-run/input.txt';
  const resultPath = 'C:/tmp/news-r233-run/result-run1.json';
  if (!existsSync(inputPath) || !existsSync(resultPath)) return null;
  try {
    const raw = readFileSync(inputPath, 'utf8');
    const versions = JSON.parse(readFileSync(resultPath, 'utf8')).body.analysisResult.versions;
    return { raw, v1: versions[0].content, v2: versions[1].content };
  } catch {
    return null;
  }
}

const SYNTH = 'นายสมชาย ใจดี อายุ 45 ปี ได้รับเงินชดเชย 209,678 บาท เมื่อวันที่ 10 ส.ค. 2569 หลังทำงานมา 8 เดือน ค่าแรงวันละ 16 บาท เวลา 19.00 น. เขาบอกว่า “ผมไม่เคยคิดว่าจะได้เงินก้อนนี้เลย” น.ส.กัญญา เพื่อนบ้าน ‘แดง’ เผยว่า มีปัญหาเรื่องที่ดิน ปี 2568 โทร 081-234-5678';

test('extractSourceFacts: ตัวเลขพร้อมหน่วย · วันที่ไทย/ปี · คำพูด ≥ 4 คำ · ชื่อหลังคำนำหน้า + ชื่อในเครื่องหมายคำพูดสั้น · ประเด็นย่อย "กริยา+เรื่อง…"', () => {
  const facts = extractSourceFacts(SYNTH);
  assert.deepEqual(facts.numbers.sort(), ['081-234-5678', '16 บาท', '19.00 น.', '209,678 บาท', '45 ปี', '8 เดือน'].sort());
  assert.deepEqual(facts.dates, ['10 ส.ค. 2569', 'ปี 2568']);
  assert.deepEqual(facts.quotes, ['ผมไม่เคยคิดว่าจะได้เงินก้อนนี้เลย']);
  assert.deepEqual(facts.names.sort(), ['กัญญา', 'สมชาย', 'แดง'].sort());
  assert.deepEqual(facts.details, ['มีปัญหาเรื่องที่ดิน']);
  assert.deepEqual(extractSourceFacts(''), { numbers: [], dates: [], quotes: [], names: [], details: [] });
  assert.deepEqual(extractSourceFacts(null), { numbers: [], dates: [], quotes: [], names: [], details: [] });
});

test('extractSourceFacts: คำสามัญที่ขึ้นต้นเหมือนคำนำหน้าไม่ถูกนับเป็นชื่อ · เลขในวันที่ไม่ถูกนับซ้ำเป็นตัวเลข · เลขลำดับหัวข้อไม่นับ', () => {
  const facts = extractSourceFacts('ตามที่ปรากฏ นายกเทศมนตรี พระราชทาน หมอนข้าง ป้ายบอกทาง ครูใหญ่ พี่ชาย คุณภาพ ตากลม นางฟ้า น้องสาว ลุงป้า\n1. ข้อแรก\n2) ข้อสอง วันที่ 10 ส.ค. 2569');
  assert.deepEqual(facts.names, []);
  assert.deepEqual(facts.dates, ['10 ส.ค. 2569']);
  assert.deepEqual(facts.numbers, []);
  const withNames = extractSourceFacts('นางสาวปวีณา และ หลวงพ่อคูณ กับ คุณวิภา ตามที่ระบุ');
  assert.deepEqual(withNames.names.sort(), ['คูณ', 'ปวีณา', 'วิภา'].sort());
});

test('findMissingFacts: ตัวเลขหาย/พบ (ตัวคั่นหลักพัน เลขไทย ช่องว่าง) · 16 ไม่นับว่าพบใน 2016 · เวลา 19:00 ↔ 19.00', () => {
  const missingNumber = findMissingFacts('ได้รับเงิน 209,678 บาท และ 16 บาท', 'ได้รับเงินก้อนใหญ่ และ 16 บาท');
  assert.deepEqual(missingNumber.missing, [{ type: 'number', text: '209,678 บาท' }]);
  assert.equal(missingNumber.checked, 2);
  assert.equal(missingNumber.coverage, 0.5);
  assert.deepEqual(findMissingFacts('ได้รับเงิน 209,678 บาท', 'ได้รับเงิน 209678 บาท').missing, []);
  assert.deepEqual(findMissingFacts('ได้รับเงิน 209678 บาท', 'ได้รับเงิน 209,678 บาท').missing, [], 'ผลใส่ตัวคั่นหลักพันทั้งที่ต้นฉบับไม่ใส่ ก็ต้องรู้จัก');
  assert.deepEqual(findMissingFacts('ปี 2569 16 ส.ค.', 'ปี 2569 16 ส.ค.').missing, [], 'เลขที่คั่นช่องว่างต้องไม่ถูกเชื่อมเป็น 256916');
  assert.deepEqual(findMissingFacts('ได้รับเงิน ๒๐๙,๖๗๘ บาท', 'ได้รับเงิน 209,678 บาท').missing, [], 'เลขไทย ↔ อารบิก');
  assert.deepEqual(findMissingFacts('ค่าแรง 16 บาท', 'ปี 2016 ค่าแรงเท่าเดิม').missing, [{ type: 'number', text: '16 บาท' }], '16 ที่ซ่อนใน 2016 ไม่ใช่ตัวเลขเดียวกัน');
  assert.deepEqual(findMissingFacts('ค่าแรง 16 บาท', 'ค่าแรง 16.5 บาท').missing, [{ type: 'number', text: '16 บาท' }], '16 กับ 16.5 คนละเลข');
  assert.deepEqual(findMissingFacts('เวลา 19.00 น.', 'ตอน 19:00 น.').missing, []);
  assert.deepEqual(findMissingFacts('โทร 081-234-5678', 'โทร 0812345678').missing, []);
});

test('findMissingFacts: วันที่ — ย่อ ↔ เต็ม · ตัดปี · ค.ศ. ↔ พ.ศ. · ปีอย่างเดียว · วันเดือนผิดถือว่าหาย', () => {
  assert.deepEqual(findMissingFacts('เมื่อวันที่ 10 ส.ค. 2569', 'ในวันที่ 10 สิงหาคม ที่ผ่านมา').missing, []);
  assert.deepEqual(findMissingFacts('เมื่อวันที่ 10 ส.ค. 2569', 'เมื่อ 10 สิงหาคม 2026').missing, []);
  assert.deepEqual(findMissingFacts('เมื่อวันที่ 10 ส.ค. 2569', 'ในวันที่ 11 ส.ค. 2569').missing, [{ type: 'date', text: '10 ส.ค. 2569' }]);
  assert.deepEqual(findMissingFacts('เมื่อวันที่ 10 ส.ค. 2569', 'ในเดือนกันยายน 2569').missing, [{ type: 'date', text: '10 ส.ค. 2569' }]);
  assert.deepEqual(findMissingFacts('ตั้งแต่ปี 2568', 'ตั้งแต่ 2568 เป็นต้นมา').missing, []);
  assert.deepEqual(findMissingFacts('ตั้งแต่ปี 2568', 'ตั้งแต่ปี 2567').missing, [{ type: 'date', text: 'ปี 2568' }]);
  assert.deepEqual(findMissingFacts('วันที่ 10/8/2569', 'วันที่ 10 ส.ค.').missing, []);
});

test('findMissingFacts: คำพูดพบเมื่ออักษรต่อเนื่อง ≥ 60% · ชื่อพบตรงตัว · ประเด็นย่อยตัด การ/ความ นำหน้าได้', () => {
  const quote = 'เขาบอกว่า “ผมไม่เคยคิดว่าจะได้เงินก้อนนี้เลย”';
  assert.deepEqual(findMissingFacts(quote, 'และบอกว่าไม่เคยคิดว่าจะได้เงินก้อนนี้').missing, [], 'paraphrase ที่เก็บแกนคำพูดไว้ ≥ 60%');
  assert.deepEqual(findMissingFacts(quote, 'เขาดีใจมากที่ได้เงิน').missing, [{ type: 'quote', text: 'ผมไม่เคยคิดว่าจะได้เงินก้อนนี้เลย' }]);
  assert.deepEqual(findMissingFacts(quote, 'บอกว่า ไม่เคยคิดว่า จะได้', { quoteCoverage: 0.9 }).missing, [{ type: 'quote', text: 'ผมไม่เคยคิดว่าจะได้เงินก้อนนี้เลย' }], 'opts.quoteCoverage บังคับเข้มขึ้นได้');
  assert.equal(longestCommonRun('abcdef', 'xxcdexx'), 3);
  assert.equal(longestCommonRun('', 'abc'), 0);
  assert.deepEqual(findMissingFacts('นายสมชาย ใจดี เล่าว่า', 'สมชายเล่าว่า').missing, []);
  assert.deepEqual(findMissingFacts('นายสมชาย ใจดี เล่าว่า', 'ชายวัยกลางคนเล่าว่า').missing, [{ type: 'name', text: 'สมชาย' }]);
  assert.deepEqual(findMissingFacts('เขาห่วงเรื่องการขับรถ', 'เขาห่วงเรื่องขับรถ').missing, []);
  assert.deepEqual(findMissingFacts('เขาห่วงเรื่องการขับรถ', 'เขาห่วงลูกมาก').missing, [{ type: 'detail', text: 'ห่วงเรื่องการขับรถ' }]);
});

test('findMissingFacts: ไม่เตือนเท็จเมื่อผล paraphrase คำทั่วไป (คงข้อเท็จจริงครบ)', () => {
  const para = 'สมชาย วัย 45 ปี รับเงิน 209678 บาท ในวันที่ 10 สิงหาคม ที่ผ่านมา หลังทำงาน 8 เดือน วันละ 16 บาท ตอน 19:00 น. และบอกว่าไม่เคยคิดว่าจะได้เงินก้อนนี้ กัญญา เพื่อนบ้าน แดง เผยว่าเขามีปัญหาเรื่องที่ดิน ตั้งแต่ปี 2568 โทร 0812345678';
  const report = findMissingFacts(SYNTH, para);
  assert.deepEqual(report.missing, []);
  assert.equal(report.checked, 13);
  assert.equal(report.coverage, 1);
  assert.deepEqual(findMissingFacts('', 'อะไรก็ได้'), { missing: [], checked: 0, coverage: 1, byType: { number: 0, date: 0, quote: 0, name: 0, detail: 0 } });
  const allMissing = findMissingFacts(SYNTH, '');
  assert.equal(allMissing.missing.length, 13);
  assert.equal(allMissing.coverage, 0);
  assert.equal(findMissingFacts(SYNTH, '', { maxMissing: 3 }).missing.length, 3);
  assert.equal(findMissingFacts(SYNTH, '', { maxMissing: 3 }).truncated, 10);
});

test('เคสศรราม: V2 รอบ 1 ต้องรายงาน "ห่วงเรื่องการขับรถ" หาย · V1 รอบ 1 ต้อง missing น้อยกว่า', () => {
  const field = fieldCase();
  if (field) {
    assert.equal(field.raw.trim(), SORNRAM_RAW, 'ต้นฉบับที่ฝังต้องตรงกับไฟล์สนามจริง');
    assert.equal(field.v2.trim(), SORNRAM_V2.trim(), 'ผล V2 ที่ฝังต้องตรงกับไฟล์สนามจริง');
    assert.equal(field.v1.trim(), SORNRAM_V1.trim(), 'ผล V1 ที่ฝังต้องตรงกับไฟล์สนามจริง');
  }
  const facts = extractSourceFacts(SORNRAM_RAW);
  assert.ok(facts.details.includes('ห่วงเรื่องการขับรถ'), 'ต้องดึงประเด็น "ห่วงเรื่องการขับรถ" จากต้นฉบับได้');
  assert.ok(facts.quotes.includes('ป๋าเหมือนเพื่อนเรา'));
  assert.ok(facts.names.includes('ป๋าเดียร์'));
  const v2 = findMissingFacts(SORNRAM_RAW, SORNRAM_V2);
  assert.ok(v2.missing.some(m => m.type === 'detail' && m.text.includes('ห่วงเรื่องการขับรถ')), `V2 ต้องรายงานว่า "ห่วงเรื่องการขับรถ" หาย ได้: ${JSON.stringify(v2.missing)}`);
  const v1 = findMissingFacts(SORNRAM_RAW, SORNRAM_V1);
  assert.ok(v1.missing.length < v2.missing.length, `V1 ต้องหายน้อยกว่า V2 (V1=${v1.missing.length}, V2=${v2.missing.length})`);
  assert.equal(v1.missing.length, 0, 'V1 เก็บ "ห่วงเรื่องขับรถ" ไว้ → ไม่มีอะไรหาย');
  assert.ok(v2.coverage < v1.coverage);
});

// ── การต่อสายใน correctionPipeline (สวิตช์ MISSING_FACTS_GATE) ──
const pipelineSource = readFileSync(new URL('../src/lib/correction/correctionPipeline.js', import.meta.url), 'utf8');
const pipelineStart = pipelineSource.indexOf('export async function runCorrectionPipeline');
assert.ok(pipelineStart >= 0, 'ต้องหา runCorrectionPipeline ใน source จริงได้');
const pipelineFunctionSource = pipelineSource.slice(pipelineStart).replace('export async function runCorrectionPipeline', 'async function runCorrectionPipeline');

function makePipeline(overrides = {}) {
  const defaults = {
    auditOutput: async (version) => ({
      auditScore: 80,
      issues: version.content.includes('ISSUE') ? [{ type: 'test_issue', severity: 'high', text: 'ISSUE' }] : [],
    }),
    safeCorrect: async (content) => ({ correctedContent: content.replace('ISSUE', 'FIXED'), rollbackContent: content, corrections: [{ type: 'test_fix', text: 'ISSUE' }] }),
    guardCoreNews: () => ({ ok: true, reason: null }),
    checkFactPreservation: () => ({ preserved: true, drifts: [], action: 'pass' }),
    editorialPolish: (content) => ({ polishedContent: `${content}|POLISHED`, changes: ['test-polish'] }),
    semanticSanityCheck: async (content) => ({ sanitizedContent: content, issuesFound: [], fixed: false }),
    fabricationGate: async (content) => ({ content, debug: { sus: 0, confirmed: 0, fixed: false } }),
    bbStep: () => {},
    findMissingFacts,
  };
  const deps = { ...defaults, ...overrides };
  return new Function(
    'auditOutput', 'safeCorrect', 'guardCoreNews', 'checkFactPreservation', 'editorialPolish', 'semanticSanityCheck', 'fabricationGate', 'bbStep',
    'envOn', 'guardedReplace', 'sortLongestFirst', 'scrubHallucinatedPlaces', 'findMissingFacts',
    `${pipelineFunctionSource}\nreturn runCorrectionPipeline;`,
  )(
    deps.auditOutput, deps.safeCorrect, deps.guardCoreNews, deps.checkFactPreservation, deps.editorialPolish, deps.semanticSanityCheck, deps.fabricationGate, deps.bbStep,
    envOn, guardedReplace, sortLongestFirst, scrubHallucinatedPlaces, deps.findMissingFacts,
  );
}

async function withEnv(values, run) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const RAW_SOURCE = 'นายสมชาย ใจดี ได้รับเงินชดเชย 209,678 บาท ค่าแรงวันละ 16 บาท เมื่อวันที่ 10 ส.ค. 2569 ' + 'ข้อมูลยืนยันตามต้นฉบับ '.repeat(3);
const CONTENT_MISSING_16 = 'สมชาย ได้รับเงินชดเชย 209,678 บาท เมื่อวันที่ 10 ส.ค. 2569 ' + 'เนื้อข่าวสำหรับทดสอบฉบับจริง '.repeat(6);
const CONTENT_COMPLETE = 'สมชาย ได้รับเงินชดเชย 209,678 บาท ค่าแรงวันละ 16 บาท เมื่อวันที่ 10 ส.ค. 2569 ' + 'เนื้อข่าวสำหรับทดสอบฉบับจริง '.repeat(6);

test('pipeline clean path: เตือนของหายลง _missingFacts + _correctionDebug.missingFacts + กล่องดำ โดยไม่แตะเนื้อ', async () => {
  const steps = [];
  const runPipeline = makePipeline({ bbStep: (_bb, layer, before, after, extra) => steps.push({ layer, changed: before !== after, extra }) });
  const [result] = await withEnv({ SKIP_CORRECTION: undefined, MISSING_FACTS_GATE: undefined },
    () => runPipeline([{ content: CONTENT_MISSING_16, style: 'clean' }], { newsBody: 'เนื้อที่ AI สกัด (ไม่ใช้เมื่อมีต้นฉบับดิบ)' }, {}, null, RAW_SOURCE));
  assert.equal(result.content, `${CONTENT_MISSING_16}|POLISHED`, 'ด่านเตือนเท่านั้น ห้ามแก้เนื้อ');
  assert.equal(result._correctionDebug.path, 'clean');
  assert.deepEqual(result._missingFacts.missing, [{ type: 'number', text: '16 บาท' }]);
  assert.equal(result._missingFacts.checked, 4);
  assert.equal(result._correctionDebug.missingFacts.missing, 1);
  assert.equal(result._correctionDebug.missingFacts.checked, 4);
  assert.match(result._correctionDebug.missingFacts.warning, /หาย 1\/4/u);
  // ★ ผู้ตรวจไขว้ 2 ก.ย. 69: _missingFacts ไม่เข้า pipelineQualityWarnings/UI → ข้อความต้องบอกตรงๆ ว่าเป็น diagnostics ห้ามอ้างว่าพนักงานจะได้ตรวจ
  assert.match(result._correctionDebug.missingFacts.warning, /diagnostics เท่านั้น/u, 'ต้องระบุว่าเป็น diagnostics (ยังไม่ถึงพนักงาน)');
  assert.doesNotMatch(result._correctionDebug.missingFacts.warning, /ให้พนักงานตรวจ/u, 'ห้ามอ้างว่าพนักงานจะเห็น — UI ยังไม่แสดง _missingFacts');
  assert.deepEqual(result._correctionDebug.missingFacts.items, [{ type: 'number', text: '16 บาท' }]);
  const gateStep = steps.find(s => s.layer === 'L4.7-ด่านข้อเท็จจริงหาย');
  assert.ok(gateStep, 'ต้องมีร่องรอยในกล่องดำ');
  assert.equal(gateStep.changed, false);
  assert.deepEqual(gateStep.extra.missing, [{ type: 'number', text: '16 บาท' }]);
});

test('pipeline main path (มี issue ให้แก้): ด่านทำงานหลัง FactCheck สุดท้าย และเทียบกับต้นฉบับดิบ', async () => {
  const steps = [];
  const runPipeline = makePipeline({ bbStep: (_bb, layer) => steps.push(layer) });
  const [result] = await withEnv({ SKIP_CORRECTION: undefined, MISSING_FACTS_GATE: undefined },
    () => runPipeline([{ content: `ISSUE ${CONTENT_MISSING_16}`, style: 'main' }], { newsBody: RAW_SOURCE }, {}));
  assert.equal(result.content, `FIXED ${CONTENT_MISSING_16}|POLISHED`);
  assert.equal(result._correctionDebug.path, 'corrected');
  assert.deepEqual(result._missingFacts.missing, [{ type: 'number', text: '16 บาท' }]);
  assert.equal(result._correctionDebug.missingFacts.missing, 1);
  assert.ok(steps.indexOf('L4.7-ด่านข้อเท็จจริงหาย') > steps.indexOf('L4-เช็คข้อเท็จจริง(final)'), 'ต้องอยู่หลัง FactCheck สุดท้าย');
});

test('pipeline: ครบทุกข้อเท็จจริง = _missingFacts ว่าง ไม่มีคำเตือนใน debug ไม่มีร่องรอยกล่องดำ · ไม่มีต้นฉบับ = skipped', async () => {
  const steps = [];
  const runPipeline = makePipeline({ bbStep: (_bb, layer) => steps.push(layer) });
  const [complete] = await withEnv({ SKIP_CORRECTION: undefined, MISSING_FACTS_GATE: undefined },
    () => runPipeline([{ content: CONTENT_COMPLETE, style: 'complete' }], {}, {}, null, RAW_SOURCE));
  assert.deepEqual(complete._missingFacts.missing, []);
  assert.equal(complete._missingFacts.checked, 4);
  assert.equal(complete._correctionDebug.missingFacts, undefined);
  assert.equal(steps.includes('L4.7-ด่านข้อเท็จจริงหาย'), false);
  const [noSource] = await withEnv({ SKIP_CORRECTION: undefined, MISSING_FACTS_GATE: undefined },
    () => runPipeline([{ content: CONTENT_MISSING_16, style: 'nosrc' }], {}, {}));
  assert.equal(noSource._missingFacts.skipped, 'no_source');
  assert.equal(noSource._correctionDebug.missingFacts, undefined);
});

test('สวิตช์ MISSING_FACTS_GATE=0: ผลลัพธ์เหมือนเดิมทุกฟิลด์ (ไม่มี _missingFacts / debug.missingFacts) · ค่าอื่นยังเปิด', async () => {
  const runPipeline = makePipeline();
  const run = (env) => withEnv({ SKIP_CORRECTION: undefined, ...env },
    () => runPipeline([{ content: CONTENT_MISSING_16, style: 'switch' }], {}, {}, null, RAW_SOURCE));
  const [on] = await run({ MISSING_FACTS_GATE: undefined });
  const [off] = await run({ MISSING_FACTS_GATE: '0' });
  assert.equal('_missingFacts' in off, false);
  assert.equal(off._correctionDebug.missingFacts, undefined);
  const { _missingFacts, ...onRest } = on;
  const { missingFacts, ...onDebug } = onRest._correctionDebug;
  assert.deepEqual(off, { ...onRest, _correctionDebug: onDebug }, 'ปิดสวิตช์ = ของเดิมทุกไบต์ ต่างแค่ไม่มีคีย์ของด่าน');
  assert.ok(_missingFacts && missingFacts);
  for (const value of ['off', 'false', '', '1']) {
    const [v] = await run({ MISSING_FACTS_GATE: value });
    assert.ok(v._missingFacts, `"${value}" ไม่ใช่คำสั่งปิด (รับเฉพาะ 0 ตรงตัว)`);
  }
});

test('pipeline: ด่านล้ม = fail-open (เนื้อเดิม · บันทึก error) ไม่ทำข่าวล้ม', async () => {
  const runPipeline = makePipeline({ findMissingFacts: () => { throw new Error('boom'); } });
  const [result] = await withEnv({ SKIP_CORRECTION: undefined, MISSING_FACTS_GATE: undefined },
    () => runPipeline([{ content: CONTENT_MISSING_16, style: 'boom' }], {}, {}, null, RAW_SOURCE));
  assert.equal(result.content, `${CONTENT_MISSING_16}|POLISHED`);
  assert.equal(result._missingFacts.error, 'boom');
  assert.equal(result._correctionError, undefined);
});

test('mutation: ทุบ normalize (ตัวคั่นหลักพัน / เลขไทย) แล้ว oracle ต้องแดง', async () => {
  const load = async (source, tag) => import(`data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${tag}.mjs`, 'utf8').toString('base64')}#${tag}-${Date.now()}`);
  const noThousands = GATE_SOURCE.replace(".replace(/(\\d),(?=\\d{3}(?!\\d))/g, '$1')\n", '');
  assert.notEqual(noThousands, GATE_SOURCE, 'ต้องพบบรรทัดตัดตัวคั่นหลักพันในซอร์สจริง');
  const mutantA = await load(noThousands, 'gate-no-thousands');
  assert.throws(() => assert.deepEqual(mutantA.findMissingFacts('ได้รับเงิน 209678 บาท', 'ได้รับเงิน 209,678 บาท').missing, []));
  const noThaiDigits = GATE_SOURCE.replace("return String(text ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));", "return String(text ?? '');");
  assert.notEqual(noThaiDigits, GATE_SOURCE, 'ต้องพบบรรทัดแปลงเลขไทยในซอร์สจริง');
  const mutantB = await load(noThaiDigits, 'gate-no-thai-digits');
  assert.throws(() => assert.deepEqual(mutantB.findMissingFacts('ได้รับเงิน 209,678 บาท', 'ได้รับเงิน ๒๐๙,๖๗๘ บาท').missing, []), 'ฝั่งผลเป็นเลขไทย: normalize ต้องแปลงให้ ไม่งั้นตีว่าหาย');
  assert.deepEqual(findMissingFacts('ได้รับเงิน 209,678 บาท', 'ได้รับเงิน 209678 บาท').missing, [], 'ของจริงต้องยังเขียว');
  assert.deepEqual(findMissingFacts('ได้รับเงิน 209678 บาท', 'ได้รับเงิน 209,678 บาท').missing, [], 'ของจริงต้องยังเขียว (กลับด้าน)');
  assert.deepEqual(findMissingFacts('ได้รับเงิน 209,678 บาท', 'ได้รับเงิน ๒๐๙,๖๗๘ บาท').missing, [], 'ของจริง: ผลเป็นเลขไทยก็ต้องพบ');
});
