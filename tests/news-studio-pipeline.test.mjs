// ข้อสอบ "ท่อเขียนข่าวตัวใหม่ทั้งเส้น" (10 พ.ย. 69) — ใช้ตัวเดินงานจริง + คลังจริง · โมเดลทุกตัวเป็นตัวปลอม · ไม่ยิง API ไม่แตะฐานข้อมูล
// รัน: node --test tests/news-studio-pipeline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNewsStudio, NEWS_STUDIO, buildAnalyzerPrompt, buildLibrarianPrompt, pairTeachersWithAngles, angleOpeningNeed } from '../src/lib/services/newsStudio/pipeline.js';
import { loadTeacherLibrary } from '../src/lib/services/teacherLibrary.js';
import { loadAngleExemplars } from '../src/lib/services/angleDirector.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const teachers = loadTeacherLibrary({ file: path.join(ROOT, 'data', 'teacher-library.json') });
const exemplars = loadAngleExemplars({ file: path.join(ROOT, 'data', 'angle-exemplars', 'angle-library.json') });

const RAW = 'น้องเอ อายุ 19 ปี เก็บเงินได้ 50,000 บาท จากการขายข้าวแกง 3 ปี เพื่อส่งตัวเองเรียนมหาวิทยาลัย น้องเอบอกว่า "ผมไม่อยากให้แม่ลำบากอีกแล้ว" ครูประจำชั้นเล่าว่าน้องตื่นตี 4 ทุกวัน';
const POST = [
  'น้องเอวัย 19 ปี เก็บเงินได้ 50,000 บาทจากการขายข้าวแกงตลอด 3 ปี เพื่อส่งตัวเองเรียนมหาวิทยาลัย เด็กคนหนึ่งเลือกแบกความฝันไว้ด้วยสองมือของตัวเอง โดยไม่รอให้ใครมาช่วย',
  'ครูประจำชั้นเล่าว่าน้องตื่นตี 4 ทุกวันเพื่อเตรียมของขาย ก่อนไปเรียนตามปกติเหมือนเพื่อนคนอื่น เรื่องนี้ทำให้หลายคนอดชื่นชมไม่ได้ เพราะความกตัญญูกับความขยันเมื่ออยู่ในคนคนเดียวกัน ก็พาชีวิตไปได้ไกลเสมอ น้องเอบอกไว้สั้นๆ ว่า "ผมไม่อยากให้แม่ลำบากอีกแล้ว" คำพูดประโยคเดียวนี้อธิบายทุกอย่างที่น้องทำมาตลอดหลายปี ทั้งการตื่นเช้า การอดออม และความตั้งใจที่ไม่เคยลดลงเลย',
  'เงินก้อนนี้อาจไม่มากสำหรับใครหลายคน แต่สำหรับน้องเอมันคือค่าเทอมที่หามาด้วยตัวเองทุกบาท ขอเป็นกำลังใจให้น้องเอเรียนจบตามที่ตั้งใจไว้',
].join('\n\n');
// เวอร์ชันที่ชูคำพูด: ย่อหน้าแรกต้องมีคำพูดนั้น (ตัวตรวจ: ย่อหน้าแรกต้องถึงประเด็นที่ชู)
const POST_QUOTE = [
  '"ผมไม่อยากให้แม่ลำบากอีกแล้ว" คือคำพูดของน้องเอวัย 19 ปี ที่เก็บเงินได้ 50,000 บาทจากการขายข้าวแกงตลอด 3 ปี เพื่อส่งตัวเองเรียนมหาวิทยาลัย',
  'ครูประจำชั้นเล่าว่าน้องตื่นตี 4 ทุกวันเพื่อเตรียมของขาย ก่อนไปเรียนตามปกติเหมือนเพื่อนคนอื่น เด็กคนหนึ่งเลือกแบกความฝันไว้ด้วยสองมือของตัวเอง โดยไม่รอให้ใครมาช่วย เรื่องนี้ทำให้หลายคนอดชื่นชมไม่ได้ เพราะความกตัญญูกับความขยันเมื่ออยู่ในคนคนเดียวกัน ก็พาชีวิตไปได้ไกลเสมอ คำพูดประโยคเดียวของน้องอธิบายทุกอย่างที่ทำมาตลอดหลายปี ทั้งการตื่นเช้า การอดออม และความตั้งใจที่ไม่เคยลดลงเลย ไม่ว่าวันนั้นจะเหนื่อยแค่ไหนก็ตาม',
  'เงินก้อนนี้อาจไม่มากสำหรับใครหลายคน แต่สำหรับน้องเอมันคือค่าเทอมที่หามาด้วยตัวเองทุกบาท ขอเป็นกำลังใจให้น้องเอเรียนจบตามที่ตั้งใจไว้',
].join('\n\n');
const postFor = (prompt) => (String(prompt?.user || '').includes('คำพูดถึงแม่') ? POST_QUOTE : POST);
const ANGLES = { angles: [
  { core: 'น้องเอขายข้าวแกงส่งตัวเองเรียน', focus: 'กิจวัตรตีสี่ของเด็กขายข้าวแกง', coverLines: ['ตื่นตี 4 ทุกวัน', 'เก็บเงินได้ 50,000 บาท'], order: ['เปิดด้วยตีสี่'], mustKeep: ['50,000 บาท', 'ตื่นตี 4'], exemplarIds: ['a05'], why: 'ตัวเลข' },
  { core: 'น้องเอขายข้าวแกงส่งตัวเองเรียน', focus: 'คำพูดถึงแม่', coverLines: ['"ผมไม่อยากให้แม่ลำบากอีกแล้ว"'], order: [], mustKeep: ['ผมไม่อยากให้แม่ลำบากอีกแล้ว'], exemplarIds: ['a24'], why: 'คำพูด' },
] };

