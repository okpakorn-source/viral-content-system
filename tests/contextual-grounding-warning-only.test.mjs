import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PATH = new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url);
// ★ 2 ก.ย. 69 — เทสแดงค้าง 1 เคส ("ต้องพบ export function assessRawTextSafety(") · สาเหตุราก = line ending ไม่ใช่โค้ดผิด:
//   สัญญาโค้ด (assessRawTextSafety / groundingIssuesToWarnings / ตำแหน่งบล็อก) ยังตรงตั้งแต่ 554d0286 (24 ส.ค. 69)
//   แต่ marker ท้ายฟังก์ชันเขียนเป็น '\n/**\n * กฎคำ…' ขณะที่ working tree บน Windows (core.autocrlf=true) เป็น CRLF
//   (git ls-files --eol: i/lf w/crlf) → indexOf ไม่เจอ '\n/**\n' ที่จริงคือ '\r\n/**\r\n' · บน Linux/Vercel (LF) เทสเขียวอยู่แล้ว
//   → normalize CRLF→LF ตอนอ่าน = เทสให้ผลเดียวกันทุกเครื่อง · ไม่แตะ production
// ผลทุบ (2 ก.ย. 69): ถอด .replace(/\r\n/g, '\n') บนเครื่อง CRLF ⇒ แดงเคสเดิม · ทุบ production เปลี่ยนหาง
//   '— ให้พนักงานตรวจบริบทก่อนโพสต์' เป็นข้อความอื่น ⇒ แดง 2 เคส (แล้วคืนโค้ด)
const SOURCE = readFileSync(PATH, 'utf8').replace(/\r\n/g, '\n');

function extractFunction(source, marker, nextMarker) {
  const start = source.indexOf(marker);
  const end = source.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `ต้องพบ ${marker}`);
  return source.slice(start, end).replace('export function', 'function');
}

function makeAssess(source = SOURCE) {
  const declaration = extractFunction(
    source,
    'export function assessRawTextSafety(',
    '\n/**\n * กฎคำ/regex เป็นเพียงสัญญาณ',
  );
  const getPublishablePostText = version => String(version?.content || '');
  return new Function('getPublishablePostText', `${declaration}; return assessRawTextSafety;`)(getPublishablePostText);
}

function makeWarnings(source = SOURCE) {
  const declaration = extractFunction(
    source,
    'export function groundingIssuesToWarnings(',
    '\n// ★ 19 ส.ค. 69',
  );
  return new Function(`${declaration}; return groundingIssuesToWarnings;`)();
}

const WATER_RAW = 'ด.ต.วัชรินทร์ช่วยเด็กชายที่ขอน้ำ จึงนำน้ำให้ดื่ม ก่อนตักข้าวให้กินจนอิ่ม จากนั้นให้เด็กขออนุญาตแม่มาช่วยงานที่ร้าน';
const SAUSAGE_RAW = 'แน็ทพบลุงชะลอ อายุ 71 ปี นั่งขายไส้กรอกอีสานริมถนนเพียงลำพัง บรรยากาศค่อนข้างเงียบเหงา จึงลงจากรถไปช่วยอุดหนุน โดยไส้กรอกขายลูกละ 2 บาท หรือชุดละ 20 บาท มีทั้งแบบเปรี้ยวและไม่เปรี้ยว แน็ทยืนรับประทานหน้าร้านหลายชุด พร้อมพูดคุยกับลุงชะลอจนทราบว่าทำไส้กรอกกับลูกชาย และขายประจำที่ซอยซีไซด์ ตั้งแต่ประมาณ 16.00-21.00 น. และขายไม่ค่อยดี หลังรับประทานเสร็จ แน็กมอบเงิน 1,000 บาทให้ลุงชะลอ พร้อมบอกว่า “ไม่ต้องทอนเงิน” เพราะตั้งใจมาอุดหนุน จากนั้นซื้อถุงก๋วยเตี๋ยวมอบให้ลุงชะลอนำกลับไปรับประทานกับครอบครัว แน็กบอกว่าดีใจที่ตัวเองช่วยเหลือและสร้างรายได้ให้พ่อค้าแม่ค้ารายย่อย';

