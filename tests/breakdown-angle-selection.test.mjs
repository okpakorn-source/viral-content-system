import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const autoFlowPath = fileURLToPath(new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url));
const summarizePath = fileURLToPath(new URL('../src/lib/services/summarizeServiceText.js', import.meta.url));
const promptStorePath = fileURLToPath(new URL('../src/lib/ai/promptStoreText.js', import.meta.url));
const modelConfigPath = fileURLToPath(new URL('../src/lib/ai/modelConfig.js', import.meta.url));
const workflowTrackerPath = fileURLToPath(new URL('../src/components/WorkflowTracker.js', import.meta.url));
const extractedViewPath = fileURLToPath(new URL('../src/components/content/ExtractedView.js', import.meta.url));
const contentPagePath = fileURLToPath(new URL('../src/app/content/new/page.js', import.meta.url));
const source = readFileSync(autoFlowPath, 'utf8');
const summarizeSource = readFileSync(summarizePath, 'utf8');
const promptStoreSource = readFileSync(promptStorePath, 'utf8');
const modelConfigSource = readFileSync(modelConfigPath, 'utf8');
const workflowTrackerSource = readFileSync(workflowTrackerPath, 'utf8');
const extractedViewSource = readFileSync(extractedViewPath, 'utf8');
const contentPageSource = readFileSync(contentPagePath, 'utf8');

function extractTopLevelFunction(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `ไม่พบ function marker: ${marker}`);
  const end = text.indexOf('\n}', start);
  assert.ok(end > start, `ไม่พบจุดจบ function: ${marker}`);
  return text.slice(start, end + 2);
}

function makeBreakdownContract(serviceSource = summarizeSource) {
  const fnSource = extractTopLevelFunction(serviceSource, 'export function assertBreakdownAngleContract(')
    .replace('export function', 'function');
  return new Function(`${fnSource}; return assertBreakdownAngleContract;`)();
}

function extractBreakdownPrompt(promptSource = promptStoreSource) {
  const blockStart = promptSource.indexOf('  breakdown: {');
  assert.ok(blockStart >= 0, 'ไม่พบ breakdown prompt block');
  const promptStart = promptSource.indexOf('    prompt: `', blockStart);
  assert.ok(promptStart >= 0, 'ไม่พบ breakdown prompt string');
  const valueStart = promptStart + '    prompt: `'.length;
  const valueEnd = promptSource.indexOf('`,', valueStart);
  assert.ok(valueEnd > valueStart, 'ไม่พบจุดจบ breakdown prompt string');
  return promptSource.slice(valueStart, valueEnd);
}

function assertFixedFourWiring(serviceSource = summarizeSource) {
  const branchStart = serviceSource.indexOf("if (mode === 'breakdown') {");
  const branchEnd = serviceSource.indexOf("if (mode === 'analyze') {", branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart, 'ไม่พบ breakdown service branch');
  const branch = serviceSource.slice(branchStart, branchEnd);
  const contractCalls = branch.match(/assertBreakdownAngleContract\(result\);/g) || [];
  assert.equal(contractCalls.length, 2, 'primary และ fallback ต้องตรวจสัญญา 4 มุมคนละหนึ่งครั้ง');
}

function validFourAngleResult() {
  return {
    best_main_angle: { angle_name: 'เกษตรกรคืออาชีพหลัก นักร้องคืออาชีพเสริม' },
    possible_angles: [
      { angle_name: 'เกษตรกรคืออาชีพหลัก นักร้องคืออาชีพเสริม', description: 'วางสถานะสองอาชีพตาม RAW' },
      { angle_name: 'วัย 8–9 ขวบกับการช่วยพ่อแม่ทำนา', description: 'เล่าช่วงวัยเด็กตาม RAW' },
      { angle_name: '42–43 ปีในวงการโดยไม่เคยเลิกทำนา', description: 'ใช้ช่วงเวลาและการไม่เลิกทำนาเป็นแกน' },
      { angle_name: 'ปลูกข้าว ปลูกผัก เลี้ยงปลา และแบ่งปันเพื่อนบ้าน', description: 'เล่ากิจกรรมเกษตรและการแบ่งปัน' },
    ],
  };
}

test('AutoFlow ใช้ผล Breakdown ที่ผ่านสัญญาโดยตรงและไม่มีตัวจัดมุมซ้ำซ้อน', () => {
  assert.doesNotMatch(source, /promoteBestAngleCandidate/);
  assert.match(source, /const breakdownData = breakRes\.data;/);
});