function makeDeps(over = {}) {
  const calls = { director: 0, writer: 0, checker: 0, analyze: 0, librarian: 0, remembered: null, librarianArgs: null };
  let clock = 1000;
  const deps = {
    loadTeachers: () => teachers,
    loadExemplars: () => exemplars,
    scoreTeachers: (analysis, list) => list.map((t, index) => ({ index, score: t.category === analysis.primaryCategory ? 60 : 5 })),
    callDirector: async () => { calls.director++; return ANGLES; },
    callWriter: async (prompt) => { calls.writer++; return postFor(prompt); },
    callChecker: async () => { calls.checker++; return { issues: [] }; },
    callReader: async () => { calls.reader = (calls.reader || 0) + 1; return { gist: 'น้องเอขายข้าวแกงส่งตัวเองเรียน', opening: 'บอกเรื่อง', hardParts: [] }; },
    analyze: async () => { calls.analyze++; return { primaryCategory: 'สู้ชีวิต', emotionalTags: ['ชื่นชม'], title: 'น้องเอขายข้าวแกงส่งตัวเองเรียน' }; },
    librarian: async (args) => { calls.librarian++; calls.librarianArgs = args; return args.shortlist.slice(0, 6).map((t) => ({ id: t.id, reason: 'รูปเรื่องตรง' })); },
    getRecentTeacherIds: async () => [],
    rememberTeacherIds: async (ids) => { calls.remembered = ids; },
    now: () => (clock += 10),
    rand: () => 0.42,
    ...over,
  };
  return { deps, calls };
}

