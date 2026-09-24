// 🔏 ข้อสอบ L4.5 ล้างสถานที่หลอน — ฐานความจริงเนื้อดิบ + ตัดชื่อด้วยขอบคำ (PL-01) — src/lib/correction/placeScrub.js + correctionPipeline.js
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S3 · เจ้าของอนุมัติ)
//
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ L45_LEGACY: ค่าที่รับ · =1 → บล็อกเดิมในท่อทุกไบต์ (ทำซ้ำบั๊ก 4 เคสจากรายงาน + กล่องดำ 20 ส.ค. ได้) · ไม่ตั้ง → ฉบับใหม่ (ค่าเริ่มต้น)
//   B. ฐานความจริง (ก): raw ก่อน — ชื่อมีใน raw แต่ตัวสกัดตัดทิ้ง (ตำบลบ้านเป็ด · วัดป่าแสงอรุณ) คง · ไม่มี raw → newsBody · researchFacts ฐานเสริม · ไม่มีฐาน = ไม่แตะ
//   C. ขอบคำ (ข): 4 เคสรายงานไม่ถูกแตะ · ไข้หวัด/วัดผล/วัดความดัน/วัดด้วยกัน/ถนนเส้นเดียว ไม่ใช่สถานที่ · ชื่อจริงหลายโทเค็น/ราชาศัพท์ คง
//   D. ยังล้างของหลอน + ไม่มั่นใจ = ไม่แตะ (ค): จังหวัดสมมุติ/โรงพยาบาลสมมุติ/ซ.สมมุติ → คำแทนตามชนิด ตรงตำแหน่ง · ไม่ซ้อนบุพบท ·
//      ตัดชื่อที่คำหยุด (จังหวัดสมมุติมีเพื่อนบ้าน → ในพื้นที่มีเพื่อนบ้าน) · ยาวเกิน/สั้นเกิน/ไม่มี Intl.Segmenter = ไม่แตะ
//   E. ท่อจริง (runCorrectionPipeline ตัดจากซอร์ส + guardCoreNews/checkFactPreservation จริง): เส้น non-clean ทั้ง 2 โหมด · debug/กล่องดำ ·
//      สาย URL ไม่มี raw → ฐาน newsBody · fail-open เมื่อ scrub โยน error
//
// วิธีรัน:  node --test tests/place-scrub-raw-authority.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ ไม่แตะไฟล์ใน repo):
//   PLACE_SCRUB_TEST_MUTATION=greedy-run         ฉบับใหม่เลิกตัดชื่อที่คำหยุด (ชื่อ = ทั้งวลีแบบ regex เดิม)
//   PLACE_SCRUB_TEST_MUTATION=authority-newsbody  ฉบับใหม่กลับไปใช้ newsBody เป็นฐานทั้งที่มี raw (บั๊กข้อ ก กลับมา)
//   PLACE_SCRUB_TEST_MUTATION=no-boundary         เลิกเช็คขอบคำของคำนำหน้า (ไข้หวัด กลายเป็นสถานที่ชนิด "วัด")
//   PLACE_SCRUB_TEST_MUTATION=no-legacy-switch    ท่อไม่สนสวิตช์ถอย (L45_LEGACY=1 ไม่ได้ของเดิม)
//   PLACE_SCRUB_TEST_MUTATION=pipeline-no-raw     ท่อส่ง newsBody แทน rawSourceText ให้ด่าน (สายไฟข้อ ก ขาด)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { replaceRiskWordIssue } from '../src/lib/ai/safetyFilter.js';
import { isRiskWordsLegacy } from '../src/lib/ai/riskWords.js';
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S4 · เจ้าของอนุมัติ): rollback scrub ของท่อเรียก scrubRollbackContent/isCorrRollbackLegacy (./rollbackScrub.js) — ฉีดของจริง
//   (ข้อสอบนี้ safeCorrect คืนเนื้อเดิม → ไม่มี rollback ขั้นแรก → scrub ไม่ทำงาน · ฉีดไว้กัน ReferenceError เงียบถ้าเส้นทางเปลี่ยน)
import { scrubRollbackContent, isCorrRollbackLegacy } from '../src/lib/correction/rollbackScrub.js';

const MUTATION = process.env.PLACE_SCRUB_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['greedy-run', 'authority-newsbody', 'no-boundary', 'no-legacy-switch', 'pipeline-no-raw'];
if (MUTATION && !KNOWN_MUTATIONS.includes(MUTATION)) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};
const withEnv = async (name, value, fn) => {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return await fn(); } finally { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; }
};
const legacy = (fn) => withEnv('L45_LEGACY', '1', fn);
const fresh = (fn) => withEnv('L45_LEGACY', undefined, fn);
const quiet = async (fn) => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; }
};
const noLog = { log: () => {} };