test('สองเคสพนักงานไม่ถูกบล็อก และทุกเหตุผลที่ตรวจพบถูกแปลงเป็น warning โดยไม่หาย', () => {
  const assess = makeAssess();
  const toWarnings = makeWarnings();
  const employeeFixtures = [
    [WATER_RAW.replace('นำน้ำให้ดื่ม', 'นำน้ำหนึ่งแก้วให้ดื่ม'), WATER_RAW],
    [SAUSAGE_RAW
      .replace('แน็ทยืนรับประทานหน้าร้านหลายชุด', 'แน็ทยืนกินไส้กรอกหน้าร้านหลายชุด')
      .replace('เพราะตั้งใจมาอุดหนุน', 'เพราะตั้งใจมาช่วยอุดหนุน')
      .replace('นำกลับไปรับประทานกับครอบครัว', 'นำกลับไปกินกับครอบครัว'), SAUSAGE_RAW],
  ];
  for (const [fixtureIndex, [content, raw]] of employeeFixtures.entries()) {
    const evidence = assess([{ title: '', content }], raw);
    const warnings = toWarnings(evidence.issues);
    assert.ok(Array.isArray(warnings));
    assert.equal(warnings.length, new Set(evidence.issues.map(issue => String(issue || '').trim()).filter(Boolean)).size,
      'จำนวน warning ต้องตรงกับเหตุผลที่ตัวตรวจพบหลังตัดข้อความซ้ำ');
    assert.ok(warnings.every(warning => /ให้พนักงานตรวจบริบทก่อนโพสต์/u.test(warning)));
    if (fixtureIndex === 0) assert.ok(warnings.length > 0, 'เคสน้ำหนึ่งแก้วต้องพิสูจน์เส้นทาง warning จริง');
  }

  const priorFailureReasons = [
    'V1: เพิ่มปริมาณ/โดสที่ต้นฉบับไม่ได้ระบุ (น้ำหนึ่งแก้ว)',
    'V1: ข้อความสุขภาพไม่ระบุที่มา',
    'V2: เพิ่มที่มาของข้อความสุขภาพที่ต้นฉบับไม่ได้ระบุ',
  ];
  assert.deepEqual(toWarnings(priorFailureReasons), priorFailureReasons.map(
    reason => `${reason} — ให้พนักงานตรวจบริบทก่อนโพสต์`,
  ));

  const highRiskFixtures = [
    ['แพทย์ให้ยา 2 เม็ดทุกวันเพื่อรักษาอาการ', 'ต้นฉบับกล่าวเพียงว่าเด็กได้รับความช่วยเหลือ'],
    ['แพทย์แนะนำว่าอาหารช่วยให้เด็กแข็งแรง', 'เด็กกินข้าว'],
  ];
  for (const [content, raw] of highRiskFixtures) {
    const evidence = assess([{ title: '', content }], raw);
    assert.equal(evidence.ok, false, `ตัวตรวจต้องยังเก็บหลักฐาน: ${content}`);
    const warnings = toWarnings(evidence.issues);
    assert.ok(warnings.length > 0);
    assert.ok(warnings.every(warning => /ให้พนักงานตรวจบริบทก่อนโพสต์/u.test(warning)));
  }
});

test('warning helper ไม่ทำข้อมูลหายและตัดข้อความซ้ำเท่านั้น', () => {
  const toWarnings = makeWarnings();
  assert.deepEqual(toWarnings(['ข้อ A', 'ข้อ A', '', null, 'ข้อ B']), [
    'ข้อ A — ให้พนักงานตรวจบริบทก่อนโพสต์',
    'ข้อ B — ให้พนักงานตรวจบริบทก่อนโพสต์',
  ]);
});

test('production wiring ไม่มี auto_grounding throw และ warning ไม่เรียก AI ซ้ำ', () => {
  assert.doesNotMatch(SOURCE, /throwStep\('auto_grounding'/u);
  assert.equal((SOURCE.match(/groundingIssuesToWarnings\(grounding\.issues\)/gu) || []).length, 2,
    'ต้องแปลงเป็น warning ทั้งก่อนและหลัง factual editor');
  const start = SOURCE.indexOf('// ด่านสุดท้ายก่อนบันทึก:');
  const end = SOURCE.indexOf('// === FULL-RAW FACTUAL GATE', start);
  const groundingBlock = SOURCE.slice(start, end);
  assert.doesNotMatch(groundingBlock, /performSummarize|callAI|callSmartAI|enforceRawFactCompleteness/u);
  assert.match(groundingBlock, /pipelineQualityWarnings\.push\(\.\.\.groundingWarnings\)/u);

  const postEditorStart = SOURCE.indexOf('if (factOutcome.repairedIndexes.length > 0) {', end);
  const postEditorEnd = SOURCE.indexOf('} catch (factError)', postEditorStart);
  assert.ok(postEditorStart >= 0 && postEditorEnd > postEditorStart, 'ต้องพบช่วงตรวจซ้ำหลัง factual editor');
  const postEditorGroundingBlock = SOURCE.slice(postEditorStart, postEditorEnd);
  assert.match(postEditorGroundingBlock, /groundingIssuesToWarnings\(grounding\.issues\)/u);
  assert.match(postEditorGroundingBlock, /pipelineQualityWarnings\.push\(\.\.\.groundingWarnings\)/u);
  assert.doesNotMatch(postEditorGroundingBlock, /performSummarize|callAI|callSmartAI|enforceRawFactCompleteness/u);
});

test('mutation: คืน auto_grounding throw หรือทำ warning หายต้องถูกจับ', () => {
  const throwMutation = SOURCE.replace(
    'pipelineQualityWarnings.push(...groundingWarnings);',
    "pipelineQualityWarnings.push(...groundingWarnings);\n  if (groundingWarnings.length) throwStep('auto_grounding', 'blocked');",
  );
  assert.match(throwMutation, /throwStep\('auto_grounding'/u);
  assert.throws(() => {
    assert.doesNotMatch(throwMutation, /throwStep\('auto_grounding'/u);
  });

  const dropMutation = SOURCE.replace('.map(issue => `${issue} — ให้พนักงานตรวจบริบทก่อนโพสต์`);', '.filter(() => false);');
  assert.notEqual(dropMutation, SOURCE);
  assert.throws(() => {
    assert.deepEqual(makeWarnings(dropMutation)(['ข้อ A']), [
      'ข้อ A — ให้พนักงานตรวจบริบทก่อนโพสต์',
    ]);
  }, 'mutation ที่ทำ warning หายต้องถูก oracle ฆ่า');
});