test('ทางปกติ: ได้ครบ 3 เวอร์ชัน ทุกเวอร์ชันมีทิศทาง ครู ผลตรวจแบบแผน และผลตรวจข้อเท็จจริง', async () => {
  const { deps, calls } = makeDeps();
  const steps = [];
  const r = await runNewsStudio({ rawText: RAW, deps, onProgress: (e) => steps.push(`${e.step}:${e.status}`) });
  assert.equal(r.ok, true);
  assert.equal(r.versions.length, NEWS_STUDIO.versions);
  assert.deepEqual(r.versions.flatMap((v) => v.fails.map((f) => f.code)), [], 'ทุกเวอร์ชันต้องผ่านแบบแผน');
  assert.deepEqual(r.summary, { requested: 3, written: 3, passed: 3, formPassed: 3, factChecked: 3, readClear: 3 });
  assert.equal(calls.reader, 3, 'ทุกเวอร์ชันต้องผ่านผู้อ่านจับใจความ');
  assert.ok(r.versions.every((v) => v.readChecked && v.readClear && v.readOpening === 'บอกเรื่อง'));
  assert.equal(new Set(r.versions.map((v) => v.teacher.id)).size, 3, 'ครูต้องไม่ซ้ำ');
  assert.equal(r.versions[0].angle.focus, ANGLES.angles[0].focus);
  assert.equal(r.versions[1].angle.focus, ANGLES.angles[1].focus);
  assert.equal(r.versions[2].angle.focus, ANGLES.angles[0].focus, 'ไม่มีทิศทางที่ 3 = ใช้ทิศทางหลัก');
  assert.ok(r.versions.every((v) => v.teacher.post.length > 200 && v.factChecked));
  assert.deepEqual(r.versions.map((v) => v.content), [POST, POST_QUOTE, POST]);
  assert.equal(r.title, 'น้องเอขายข้าวแกงส่งตัวเองเรียน');
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(calls.remembered.sort(), r.versions.map((v) => v.teacher.id).sort(), 'ต้องจำครูที่ใช้ไว้เลี่ยงรอบหน้า');
  assert.equal(calls.director, 1);
  assert.equal(calls.analyze, 1);
  assert.equal(calls.librarian, 1);
  assert.deepEqual(calls.librarianArgs.angles.map((a) => a.focus), ANGLES.angles.map((a) => a.focus), 'บรรณารักษ์ต้องเห็นทิศทางที่กำหนดแล้ว');
  assert.ok(steps.indexOf('direction:done') < steps.indexOf('teachers:start') && steps.indexOf('teachers:done') < steps.indexOf('writing:start'), `ลำดับขั้นผิด: ${steps.join(' ')}`);
  assert.equal(steps[steps.length - 1], 'done:done');
  assert.ok(r.timings.total > 0 && r.timings.direction > 0 && r.timings.writing > 0);
});

test('ทิศทางล้ม / วิเคราะห์ล้ม / บรรณารักษ์ล้ม: งานไม่ล้ม ได้ครบ 3 เวอร์ชัน และมีคำเตือนบอกทุกจุด (ห้ามถอยเงียบ)', async () => {
  const { deps } = makeDeps({
    callDirector: async () => { throw new Error('ผู้กำหนดทิศทางล่ม'); },
    analyze: async () => { throw new Error('ตัววิเคราะห์ล่ม'); },
    librarian: async () => { throw new Error('บรรณารักษ์ล่ม'); },
  });
  const r = await runNewsStudio({ rawText: RAW, deps });
  assert.equal(r.versions.length, 3);
  assert.equal(r.summary.written, 3);
  assert.ok(r.versions.every((v) => v.angle === null));
  assert.deepEqual(r.warnings.map((w) => w.code).sort(), ['ANALYSIS_FAILED', 'LIBRARIAN_FAILED', 'NO_DIRECTION']);
  assert.equal(r.direction.ok, false);
  assert.equal(new Set(r.versions.map((v) => v.teacher.id)).size, 3);
});

test('บรรณารักษ์ตอบไม่ครบ/ตอบรหัสมั่ว: เติมครูด้วยตัวเลือกสำรองจนครบ 3', async () => {
  const { deps } = makeDeps({ librarian: async ({ shortlist }) => [{ id: shortlist[0].id, reason: 'ก' }, { id: 'ไม่มีจริง', reason: 'ข' }] });
  const r = await runNewsStudio({ rawText: RAW, deps });
  assert.equal(new Set(r.versions.map((v) => v.teacher.id)).size, 3);
  assert.ok(r.warnings.some((w) => w.code === 'LIBRARIAN_PARTIAL'));
});