// ── โหลดซอร์สจริง (placeScrub ไม่มี import · safeCorrectionService stub เฉพาะ AI/modelConfig/flagFixer เพื่อเอา guardCoreNews จริง) ──
let scrubSource = readSrc('../src/lib/correction/placeScrub.js');
let pipelineSource = readSrc('../src/lib/correction/correctionPipeline.js');
let correctSource = readSrc('../src/lib/correction/safeCorrectionService.js');
correctSource = mustReplace(correctSource, "import { callAI } from '@/lib/ai/openai';", "const callAI = async () => { throw new Error('AI-mock (ไม่ควรเรียก)'); };", 'correct stub openai');
correctSource = mustReplace(correctSource, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock';", 'correct stub modelConfig');
correctSource = mustReplace(correctSource, "import { keyNumbersOf, hasKeyNumber } from './flagFixerService';",
  'const keyNumbersOf = () => []; const hasKeyNumber = () => true;', 'correct stub flagFixer');

if (MUTATION === 'greedy-run') {
  scrubSource = mustReplace(scrubSource, 'const stopAt = tokens.findIndex((t) => STOP_WORDS.has(t.text));', 'const stopAt = -1;', 'greedy-run');
} else if (MUTATION === 'authority-newsbody') {
  scrubSource = mustReplace(scrubSource,
    "if (raw) { sources.push(stripSpaces(raw)); authority = 'raw'; }\n  else if (body) { sources.push(stripSpaces(body)); authority = 'newsBody'; }",
    "if (body) { sources.push(stripSpaces(body)); authority = 'newsBody'; }\n  else if (raw) { sources.push(stripSpaces(raw)); authority = 'raw'; }", 'authority-newsbody');
} else if (MUTATION === 'no-boundary') {
  scrubSource = mustReplace(scrubSource, 'if (!boundaries.has(pStart)) {', 'if (false) {', 'no-boundary start');
  scrubSource = mustReplace(scrubSource, 'if (!ABBREVIATIONS.has(prefix) && !boundaries.has(pEnd)) continue;', '/* mutated */', 'no-boundary end');
} else if (MUTATION === 'no-legacy-switch') {
  pipelineSource = mustReplace(pipelineSource, 'if (isL45Legacy()) {', 'if (false) {', 'no-legacy-switch');
} else if (MUTATION === 'pipeline-no-raw') {
  pipelineSource = mustReplace(pipelineSource, 'scrubHallucinatedPlaces(safeContent, { rawSourceText, newsBody: newsData?.newsBody, researchFacts })',
    'scrubHallucinatedPlaces(safeContent, { rawSourceText: null, newsBody: newsData?.newsBody, researchFacts })', 'pipeline-no-raw');
}

const ps = await importPatchedModule(scrubSource, srcUrl('../src/lib/correction/placeScrub.js'), 'placeScrub-under-test');
const { guardCoreNews } = await importPatchedModule(correctSource, srcUrl('../src/lib/correction/safeCorrectionService.js'), 'safeCorrection-for-guard');
const factSource = readSrc('../src/lib/correction/factPreservationCheck.js');
const checkFactPreservation = new Function(`${factSource.replace('export function checkFactPreservation', 'function checkFactPreservation')}\nreturn checkFactPreservation;`)();
const scrub = (content, sources, opts = {}) => ps.scrubHallucinatedPlaces(content, sources, { ...noLog, ...opts });

// ── ท่อ correction จริง (ตัดฟังก์ชันจากซอร์สแบบเดียวกับ tests/correction-fact-stability) · ด่าน AI อื่นเป็น stub ผ่านตรง · L2 บังคับเส้น non-clean ──
function buildPipeline({ scrubFn = ps.scrubHallucinatedPlaces, legacySwitch = ps.isL45Legacy } = {}) {
  const start = pipelineSource.indexOf('export async function runCorrectionPipeline');
  assert.ok(start >= 0, 'ต้องหา runCorrectionPipeline ในซอร์สจริงได้');
  return new Function(
    'auditOutput', 'safeCorrect', 'guardCoreNews', 'checkFactPreservation', 'editorialPolish', 'semanticSanityCheck', 'fabricationGate', 'bbStep',
    'isRiskWordsLegacy', 'replaceRiskWordIssue', 'isL45Legacy', 'scrubHallucinatedPlaces', 'isCorrRollbackLegacy', 'scrubRollbackContent',
    `${pipelineSource.slice(start).replace('export async function runCorrectionPipeline', 'async function runCorrectionPipeline')}\nreturn runCorrectionPipeline;`,
  )(
    async () => ({ auditScore: 70, issues: [{ type: 'engagement_bait', severity: 'medium', text: 'เร่งด่วน' }] }), // issue ≥1 = เส้น non-clean ที่มี L4.5
    async (content) => ({ correctedContent: content, rollbackContent: content, corrections: [] }),
    guardCoreNews, checkFactPreservation,
    (content) => ({ polishedContent: content, changes: [] }),
    async (content) => ({ sanitizedContent: content, issuesFound: [], fixed: false }),
    async (content) => ({ content, debug: { sus: 0, confirmed: 0, fixed: false } }),
    (arr, layer, before, after, extra = {}) => arr.push({ layer, changed: before !== after, ...extra }),
    isRiskWordsLegacy, replaceRiskWordIssue, legacySwitch, scrubFn, isCorrRollbackLegacy, scrubRollbackContent, // ★ S4: ฉีดของจริง
  );
}
const pipeline = buildPipeline();
const runPipeline = (content, { newsBody = null, raw = null, research = null } = {}, run = pipeline) =>
  quiet(() => withEnv('SKIP_CORRECTION', undefined, async () => (await run([{ content, style: 's3' }], { newsBody }, {}, research, raw))[0]));
const bbL45 = (result) => result._blackbox.find((b) => b.layer === 'L4.5-ล้างสถานที่หลอน');

// ── ตัวอย่างข่าวน้ำท่วม (ตามรายงาน PL-01): เนื้อดิบ → เนื้อสกัด (ตัดชื่อบางตัว/เรียบเรียงใหม่) → ฉบับนักเขียน ──
const RAW = 'น้ำท่วมหนักที่ จ.ขอนแก่น บ้านของนางสมศรี วัย 62 ปี ที่ ต.บ้านเป็ด อ.เมือง จมอยู่ใต้น้ำกว่า 1 เมตร ลูกชายเล่าว่าทุกเดือนจะพาแม่ไปวัดความดันที่โรงพยาบาลขอนแก่น '
  + 'แต่วันนี้ต้องพายเรือออกมา เพื่อนบ้านราว 20 คนช่วยกันขนของขึ้นที่สูง ถนนมิตรภาพช่วงหน้าหมู่บ้านเป็นถนนสายเดียวที่น้ำยังไม่ท่วม ทุกคนไปพักที่วัดป่าแสงอรุณ ช่วยกันทำอาหาร '
  + 'งานเงียบๆ ในวัดเหล่านั้นไม่ใช่การลงโทษ แต่เป็นสิ่งที่ทุกคนตั้งใจทำ';
const NEWS_BODY = 'น้ำท่วมหนักที่ขอนแก่น บ้านของนางสมศรี วัย 62 ปี จมอยู่ใต้น้ำกว่า 1 เมตร ลูกชายพาแม่ไปตรวจความดันโลหิตที่โรงพยาบาลเป็นประจำ เพื่อนบ้านราว 20 คนช่วยกันขนของ '
  + 'มีถนนสายเดียวที่น้ำยังไม่ท่วม ทุกคนไปพักที่วัดและช่วยกันทำอาหาร';
const WRITER = 'เช้าวันนั้นทั้งหมู่บ้านเงียบผิดปกติ เสียงเดียวที่ได้ยินคือเสียงน้ำไหลผ่านใต้ถุนบ้านทีละหลัง หลายครอบครัวตื่นมาพบว่าข้าวของชั้นล่างลอยไปกับน้ำหมดแล้ว\n\n'
  + 'นางสมศรี วัย 62 ปี นั่งมองบ้านของตัวเองที่ตำบลบ้านเป็ดจมอยู่ใต้น้ำกว่า 1 เมตร โดยไม่พูดอะไร\n\n'
  + 'ที่จังหวัดขอนแก่นมีเพื่อนบ้านกว่า 20 คนมาช่วยกันขนของขึ้นที่สูง ทุกคนยืนอยู่ด้วยกันบนถนนเส้นเดียวที่น้ำยังไม่ท่วม ลูกชายเล่าว่าปกติจะพาแม่ไปวัดความดันที่โรงพยาบาลทุกเดือน แต่วันนี้ต้องพายเรือออกมาแทน\n\n'
  + 'คืนนั้นทุกคนไปพักที่วัดป่าแสงอรุณ ช่วยกันหุงข้าวและต้มน้ำ งานเงียบๆ ในวัดเหล่านั้นไม่ใช่การลงโทษ แต่เป็นสิ่งที่ทุกคนตั้งใจทำเพื่อกันและกัน '
  + 'มีเพียงข่าวลือว่าน้ำจะมาถึงจังหวัดสมมุติ ในอีกสองวัน ที่ทำให้หลายคนยังนอนไม่หลับ\n\n'
  + 'ไม่มีใครรู้ว่าน้ำจะลดเมื่อไหร่ แต่ทุกคนรู้ว่าตราบใดที่ยังมีข้าวหม้อเดียวกันให้แบ่ง คืนนี้ก็ยังพอผ่านไปได้';
const EXPECTED_DEFAULT = WRITER.replace('ถึงจังหวัดสมมุติ ใน', 'ถึงในพื้นที่ ใน'); // ล้างเฉพาะชื่อหลอนตรงตำแหน่ง — ที่เหลือคงทุกไบต์

// ═══ A) สวิตช์ถอย ═══
test('A1 ค่าสวิตช์ L45_LEGACY: 1/true/on/yes/legacy (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ถอย · ไม่ตั้ง/0/off/false/ค่าอื่น = ฉบับใหม่', async () => {
  for (const v of ['1', 'true', 'on', 'yes', 'legacy', ' 1 ', '"1"', 'TRUE', 'Legacy']) {
    await withEnv('L45_LEGACY', v, () => assert.equal(ps.isL45Legacy(), true, `ต้องถอย: ${JSON.stringify(v)}`));
  }
  for (const v of [undefined, '', '0', 'off', 'false', 'no', 'new', '2']) {
    await withEnv('L45_LEGACY', v, () => assert.equal(ps.isL45Legacy(), false, `ต้องใหม่: ${JSON.stringify(v)}`));
  }
});

test('A2 โหมดถอย L45_LEGACY=1 = บล็อกเดิมทุกไบต์: ทำซ้ำบั๊กรายงาน (regex โลภตัดทั้งวลี · เทียบกับเนื้อสกัด · บุพบทซ้อน) และผ่านทุกด่านหลังจากนั้น', async () => {
  const result = await legacy(() => runPipeline(WRITER, { newsBody: NEWS_BODY, raw: RAW }));
  const out = result.content;
  assert.ok(out.includes('ที่ในพื้นที่ 20 คนมาช่วย'), 'รายงาน: "จังหวัดขอนแก่นมีเพื่อนบ้านกว่า" → "ในพื้นที่" (ชื่อจริงหาย)');
  assert.ok(out.includes('ด้วยกันบนบนถนน ลูกชาย'), 'รายงาน: "ถนนเส้นเดียวที่น้ำยังไม่ท่วม" → "บนถนน" (บุพบทซ้อน + ใจความหาย)');
  assert.ok(out.includes('พาแม่ไปวัด แต่วันนี้'), 'รายงาน: "วัดความดันที่โรงพยาบาลทุกเดือน" → "วัด" (กริยา "วัด" ถูกนับเป็นสถานที่)');
  assert.ok(out.includes('ในวัด แต่เป็นสิ่งที่'), 'กล่องดำ 20 ส.ค.: "วัดเหล่านั้นไม่ใช่การลงโทษ" → "วัด" (ใจความปฏิเสธหาย)');
  assert.ok(out.includes('ไปพักที่วัด ช่วยกันหุงข้าว'), 'ข้อ ก: "วัดป่าแสงอรุณ" มีในเนื้อดิบแต่ตัวสกัดตัดทิ้ง → โดนล้าง');
  assert.ok(out.includes('ตัวเองที่ในพื้นที่ 1 เมตร'), 'ข้อ ก: "ตำบลบ้านเป็ดจมอยู่ใต้น้ำกว่า" → "ในพื้นที่" (ชื่อจริงใน raw + เนื้อจริงหาย)');
  assert.ok(out.includes('มาถึงในพื้นที่ ในอีกสองวัน'), 'ของหลอน "จังหวัดสมมุติ" → "ในพื้นที่" (ของหลอนจริงล้างเหมือนกันทั้ง 2 โหมด)');
  assert.ok(!out.includes('ขอนแก่น') && !out.includes('บ้านเป็ด') && !out.includes('แสงอรุณ'), 'ชื่อจริงทุกตัวหายในโหมดถอย');
  assert.equal(result._correctionDebug.path, 'corrected');
  assert.equal(result._correctionDebug.coreGuard, 'passed', 'เนื้อยาวปกติ: เกราะแก่นข่าวจับไม่ได้ (ตามรายงาน)');
  assert.equal(result._correctionDebug.rolledBack, false, 'ด่านข้อเท็จจริงจับไม่ได้ (place_missing = medium)');
  assert.equal(result._correctionDebug.placeScrub, undefined, 'โหมดถอยไม่มีคีย์ debug ใหม่ (debug เดิม)');
  const bb = bbL45(result);
  assert.equal(bb.changed, true);
  assert.equal(bb.placeScrub, undefined, 'กล่องดำโหมดถอย = รายการเดิม');
});

test('A3 ค่าเริ่มต้น (ไม่ตั้งสวิตช์): เนื้อจริงคงทุกไบต์ ล้างเฉพาะชื่อหลอน "จังหวัดสมมุติ" ตรงตำแหน่ง · ฐานความจริง = raw · debug/กล่องดำมีรายละเอียด', async () => {
  const result = await fresh(() => runPipeline(WRITER, { newsBody: NEWS_BODY, raw: RAW }));
  assert.equal(result.content, EXPECTED_DEFAULT);
  const d = result._correctionDebug;
  assert.equal(d.path, 'corrected');
  assert.equal(d.rolledBack, false);
  assert.equal(d.placeScrub?.error, undefined, 'ด่านต้องรันจริง ไม่ล้มเงียบ');
  assert.equal(d.placeScrub.authority, 'raw', 'ข้อ ก: ฐานความจริงต้องเป็นเนื้อดิบเมื่อมี');
  assert.equal(d.placeScrub.segmenter, true);
  assert.deepEqual(d.placeScrub.scrubbed.map((s) => `${s.place}→${s.replacement}`), ['จังหวัดสมมุติ→ในพื้นที่']);
  assert.ok(d.placeScrub.grounded >= 2, 'ตำบลบ้านเป็ด + จังหวัดขอนแก่น (+วัดป่าแสงอรุณ) ต้องนับเป็นชื่อมีจริง');
  assert.ok(d.placeScrub.skipped.some((s) => s.reason === 'stop-head:เส้น'), 'ถนนเส้นเดียว = ไม่ใช่ชื่อ');
  assert.ok(d.placeScrub.skipped.some((s) => s.reason === 'stop-head:ความ'), 'วัดความดัน = กริยา');
  const bb = bbL45(result);
  assert.equal(bb.changed, true);
  assert.equal(bb.placeScrub.authority, 'raw');
});

// ═══ B) ฐานความจริง (ข้อ ก) ═══
test('B1 raw ก่อน newsBody: ชื่อมีใน raw แต่เนื้อสกัดไม่มี → คง · ชื่อมีเฉพาะในเนื้อสกัด (ตัวสกัดเติมเอง) → ล้าง', () => {
  const content = 'บ้านของเธอที่ตำบลหนองแวง จมน้ำทั้งหลัง';
  const keep = scrub(content, { rawSourceText: 'น้ำท่วม ต.หนองแวง ขอนแก่น', newsBody: 'น้ำท่วมขอนแก่น เรือนจมทั้งหลัง' });
  assert.equal(keep.content, content);
  assert.equal(keep.authority, 'raw');
  assert.equal(keep.grounded, 1);
  const drop = scrub(content, { rawSourceText: 'น้ำท่วมขอนแก่น เรือนจมทั้งหลัง', newsBody: 'น้ำท่วม ต.หนองแวง ขอนแก่น' });
  assert.equal(drop.content, 'บ้านของเธอที่ในพื้นที่ จมน้ำทั้งหลัง', 'raw คือผู้ตัดสิน ไม่ใช่เนื้อที่ AI สกัด');
  assert.deepEqual(drop.scrubbed.map((s) => s.place), ['ตำบลหนองแวง']);
  // เอนไปทางคง: หัวชื่อเป็นคำที่มีในเนื้อดิบ (บ้าน) ก็นับว่ามีจริง — ทิศพลาด = ไม่ลบ
  const lenient = scrub('บ้านของเธอที่ตำบลบ้านเป็ด จมน้ำ', { rawSourceText: 'น้ำท่วมขอนแก่น บ้านจมทั้งหลัง' });
  assert.equal(lenient.content, 'บ้านของเธอที่ตำบลบ้านเป็ด จมน้ำ');
  assert.equal(lenient.grounded, 1);
});

test('B2 ไม่มี raw (สาย URL) → ถอยไป newsBody · ทั้งคู่ว่าง/ไม่ใช่สตริง → ฐาน none = ไม่แตะ · เนื้อว่าง = ไม่แตะ', () => {
  const content = 'ผู้บาดเจ็บถูกส่งไปโรงพยาบาลศิริราช และอีกรายไปโรงพยาบาลสมมุติ';
  const viaBody = scrub(content, { rawSourceText: null, newsBody: 'นำส่ง รพ.ศิริราช' });
  assert.equal(viaBody.authority, 'newsBody');
  assert.equal(viaBody.content, 'ผู้บาดเจ็บถูกส่งไปโรงพยาบาลศิริราช และอีกรายไปโรงพยาบาล');
  for (const sources of [{}, { rawSourceText: '   ', newsBody: '' }, { rawSourceText: 42, newsBody: null }]) {
    const r = scrub(content, sources);
    assert.equal(r.authority, 'none');
    assert.equal(r.content, content);
    assert.deepEqual(r.scrubbed, []);
  }
  assert.equal(scrub('', { rawSourceText: RAW }).content, '');
});

test('B3 researchFacts เป็นฐานเสริม (สตริงและ array ของ {text}) — ชื่อจากรีเสิร์ชที่ยืนยันแล้วไม่ใช่ของหลอน', () => {
  const content = 'ทีมแพทย์จากโรงพยาบาลรามาธิบดี ยืนยันว่าเขาปลอดภัย';
  assert.equal(scrub(content, { rawSourceText: 'เขาปลอดภัยแล้ว' }).content, 'ทีมแพทย์จากโรงพยาบาล ยืนยันว่าเขาปลอดภัย', 'ไม่มีรีเสิร์ช → ชื่อไม่มีในฐาน → ล้าง');
  assert.equal(scrub(content, { rawSourceText: 'เขาปลอดภัยแล้ว', researchFacts: 'ผู้ป่วยรักษาตัวที่ รพ.รามาธิบดี' }).content, content);
  assert.equal(scrub(content, { rawSourceText: 'เขาปลอดภัยแล้ว', researchFacts: [{ text: 'รักษาที่รามาธิบดี' }, 'อื่นๆ'] }).content, content);
  assert.equal(scrub(content, { researchFacts: 'รักษาที่รามาธิบดี' }).authority, 'none', 'รีเสิร์ชอย่างเดียวไม่ใช่ต้นฉบับ → ไม่แตะ');
});

// ═══ C) ขอบคำ (ข้อ ข) — 4 เคสจากรายงาน + คำที่ไม่ใช่สถานที่ ═══
test('C1 4 เคสจากรายงาน/กล่องดำ ไม่ถูกแตะ และบอกเหตุผลถูกข้อ', () => {
  const cases = [
    ['ที่จังหวัดขอนแก่นมีเพื่อนบ้านกว่า 20 คนมาช่วยกันขนของ', { grounded: 1 }],
    ['ทุกคนยืนอยู่ด้วยกันบนถนนเส้นเดียวที่น้ำยังไม่ท่วม', { skipped: 'stop-head:เส้น' }],
    ['ลูกชายพาแม่ไปวัดความดันที่โรงพยาบาลทุกเดือน', { skipped: 'stop-head:ความ' }],
    ['งานเงียบๆ ในวัดเหล่านั้นไม่ใช่การลงโทษ แต่เป็นสิ่งที่แม่แก้วตั้งใจ', { skipped: 'stop-head:เหล่า' }],
  ];
  for (const [content, expect] of cases) {
    const r = scrub(content, { rawSourceText: RAW });
    assert.equal(r.content, content, `ต้องไม่แตะ: ${content}`);
    assert.deepEqual(r.scrubbed, []);
    if (expect.grounded) assert.equal(r.grounded, expect.grounded, content);
    if (expect.skipped) assert.ok(r.skipped.some((s) => s.reason === expect.skipped), `${content} → ${JSON.stringify(r.skipped)}`);
  }
});

test('C2 คำนำหน้าต้องอยู่บนขอบคำ: ไข้หวัดสเปน/วัดผล/ตรวจวัด ไม่ใช่สถานที่ · ไปวัดด้วยกัน/โรงพยาบาลใกล้บ้าน/โรงเรียนแห่งหนึ่ง = ไม่ใช่ชื่อ', () => {
  const raw = 'ต้นฉบับไม่มีชื่อสถานที่ใดๆ';
  for (const content of [
    'ไข้หวัดสเปนระบาดหนัก ทางการเร่งตรวจวัดระดับน้ำและวัดผลการรักษา',
    'ไปทำบุญที่วัดด้วยกัน แล้วแวะโรงพยาบาลใกล้บ้าน ก่อนส่งลูกที่โรงเรียนแห่งหนึ่ง',
    'เขาไปวัด แต่วันนี้ปิด จึงเดินกลับมานั่งในวัด',
  ]) {
    const r = scrub(content, { rawSourceText: raw });
    assert.equal(r.content, content, content);
    assert.deepEqual(r.scrubbed, []);
  }
});

test('C3 ชื่อจริงหลายโทเค็น/ราชาศัพท์ คงไว้เมื่อมีในเนื้อดิบ (ไม่แยกส่วน ไม่ split/join)', () => {
  const raw = 'พระราชทานเพลิงศพ ณ วัดเทพศิรินทราวาส · ตำรวจ สภ.เมืองขอนแก่น · โรงเรียนสวนกุหลาบวิทยาลัย · สนามบินสุวรรณภูมิ · ถนนมิตรภาพ';
  const content = 'พิธีพระราชทานเพลิงศพจัดขึ้น ณ วัดเทพศิรินทราวาส โดยมีตำรวจจากสถานีตำรวจภูธรเมืองขอนแก่นดูแล นักเรียนโรงเรียนสวนกุหลาบวิทยาลัยเดินทางจากสนามบินสุวรรณภูมิผ่านถนนมิตรภาพมาร่วมงาน';
  const r = scrub(content, { rawSourceText: raw });
  assert.equal(r.content, content);
  assert.ok(r.grounded >= 4, `ชื่อมีจริงต้อง ≥4: ${r.grounded}`);
  assert.deepEqual(r.scrubbed, []);
});

// ═══ D) ยังล้างของหลอน + ไม่มั่นใจ = ไม่แตะ (ข้อ ค) ═══
test('D1 ของหลอนถูกล้างตามชนิดสถานที่ ตรงตำแหน่ง ไม่ซ้อนบุพบท และตัดชื่อที่คำหยุด (เนื้อหลังชื่อคง)', () => {
  const raw = 'เกิดเหตุน้ำท่วมในหลายพื้นที่ ผู้บาดเจ็บนำส่งโรงพยาบาล';
  const cases = [
    ['เกิดเหตุที่จังหวัดสมมุติ ใกล้โรงพยาบาลสมมุติ ในซอยสมมุติ บนถนนสมมุติ', 'เกิดเหตุที่ในพื้นที่ ใกล้โรงพยาบาล ในซอย บนถนน'],
    ['ที่ตำบลหนองสมมุติมีเพื่อนบ้านมาช่วย', 'ที่ในพื้นที่มีเพื่อนบ้านมาช่วย'], // ชื่อ 2 โทเค็นติดคำต่อเนื่อง → ตัดที่ "มี" · เนื้อหลังชื่อคง
    ['ชาวบ้านในซ.สมมุติ และบนถ.สมมุติ รอความช่วยเหลือ', 'ชาวบ้านในซอย และบนถนน รอความช่วยเหลือ'],
    ['อยู่ที่ อ.สมมุติ จ.สมมุติ', 'อยู่ที่ ในพื้นที่ ในพื้นที่'],
    ['ใน จ.สมมุติ มีฝนตกหนัก', 'ใน พื้นที่ มีฝนตกหนัก'],
    ['ผู้ป่วยถูกส่งจากสถานีสมมุติ ไปโรงเรียนสมมุติ มหาวิทยาลัยสมมุติ และสนามบินสมมุติ', 'ผู้ป่วยถูกส่งจากสถานี ไปโรงเรียน มหาวิทยาลัย และสนามบิน'],
  ];
  for (const [content, expected] of cases) {
    const r = scrub(content, { rawSourceText: raw });
    assert.equal(r.content, expected, content);
    for (const s of r.scrubbed) assert.equal(content.slice(s.index, s.index + s.place.length), s.place, 'index ต้องชี้ตำแหน่งจริงในเนื้อเดิม');
  }
});

test('D2 ไม่มั่นใจ = ไม่แตะ: ชื่อยาวเกิน 3 โทเค็น/15 ตัวอักษร · สั้นกว่า 4 ตัวอักษร · รันไทม์ไม่มี Intl.Segmenter · เจ.ขอนแก่น ไม่ใช่ตัวย่อ', () => {
  const raw = 'ต้นฉบับไม่มีชื่อสถานที่ใดๆ';
  const long = scrub('ยืนรออยู่ที่วัดพระศรีรัตนศาสดาราม และที่โรงเรียนอนุบาลบ้านหนองแวงน้อย', { rawSourceText: raw });
  assert.equal(long.content, 'ยืนรออยู่ที่วัดพระศรีรัตนศาสดาราม และที่โรงเรียนอนุบาลบ้านหนองแวงน้อย');
  assert.ok(long.skipped.some((s) => s.reason === 'too-long'), JSON.stringify(long.skipped));
  const short = scrub('เขาบวชที่วัดดง มาสามพรรษา', { rawSourceText: raw });
  assert.equal(short.content, 'เขาบวชที่วัดดง มาสามพรรษา');
  assert.ok(short.skipped.some((s) => s.reason === 'too-short'));
  const noSeg = scrub('เกิดเหตุที่จังหวัดสมมุติ', { rawSourceText: raw }, { segmenter: null });
  assert.equal(noSeg.content, 'เกิดเหตุที่จังหวัดสมมุติ', 'ไม่มีเครื่องตัดคำ = ตัดชื่อไม่ได้ = ไม่แตะ');
  assert.equal(noSeg.segmenter, false);
  assert.ok(noSeg.skipped.some((s) => s.reason === 'no-segmenter'));
  assert.equal(scrub('เจ.ขอนแก่น มาแล้ว', { rawSourceText: raw }).content, 'เจ.ขอนแก่น มาแล้ว');
});

test('D3 ชื่อโทเค็นเดียวติดคำต่อเนื่อง (ถนนลื่นจน… · วัดร้างที่… · จังหวัดสมมุติใน…) = ไม่มั่นใจ ไม่แตะ · แต่ตัวย่อ+คำเดียว และชื่อที่มีช่องว่างตาม ยังล้าง', () => {
  const raw = 'ต้นฉบับไม่มีชื่อสถานที่ใดๆ';
  // คำขยายที่รู้จัก (ลื่น/ร้าง) ถูกจับเป็นคำหยุดก่อน · คำที่ไม่อยู่ในรายการ (เฉอะแฉะ/สมมุติ) ต้องถูกกันด้วยกฎ "โทเค็นเดียวติดคำต่อเนื่อง"
  for (const [content, reason] of [
    ['ฝนตกหนักตั้งแต่เช้า ถนนลื่นจนมองแทบไม่เห็นเส้นแบ่งเลน', 'stop-head:ลื่น'],
    ['เขาเดินเข้าไปในวัดร้างที่ไม่มีใครดูแล', 'stop-head:ร้าง'],
    ['ฝนตกหนักตั้งแต่เช้า ถนนเฉอะแฉะจนรถหลายคันต้องจอด', 'uncertain-glued'],
    ['ข่าวลือว่าน้ำจะมาถึงจังหวัดสมมุติในอีกสองวัน', 'uncertain-glued'],
  ]) {
    const r = scrub(content, { rawSourceText: raw });
    assert.equal(r.content, content, content);
    assert.ok(r.skipped.some((s) => s.reason === reason), `${content} → ${JSON.stringify(r.skipped)}`);
  }
  assert.equal(scrub('ข่าวลือว่าน้ำจะมาถึง จ.สมมุติในอีกสองวัน', { rawSourceText: raw }).content, 'ข่าวลือว่าน้ำจะมาถึง ในพื้นที่ในอีกสองวัน', 'ตัวย่อ+คำเดียว = ชื่อเกือบแน่');
  assert.equal(scrub('ข่าวลือว่าน้ำจะมาถึงจังหวัดสมมุติ ในอีกสองวัน', { rawSourceText: raw }).content, 'ข่าวลือว่าน้ำจะมาถึงในพื้นที่ ในอีกสองวัน');
});

// ═══ E) ท่อจริง ═══
test('E1 สาย URL ไม่ส่ง rawSourceText → ฐาน newsBody (เหมือนเดิม): ชื่อวัดที่ตัวสกัดตัดทิ้งจึงถูกล้าง (ต่างจากมี raw) แต่เนื้อจริงที่เหลือคงทุกไบต์', async () => {
  const result = await fresh(() => runPipeline(WRITER, { newsBody: NEWS_BODY }));
  assert.equal(result._correctionDebug.placeScrub.authority, 'newsBody');
  assert.equal(result.content, EXPECTED_DEFAULT.replace('ไปพักที่วัดป่าแสงอรุณ ', 'ไปพักที่วัด '));
  assert.deepEqual(result._correctionDebug.placeScrub.scrubbed.map((s) => s.place), ['วัดป่าแสงอรุณ', 'จังหวัดสมมุติ']);
});

test('E2 fail-open: ด่านโยน error → ปล่อยเนื้อเดิมผ่าน บันทึก error ใน debug · ท่อไม่ล้ม', async () => {
  const boom = buildPipeline({ scrubFn: () => { throw new Error('boom-segmenter'); } });
  const result = await fresh(() => runPipeline(WRITER, { newsBody: NEWS_BODY, raw: RAW }, boom));
  assert.equal(result.content, WRITER);
  assert.equal(result._correctionDebug.placeScrub.error, 'boom-segmenter');
  assert.equal(result._correctionDebug.path, 'corrected');
  assert.equal(result._correctionError, undefined);
  assert.equal(bbL45(result).changed, false);
});

test('E3 ไม่มี newsBody และไม่มี raw (เหมือนข้อสอบเดิมที่ส่ง newsData={}) → ทั้ง 2 โหมดคืนเนื้อเดิม', async () => {
  const content = 'ที่จังหวัดขอนแก่นมีเพื่อนบ้านกว่า 20 คนมาช่วยกันขนของขึ้นที่สูง ทุกคนยืนอยู่ด้วยกันบนถนนเส้นเดียวที่น้ำยังไม่ท่วม ' + 'เนื้อข่าวสำหรับทดสอบฉบับจริง '.repeat(4);
  const a = await legacy(() => runPipeline(content, {}));
  const b = await fresh(() => runPipeline(content, {}));
  assert.equal(a.content, content);
  assert.equal(b.content, content);
  assert.equal(b._correctionDebug.placeScrub.authority, 'none');
});