test('production Breakdown รับเฉพาะ 4 มุม ชื่อไม่ว่าง ไม่ซ้ำ และ best ต้องอยู่ใบแรก', () => {
  const assertContract = makeBreakdownContract();
  const valid = validFourAngleResult();
  assert.equal(assertContract({ ...valid, _warning: 'provider note' }), valid.possible_angles, 'ฟิลด์เสริมต้องไม่ทำลายสัญญามุม');
  assert.throws(() => assertContract({ ...valid, _error: 'ข้อมูลไม่เพียงพอ' }), /BREAKDOWN_AI_REPORTED_ERROR:ข้อมูลไม่เพียงพอ/);

  assert.throws(() => assertContract({ ...valid, possible_angles: valid.possible_angles.slice(0, 3) }), /BREAKDOWN_ANGLE_COUNT:3\/4/);
  assert.throws(() => assertContract({ ...valid, possible_angles: [...valid.possible_angles, { angle_name: 'มุมห้า', description: 'เกินสัญญา' }] }), /BREAKDOWN_ANGLE_COUNT:5\/4/);
  assert.throws(() => assertContract({ ...valid, possible_angles: valid.possible_angles.map((angle, index) => index === 2 ? { ...angle, description: '' } : angle) }), /BREAKDOWN_ANGLE_EMPTY:3/);
  assert.throws(() => assertContract({ ...valid, possible_angles: valid.possible_angles.map((angle, index) => index === 3 ? { ...angle, angle_name: valid.possible_angles[1].angle_name } : angle) }), /BREAKDOWN_ANGLE_DUPLICATE/);
  assert.throws(() => assertContract({ ...valid, best_main_angle: { angle_name: valid.possible_angles[1].angle_name } }), /BREAKDOWN_BEST_ANGLE_NOT_FIRST/);
});

test('production wiring ใช้ Sol เป็นค่าเริ่มต้น prompt ขอ 4 มุม และตรวจทั้ง primary/fallback', () => {
  const prompt = extractBreakdownPrompt();
  assert.match(modelConfigSource, /export const MODEL_BREAKDOWN\s*=\s*process\.env\.MODEL_BREAKDOWN \|\| 'gpt-5\.6-sol';/);
  assert.match(prompt, /possible_angles ต้องมี 4 ใบพอดี/);
  assert.match(prompt, /possible_angles\[0\].*best_main_angle\.angle_name/);
  assert.match(prompt, /ห้ามยกเป็นแกน angle_name เดี่ยว/);
  assert.doesNotMatch(prompt, /แตกประเด็นให้ครบทุกมุม \(12 หมวด\)/);
  assertFixedFourWiring();
});

test('หน้าข่าวแสดงโมเดล Breakdown และจำนวน 4 มุมตรงกับ runtime', () => {
  assert.match(workflowTrackerSource, /auto_breakdown:\s*\{[\s\S]*?model: 'GPT-5\.6 Sol',[\s\S]*?4 มุมข่าว/);
  assert.match(workflowTrackerSource, /ai_breakdown:\{ model: 'GPT-5\.6 Sol',[\s\S]*?วิเคราะห์ 4 มุมข่าว/);
  assert.match(extractedViewSource, /STEP 2: ใช้ 12 เลนส์สำรวจ แล้วคัด 4 มุมข่าวที่แข็งแรงที่สุด/);
  assert.equal((contentPageSource.match(/wfStart\('auto_breakdown', \{ model: 'GPT-5\.6 Sol'/g) || []).length, 2);
  assert.match(contentPageSource, /\/api\/auto → GPT-5\.6 Sol'[\s\S]*?วิเคราะห์ 4 มุมข่าว/);
});

test('mutation: ถอด count gate หรือถอด wiring จุดใดจุดหนึ่งต้องถูก oracle จับ', () => {
  const countTarget = 'if (angles.length !== expectedCount) {';
  const countMutant = summarizeSource.replace(countTarget, 'if (false) {');
  assert.notEqual(countMutant, summarizeSource, 'ต้อง mutate count gate ได้จริง');
  const mutantContract = makeBreakdownContract(countMutant);
  const valid = validFourAngleResult();
  assert.doesNotThrow(() => mutantContract({ ...valid, possible_angles: valid.possible_angles.slice(0, 3) }), 'mutant ต้องแสดงว่า 3 มุมหลุดผ่าน');

  const wiringTarget = '        assertBreakdownAngleContract(result);';
  const wiringMutant = summarizeSource.replace(wiringTarget, '        // contract removed');
  assert.notEqual(wiringMutant, summarizeSource, 'ต้อง mutate primary wiring ได้จริง');
  assert.throws(() => assertFixedFourWiring(wiringMutant), /primary และ fallback/);

  const promptTarget = 'possible_angles ต้องมี 4 ใบพอดี';
  const promptMutant = promptStoreSource.replace(promptTarget, 'possible_angles ต้องมี 12 ใบพอดี');
  assert.notEqual(promptMutant, promptStoreSource, 'ต้อง mutate prompt count ได้จริง');
  assert.doesNotMatch(extractBreakdownPrompt(promptMutant), /possible_angles ต้องมี 4 ใบพอดี/);

  const errorGateTarget = "if (reportedError) {";
  const errorGateMutant = summarizeSource.replace(errorGateTarget, 'if (false) {');
  assert.notEqual(errorGateMutant, summarizeSource, 'ต้อง mutate _error gate ได้จริง');
  assert.doesNotThrow(() => makeBreakdownContract(errorGateMutant)({ ...valid, _error: 'ข้อมูลไม่เพียงพอ' }), 'mutant ต้องแสดงว่า _error หลุดผ่าน');
});