test('นักเขียนล้ม 1 เวอร์ชัน: อีก 2 เวอร์ชันยังส่ง และเวอร์ชันที่ล้มอยู่ในผลพร้อมเหตุ (ไม่หายเงียบ)', async () => {
  let n = 0;
  const { deps } = makeDeps({ callWriter: async () => { if (++n === 2) throw new Error('โมเดลล่มกลางทาง'); return POST; } });
  const r = await runNewsStudio({ rawText: RAW, deps });
  assert.equal(r.versions.length, 3);
  assert.equal(r.summary.written, 2);
  const failed = r.versions.find((v) => v.error);
  assert.ok(failed && failed.error.includes('โมเดลล่มกลางทาง') && failed.content === '' && failed.teacher.id);
});

test('นักเขียนล้มทุกเวอร์ชัน = error ALL_VERSIONS_FAILED (ไม่คืนผลว่างที่ดูเหมือนสำเร็จ)', async () => {
  const { deps } = makeDeps({ callWriter: async () => { throw new Error('คีย์โมเดลใช้ไม่ได้'); } });
  await assert.rejects(() => runNewsStudio({ rawText: RAW, deps }), (e) => e.errorType === 'ALL_VERSIONS_FAILED' && e.message.includes('คีย์โมเดลใช้ไม่ได้'));
});

test('ผู้ตรวจข้อเท็จจริง: ไม่ได้ต่อ = เตือนชัด · ต่อแล้วล่ม = เวอร์ชันถูกติดว่ายังไม่ได้ตรวจ ไม่ถือว่าผ่าน', async () => {
  const off = await runNewsStudio({ rawText: RAW, deps: makeDeps({ callChecker: undefined }).deps });
  assert.ok(off.warnings.some((w) => w.code === 'FACT_CHECK_OFF'));
  assert.equal(off.summary.factChecked, 0);
  const down = await runNewsStudio({ rawText: RAW, deps: makeDeps({ callChecker: async () => { throw new Error('ผู้ตรวจล่ม'); } }).deps });
  assert.equal(down.summary.passed, 0, 'ตรวจไม่ได้ห้ามนับว่าผ่าน');
  assert.ok(down.versions.every((v) => !v.factChecked && v.factError.includes('ผู้ตรวจล่ม') && v.content));
});

test('ค้นข้อมูลเสริม: ปิด = ไม่เรียก · เปิดแต่ไม่ได้ต่อ = เตือน · เปิดและต่อ = ข้อมูลถึงนักเขียน · ค้นล่ม = เขียนต่อพร้อมคำเตือน', async () => {
  let searched = 0;
  const prompts = [];
  const research = async () => { searched++; return ['ข้อมูลเสริม ก', '', 'ข้อมูลเสริม ข']; };
  const callWriter = async (p) => { prompts.push(p.user); return POST; };
  await runNewsStudio({ rawText: RAW, deps: makeDeps({ research, callWriter }).deps });
  assert.equal(searched, 0);
  assert.ok(!prompts[0].includes('ข้อมูลเสริมจากการค้น'));
  const on = await runNewsStudio({ rawText: RAW, useResearch: true, deps: makeDeps({ research, callWriter }).deps });
  assert.equal(searched, 1);
  assert.deepEqual(on.researchFacts, ['ข้อมูลเสริม ก', 'ข้อมูลเสริม ข']);
  assert.ok(prompts[prompts.length - 1].includes('1. ข้อมูลเสริม ก'));
  const none = await runNewsStudio({ rawText: RAW, useResearch: true, deps: makeDeps().deps });
  assert.ok(none.warnings.some((w) => w.code === 'RESEARCH_UNAVAILABLE'));
  const broke = await runNewsStudio({ rawText: RAW, useResearch: true, deps: makeDeps({ research: async () => { throw new Error('ค้นล่ม'); } }).deps });
  assert.ok(broke.warnings.some((w) => w.code === 'RESEARCH_FAILED') && broke.summary.written === 3);
});

test('เนื้อดิบสั้น/ยาวเกิน และตั้งค่าไม่ครบ = error ที่มี errorType ตั้งแต่ต้น ก่อนเรียกโมเดลใดๆ', async () => {
  const { deps, calls } = makeDeps();
  await assert.rejects(() => runNewsStudio({ rawText: 'สั้น', deps }), (e) => e.errorType === 'RAW_TEXT_TOO_SHORT');
  await assert.rejects(() => runNewsStudio({ rawText: 'ก'.repeat(NEWS_STUDIO.maxRawChars + 1), deps }), (e) => e.errorType === 'RAW_TEXT_TOO_LONG');
  await assert.rejects(() => runNewsStudio({ rawText: RAW, deps: { ...deps, callWriter: undefined } }), (e) => e.errorType === 'NEWS_STUDIO_MISCONFIGURED');
  assert.equal(calls.director + calls.writer + calls.analyze, 0);
});

test('เลี่ยงครูที่เพิ่งใช้: ครูชุดก่อนไม่ถูกส่งให้บรรณารักษ์เลือกซ้ำ', async () => {
  const first = await runNewsStudio({ rawText: RAW, deps: makeDeps().deps });
  const used = first.versions.map((v) => v.teacher.id);
  const { deps, calls } = makeDeps({ getRecentTeacherIds: async () => used });
  const second = await runNewsStudio({ rawText: RAW, deps });
  assert.ok(calls.librarianArgs.shortlist.every((t) => !used.includes(t.id)));
  assert.ok(second.versions.every((v) => !used.includes(v.teacher.id)));
});

test('คำถามตัววิเคราะห์และบรรณารักษ์: หมวดตรงกับคลังครูครบทุกหมวด · บรรณารักษ์เห็นทิศทาง', () => {
  const a = buildAnalyzerPrompt(RAW);
  for (const cat of new Set(teachers.map((t) => t.category))) assert.ok(a.includes(cat), `ตัววิเคราะห์ไม่มีหมวด ${cat} ที่คลังครูใช้`);
  const l = buildLibrarianPrompt({ rawText: RAW, shortlist: teachers.slice(0, 3), angles: ANGLES.angles });
  assert.ok(l.includes(teachers[0].id) && l.includes('1. ' + ANGLES.angles[0].focus) && l.includes(RAW));
  assert.ok(!buildLibrarianPrompt({ rawText: RAW, shortlist: teachers.slice(0, 3) }).includes('ทิศทางข่าวที่บรรณาธิการกำหนดแล้ว'));
});

test('จับคู่ครูกับทิศทาง: ทิศทางที่ชูคำพูดได้ครูที่เปิดด้วยคำพูด · ชูตัวเลขได้ครูที่เปิดด้วยตัวเลข · เสมอ/ไม่มีทิศทาง = ลำดับเดิม', () => {
  const T = (id, openingType) => ({ id, openingType });
  const quoteAngle = { coverLines: ['"ผมไม่อยากให้แม่ลำบากอีกแล้ว"', 'เก็บเงิน 3 ปี'], mustKeep: ['ผมไม่อยากให้แม่ลำบากอีกแล้ว'] };
  const numberAngle = { coverLines: ['เก็บเงินได้ 50,000 บาท', 'ขายข้าวแกง'], mustKeep: ['50,000 บาท'] };
  const plainAngle = { coverLines: ['ตื่นเช้าทุกวัน', 'เพื่อแม่'], mustKeep: ['ตื่นเช้า'] };
  assert.equal(angleOpeningNeed(quoteAngle), 'quote');
  assert.equal(angleOpeningNeed(numberAngle), 'number');
  assert.equal(angleOpeningNeed(plainAngle), '');
  assert.equal(angleOpeningNeed({ coverLines: ['น้องเอ', '"คำพูด" ของน้อง'] }), 'quote', 'บรรทัดแรกไม่เจาะจง = ดูทั้งปก');
  assert.equal(angleOpeningNeed(null), '');
  const out = pairTeachersWithAngles([T('n', 'number'), T('p', 'plain'), T('q', 'quote')], [quoteAngle, numberAngle, plainAngle]);
  assert.deepEqual(out.map((t) => t.id), ['q', 'n', 'p']);
  // ครูที่เปิดด้วยคำพูดต้องไม่ไปตกกับทิศทางที่ไม่มีคำพูดให้ชู ถ้ามีทางเลี่ยง
  assert.deepEqual(pairTeachersWithAngles([T('q', 'quote'), T('p', 'plain'), T('c', 'contrast')], [plainAngle, quoteAngle, plainAngle]).map((t) => t.id), ['p', 'q', 'c']);
  const same = [T('a', 'plain'), T('b', 'contrast'), T('c', 'admire')];
  assert.deepEqual(pairTeachersWithAngles(same, [plainAngle, plainAngle, plainAngle]).map((t) => t.id), ['a', 'b', 'c'], 'เสมอกัน = ลำดับของบรรณารักษ์');
  assert.deepEqual(pairTeachersWithAngles(same, [null, null, null]).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(pairTeachersWithAngles([], []), []);
});

test('ผู้อ่านจับใจความ: ไม่ได้ต่อ = เตือนชัด และทุกเวอร์ชันติดว่ายังไม่ได้อ่าน (ห้ามแสดงว่าอ่านเข้าใจ)', async () => {
  const off = await runNewsStudio({ rawText: RAW, deps: makeDeps({ callReader: undefined }).deps });
  assert.ok(off.warnings.some((w) => w.code === 'READER_OFF'));
  assert.ok(off.versions.every((v) => v.readChecked === false && v.readClear === false));
  assert.equal(off.summary.readClear, 0);
  assert.equal(off.summary.passed, 3, 'ด่านเสริมไม่ได้ต่อ ไม่ทำให้เวอร์ชันตก');
  const teaser = await runNewsStudio({ rawText: RAW, deps: makeDeps({ callReader: async () => ({ gist: 'มีเด็กคนหนึ่ง', opening: 'เกริ่น', hardParts: [] }) }).deps });
  assert.equal(teaser.summary.passed, 0, 'ย่อหน้าแรกแค่เกริ่นทุกรอบ = ไม่ผ่าน');
  assert.ok(teaser.versions.every((v) => v.content && v.readChecked && !v.readClear && v.readOpening === 'เกริ่น'), 'ฉบับยังถูกส่งพร้อมผลอ่าน ไม่ทิ้งเงียบ');
});

test('ผลวิเคราะห์ผิดรูปจนตัวให้คะแนนโยน = ไม่ล้มทั้งงาน คัดครูแบบไม่รู้หมวด + เตือน · เลยเส้นตายรอบแก้ = ส่งฉบับที่มีพร้อมเตือน', async () => {
  const broken = await runNewsStudio({ rawText: RAW, deps: makeDeps({ scoreTeachers: () => { throw new TypeError('emotionalTags.some is not a function'); } }).deps });
  assert.equal(broken.summary.written, 3);
  assert.ok(broken.warnings.some((w) => w.code === 'ANALYSIS_FAILED' && w.message.includes('ไม่รู้หมวด')));
  const notList = await runNewsStudio({ rawText: RAW, deps: makeDeps({ scoreTeachers: () => null }).deps });
  assert.equal(notList.summary.written, 3);

  // นักเขียนตอบฉบับที่ตกแบบแผนทุกครั้ง + นาฬิกาเดินเร็ว → รอบแก้ต้องไม่เริ่ม
  let writes = 0;
  const late = await runNewsStudio({
    rawText: RAW, retryDeadlineMs: 5,
    deps: makeDeps({ callWriter: async (p) => { writes++; return postFor(p) + ' 🙏'; } }).deps,
  });
  assert.equal(writes, 3, 'เขียนเวอร์ชันละรอบเดียว');
  assert.ok(late.versions.every((v) => v.content && !v.ok && v.attempts === 1 && /เวลาของงานใกล้หมด/.test(v.stopped)));
  assert.equal(late.warnings.filter((w) => w.code === 'REWRITE_STOPPED').length, 3);
  const normal = await runNewsStudio({ rawText: RAW, deps: makeDeps().deps });
  assert.ok(normal.versions.every((v) => v.stopped === ''), 'งานปกติไม่มีป้ายหยุดแก้');
});
