// 🎚️ ข้อสอบ VIRAL_SCORE_ANNOTATE — ต่อสายคะแนน "โอกาสปัง" เข้าท่อข่าวแบบมีสวิตช์ (เฟส 3 ข้อ 7 · 2 ก.ย. 69)
//   ค่าเริ่มต้นปิด (รับเฉพาะ '1' ตรงตัว) = ไม่ import โมดูล ไม่มีคีย์ _viralScore สักฉบับ → response เดิมทุกไบต์
//   เปิด = แนบ version._viralScore {score, band, bandLabel, predictedReactions, topDrivers, warnings, modelVersion}
//   หลังเนื้อสุดท้ายนิ่งทุกสาขา (correction + diversity + factual editor + length gate) ก่อนประกอบ response
// autoFlowServiceText ลาก import '@/…' เป็นลูกโซ่ → ดึงบล็อกจริงจากซอร์สมารัน (แบบ tests/angle2-distinct-v2):
//   · BLOCK = pure function annotateViralScores (ไม่พึ่งอะไรนอกบล็อก)
//   · WIRING = บล็อกต่อสายจริงในตัว processAutoFlowText — ฉีด loadViralScoreModule/addLog ปลอมเพื่อพิสูจน์พฤติกรรม
//   ส่วน viralScore.js ไม่มี import '@/…' → import ของจริงมาเทส integration กับโมเดลจริง data/viral-score-model.json ได้ตรงๆ
// รัน: node --test tests/viral-score-annotate.test.mjs (ไม่ยิง AI/เครือข่าย — ridge ในเครื่อง)
// 🔨 ผลการทุบโค้ดจริงในไฟล์ (2 ก.ย. 69 — ทุบทีละข้อ รันเทส แล้วคืนโค้ดไบต์ต่อไบต์ · ฐานก่อนทุบเขียวหมด):
//   1) ทุบ `if (process.env.VIRAL_SCORE_ANNOTATE === '1')` → `!== '0'` (เปิดตลอด) ⇒ 🔴 แดง 2 เคส
//      (สวิตช์ปิดต้องไม่โหลดโมดูล/ไม่มีคีย์ · ค่าขยะ 'true'/'on' ต้องเท่ากับปิด)
//   2) ทุบ `return { ...version, _viralScore: {…} }` → `version._viralScore = stamp; return version;` (mutate ของเดิม)
//      ⇒ 🔴 แดง 2 เคส (ห้าม mutate ต้นฉบับ (freeze โยน TypeError ใน strict mode ของ ESM) · เปิดสวิตช์แล้วคีย์ครบตามโครง)
//   3) ทุบ catch ใน wiring ให้ `throw viralScoreError` ⇒ 🔴 แดง 1 เคส (loader ล้มต้องไม่ล้มท่อ — addLog เตือนแล้วไปต่อ)
//   4) ย้ายบล็อก wiring ขึ้นไปก่อน FULL-RAW FACTUAL GATE ⇒ 🔴 แดง 1 เคส (ลำดับ: ต้องอยู่หลังทุกด่านที่แก้/กรองเนื้อ)
//   คืนโค้ดแล้วเขียวหมด — ดูรายงานงานนี้ประกอบ
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreVersion as realScoreVersion, getModelMetrics as realGetModelMetrics } from '../src/lib/feedback/viralScore.js';

const SRC = readFileSync(new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BLOCK_START = '// ── VIRAL_SCORE_ANNOTATE block start ──';
const BLOCK_END = '// ── VIRAL_SCORE_ANNOTATE block end ──';
const WIRING_START = '// ── VIRAL_SCORE_ANNOTATE wiring start ──';
const WIRING_END = '// ── VIRAL_SCORE_ANNOTATE wiring end ──';

/** ดึง annotateViralScores ตัวจริงจากซอร์ส (pure function — ไม่มี dependency นอกบล็อก) */
function makeAnnotate(source = SRC) {
  const s = source.indexOf(BLOCK_START);
  const e = source.indexOf(BLOCK_END, s);
  assert.ok(s >= 0 && e > s, 'ต้องพบบล็อก VIRAL_SCORE_ANNOTATE ตัวจริงในซอร์ส');
  const slice = source.slice(s, e).replace(/export function /g, 'function ');
  return new Function(`'use strict';\n${slice}\nreturn annotateViralScores;`)();
}

/** รันบล็อก wiring ตัวจริงด้วยของปลอมที่ควบคุมได้ — คืน { versions, logs } (ไม่กลืน error: บล็อกจริงต้องไม่โยนเอง) */
async function runWiring({ env = {}, loader, finalVersions, source = SRC }) {
  const s = source.indexOf(WIRING_START);
  const e = source.indexOf(WIRING_END, s);
  assert.ok(s >= 0 && e > s, 'ต้องพบบล็อก VIRAL_SCORE_ANNOTATE wiring ตัวจริงในซอร์ส');
  const logs = [];
  const fn = new Function(
    'process', 'loadViralScoreModule', 'annotateViralScores', 'finalVersions', 'addLog',
    `'use strict';\nreturn (async () => {\n${source.slice(s, e)}\nreturn finalVersions;\n})();`,
  );
  const versions = await fn({ env }, loader, makeAnnotate(), finalVersions, (step, msg) => logs.push({ step, msg }));
  return { versions, logs };
}

const sampleVersions = () => [
  Object.freeze({
    title: 'พี่หนุ่มช่วยยาย', content: 'พี่หนุ่มควักเงิน 5,000 บาทช่วยยายวัย 80 ปี ที่เดินเก็บขวดขายมา 3 ปี',
    usedModel: 'claude-opus-4-8', promptId: 'p1', _source: 'classic', _sourceLabel: 'V1',
    _missingFacts: Object.freeze({ missing: [], checked: 4 }),
  }),
  Object.freeze({
    title: 'น้องมายด์ไม่ทิ้งแม่', content: 'น้องมายด์วัย 12 ปี เดินเท้าวันละ 6 กิโลไปดูแลแม่ป่วยติดเตียงนาน 2 ปี',
    usedModel: 'gpt-5.6-sol', promptId: 'p2', _source: 'enhanced', _sourceLabel: 'V2',
    _diversityWarning: 'คำเตือนเดิมต้องอยู่ครบ',
  }),
];

const fakeScorer = (overrides = {}) => (text) => ({
  score: text.includes('มายด์') ? 41.4 : 72.2,
  bandLabel: text.includes('มายด์') ? 'กลาง' : 'สูง',
  predictedReactions: 1234,
  topDrivers: [{ feature: 'giveWords', text: 'ดัน คำแสดงการให้ (×1.10)' }],
  warnings: ['สั้น 15 คำ ต่ำกว่าพื้น 146 คำ'],
  ...overrides,
});
const fakeMetrics = { version: 1, metrics: { valid: { spearman: 0.3018 } } };
const loaderOf = (scoreVersion, metrics = fakeMetrics) => {
  const calls = { count: 0 };
  const loader = async () => {
    calls.count += 1;
    return { scoreVersion, getModelMetrics: () => metrics };
  };
  return { loader, calls };
};

// ── 1. สวิตช์ปิด = ไม่โหลดโมดูล ไม่มีคีย์ ไม่มี log ──
test('สวิตช์ปิด (ไม่ตั้ง env / =0): ไม่เรียก loader เลย · versions ก้อนเดิม identity เดิม · ไม่มีคีย์ _viralScore · ไม่มี log', async () => {
  for (const env of [{}, { VIRAL_SCORE_ANNOTATE: '0' }]) {
    const input = sampleVersions();
    const { loader, calls } = loaderOf(fakeScorer());
    const { versions, logs } = await runWiring({ env, loader, finalVersions: input });
    assert.equal(calls.count, 0, 'สวิตช์ปิดห้าม import โมดูลคะแนน');
    assert.equal(versions, input, 'สวิตช์ปิดต้องคืนอาร์เรย์ก้อนเดิม (ไม่ map ใหม่)');
    for (const version of versions) assert.ok(!('_viralScore' in version));
    assert.deepEqual(logs, [], 'สวิตช์ปิดต้องไม่พ่น log สักบรรทัด');
  }
});

test("ค่าขยะ ('true'/'on'/' 1') = ปิด — รับเฉพาะ '1' ตรงตัว", async () => {
  for (const junk of ['true', 'on', ' 1', 'yes']) {
    const { loader, calls } = loaderOf(fakeScorer());
    const { versions } = await runWiring({
      env: { VIRAL_SCORE_ANNOTATE: junk }, loader, finalVersions: sampleVersions(),
    });
    assert.equal(calls.count, 0, `ค่า "${junk}" ต้องเท่ากับปิด`);
    for (const version of versions) assert.ok(!('_viralScore' in version));
  }
});

// ── 2. เปิดสวิตช์ = คีย์ครบตามโครง · เนื้อ/ลำดับ/provenance เดิม · ไม่ mutate ต้นฉบับ ──
test('เปิดสวิตช์: _viralScore ครบโครง {score, band, bandLabel, predictedReactions, topDrivers, warnings, modelVersion} + log 1 บรรทัด', async () => {
  const input = sampleVersions();
  const { loader, calls } = loaderOf(fakeScorer());
  const { versions, logs } = await runWiring({
    env: { VIRAL_SCORE_ANNOTATE: '1' }, loader, finalVersions: input,
  });
  assert.equal(calls.count, 1, 'โหลดโมดูลครั้งเดียว');
  assert.equal(versions.length, 2, 'จำนวนฉบับต้องไม่เปลี่ยน');
  assert.deepEqual(versions[0]._viralScore, {
    score: 72, band: 'high', bandLabel: 'สูง', predictedReactions: 1234,
    topDrivers: [{ feature: 'giveWords', text: 'ดัน คำแสดงการให้ (×1.10)' }],
    warnings: ['สั้น 15 คำ ต่ำกว่าพื้น 146 คำ'], modelVersion: 1,
  });
  assert.equal(versions[1]._viralScore.score, 41);
  assert.equal(versions[1]._viralScore.band, 'mid');
  assert.equal(versions[1]._viralScore.bandLabel, 'กลาง');
  // เนื้อ/ลำดับ/provenance/คีย์เตือนเดิมต้องรอดครบ
  for (const [i, version] of versions.entries()) {
    assert.equal(version.title, input[i].title);
    assert.equal(version.content, input[i].content);
    assert.equal(version.usedModel, input[i].usedModel);
    assert.equal(version.promptId, input[i].promptId);
    assert.equal(version._source, input[i]._source);
  }
  assert.deepEqual(versions[0]._missingFacts, { missing: [], checked: 4 }, '_missingFacts เดิมต้องรอด');
  assert.equal(versions[1]._diversityWarning, 'คำเตือนเดิมต้องอยู่ครบ', '_diversityWarning เดิมต้องรอด');
  // ต้นฉบับ (freeze ไว้) ต้องไม่ถูก mutate — คีย์ใหม่อยู่บน object ใหม่เท่านั้น
  for (const original of input) assert.ok(!('_viralScore' in original), 'ห้าม mutate version ต้นฉบับ');
  assert.equal(logs.length, 1, 'addLog 1 บรรทัดเดียว');
  assert.equal(logs[0].step, 'ViralScore');
  assert.match(logs[0].msg, /โอกาสปัง: V1 72\/100 สูง · V2 41\/100 กลาง/);
  assert.match(logs[0].msg, /Spearman 0\.30.*คำเตือน ไม่ใช่คำตัดสิน/, 'log ต้องกำกับว่าเป็นคำเตือน ไม่ใช่คำตัดสิน');
});

test('pure function: scorer โยน = ฉบับนั้นไม่มีคีย์ ไม่ล้มทั้งชุด · คืน null = ไม่มีคีย์ · ฉบับอื่นยังได้คะแนน', () => {
  const annotate = makeAnnotate();
  const throwingScorer = (text) => {
    if (text.includes('หนุ่ม')) throw new Error('boom');
    return fakeScorer()(text);
  };
  const input = sampleVersions();
  const out = annotate(input, { scoreVersion: throwingScorer, metrics: fakeMetrics });
  assert.ok(!('_viralScore' in out.versions[0]), 'ฉบับที่ scorer โยนต้องไม่มีคีย์');
  assert.equal(out.versions[1]._viralScore.score, 41, 'ฉบับที่เหลือยังได้คะแนน');
  assert.equal(out.scoredCount, 1);
  assert.match(out.logLine, /V2 41\/100/);
  assert.doesNotMatch(out.logLine, /V1 /, 'ฉบับที่ล้มต้องไม่โผล่ใน log คะแนน');

  const nullOut = annotate(input, { scoreVersion: () => null, metrics: fakeMetrics });
  assert.equal(nullOut.scoredCount, 0);
  for (const version of nullOut.versions) assert.ok(!('_viralScore' in version));
  assert.match(nullOut.logLine, /โมเดลไม่พร้อม/);
  assert.equal(nullOut.versions.length, input.length, 'จำนวน/ลำดับต้องไม่เปลี่ยนแม้ไม่มีโมเดล');
});

test('pure function (ผู้ตรวจไขว้ 2 ก.ย. 69): content ว่าง/ไม่ใช่สตริง = ไม่ให้คะแนน ไม่เรียก scorer · [] = log "ไม่มีฉบับให้คะแนน" · ว่างหมด = log "ไม่มีเนื้อฉบับ" (ไม่ใช่ "โมเดลไม่พร้อม")', () => {
  const annotate = makeAnnotate();
  let calls = 0;
  const countingScorer = (text) => { calls += 1; return fakeScorer()(text); };
  const input = sampleVersions();
  const mixed = [{ ...input[0], content: null }, { ...input[1] }, { ...input[0], title: 'ว่าง', content: '   ' }];
  const out = annotate(mixed, { scoreVersion: countingScorer, metrics: fakeMetrics });
  assert.equal(calls, 1, 'scorer ต้องถูกเรียกเฉพาะฉบับที่มีเนื้อเป็นสตริงไม่ว่าง');
  assert.ok(!('_viralScore' in out.versions[0]), 'content null ต้องไม่มีคีย์');
  assert.ok(!('_viralScore' in out.versions[2]), 'content ว่างต้องไม่มีคีย์');
  assert.equal(out.versions[1]._viralScore.score, 41);
  assert.equal(out.scoredCount, 1);
  assert.equal(out.versions.length, 3, 'จำนวน/ลำดับไม่เปลี่ยน');

  const empty = annotate([], { scoreVersion: countingScorer, metrics: fakeMetrics });
  assert.deepEqual(empty.versions, []);
  assert.match(empty.logLine, /ไม่มีฉบับให้คะแนน/);
  assert.doesNotMatch(empty.logLine, /โมเดลไม่พร้อม/, 'ชุดว่างห้ามโทษโมเดล');

  const blank = annotate([{ ...input[0], content: '' }], { scoreVersion: countingScorer, metrics: fakeMetrics });
  assert.match(blank.logLine, /ไม่มีเนื้อฉบับ/);
  assert.doesNotMatch(blank.logLine, /โมเดลไม่พร้อม/);
});

// ── 3. fail-safe ระดับ wiring: โมดูลหาย/โยน = ท่อไม่ล้ม ──
test('loader โยน (โมดูลหาย/บันเดิลพัง): ท่อไม่ล้ม · versions เดิม · addLog เตือน 1 บรรทัด', async () => {
  const input = sampleVersions();
  const { versions, logs } = await runWiring({
    env: { VIRAL_SCORE_ANNOTATE: '1' },
    loader: async () => { throw new Error('Cannot find module'); },
    finalVersions: input,
  });
  assert.equal(versions, input, 'ล้มแล้วต้องคืนก้อนเดิม');
  for (const version of versions) assert.ok(!('_viralScore' in version));
  assert.equal(logs.length, 1);
  assert.match(logs[0].msg, /คำนวณไม่ได้.*ไม่มีคะแนน/);
});

test('โมเดลไม่มี (scoreVersion จริงกับ path ผิด → null): ไม่มีคีย์ ไม่โยน · log บอกโมเดลไม่พร้อม', async () => {
  const badScorer = (text) => realScoreVersion(text, { modelPath: 'X:/no/such/viral-score-model.json' });
  assert.equal(badScorer('ทดสอบ'), null, 'path ผิดต้องคืน null (fail-safe ของ viralScore.js เอง)');
  const { loader } = loaderOf(badScorer, null);
  const input = sampleVersions();
  const { versions, logs } = await runWiring({ env: { VIRAL_SCORE_ANNOTATE: '1' }, loader, finalVersions: input });
  for (const version of versions) assert.ok(!('_viralScore' in version));
  assert.equal(versions.length, input.length);
  assert.equal(logs.length, 1);
  assert.match(logs[0].msg, /โมเดลไม่พร้อม/);
});

// ── 4. integration กับโมเดลจริงใน data/ (ridge ในเครื่อง — ไม่ยิง API) ──
test('โมเดลจริง data/viral-score-model.json: คะแนน 0-100 + band สอดคล้อง bandLabel + modelVersion จาก metrics', async () => {
  const real = realScoreVersion(sampleVersions()[0].content);
  assert.ok(real && Number.isFinite(real.score), 'เครื่องนี้ต้องมีโมเดลจริง (เทรนแล้วใน commit 265fc755)');
  const { loader } = loaderOf(realScoreVersion, realGetModelMetrics());
  const { versions, logs } = await runWiring({
    env: { VIRAL_SCORE_ANNOTATE: '1' }, loader, finalVersions: sampleVersions(),
  });
  for (const version of versions) {
    const stamp = version._viralScore;
    assert.ok(stamp, 'ทุกฉบับต้องได้คะแนนจากโมเดลจริง');
    assert.ok(stamp.score >= 0 && stamp.score <= 100);
    assert.ok(['สูง', 'กลาง', 'ต่ำ'].includes(stamp.bandLabel));
    assert.equal(stamp.band, { 'สูง': 'high', 'กลาง': 'mid', 'ต่ำ': 'low' }[stamp.bandLabel]);
    assert.ok(Array.isArray(stamp.topDrivers) && stamp.topDrivers.length <= 3);
    assert.ok(Array.isArray(stamp.warnings));
    assert.equal(stamp.modelVersion, realGetModelMetrics()?.version ?? null);
  }
  assert.match(logs[0].msg, /โอกาสปัง: V1 \d+\/100/);
});

// ── 5. โครงสร้าง: จุดต่อสายต้องอยู่หลังทุกด่านที่แก้/กรองเนื้อ (ครอบสาขา factual editor) ก่อนประกอบ response ──
test('ตำแหน่ง wiring ในซอร์ส: หลัง factual editor + length gate · ก่อน buildPublishableAnalysisResult · loader อยู่ใต้เช็คสวิตช์', () => {
  const wiringAt = SRC.indexOf(WIRING_START);
  assert.ok(wiringAt >= 0);
  const factualEditorAt = SRC.indexOf('finalVersions = factOutcome.passingVersions;');
  const lengthGateAt = SRC.indexOf('enforceTextNewsPublicationFloor(finalVersions', factualEditorAt);
  const buildAt = SRC.indexOf('buildPublishableAnalysisResult({', wiringAt);
  assert.ok(factualEditorAt >= 0 && factualEditorAt < wiringAt,
    'wiring ต้องอยู่หลังสาขา factual editor (จุดที่ map finalVersions ใหม่)');
  assert.ok(lengthGateAt >= 0 && lengthGateAt < wiringAt,
    'wiring ต้องอยู่หลัง length gate (ให้คะแนนเฉพาะชุดที่ผ่านการกรองแล้ว)');
  assert.ok(buildAt > wiringAt, 'wiring ต้องมาก่อนการประกอบ analysisResult (คะแนนถึงติดไป response)');
  const wiringSlice = SRC.slice(wiringAt, SRC.indexOf(WIRING_END, wiringAt));
  const switchAt = wiringSlice.indexOf("process.env.VIRAL_SCORE_ANNOTATE === '1'");
  const loadAt = wiringSlice.indexOf('await loadViralScoreModule()');
  assert.ok(switchAt >= 0 && loadAt > switchAt, 'การโหลดโมดูลต้องอยู่ใต้เช็คสวิตช์ (ปิด = ไม่ import เลย)');
  assert.ok(!/^import .*viralScore/m.test(SRC), 'ห้ามมี import viralScore ระดับบนไฟล์ (เทสสตับเดิมโหลด source แทน import)');
});

// ── 6. เส้นทางรอดถึงบอท: จุดกรองระหว่างทางต้องไม่ตัด _viralScore ──
test('compactDelegatedVersions (/api/auto/process) ตัดเฉพาะ _blackbox/_rawModelDraft — _viralScore รอดถึง response บอท', () => {
  const routeSrc = readFileSync(new URL('../src/app/api/auto/process/route.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const s = routeSrc.indexOf('export function compactDelegatedVersions(');
  const e = routeSrc.indexOf('\n}', s);
  assert.ok(s >= 0 && e > s, 'ต้องพบ compactDelegatedVersions ตัวจริง');
  const compact = new Function(`${routeSrc.slice(s, e + 2).replace('export function', 'function')}\nreturn compactDelegatedVersions;`)();
  const [out] = compact([{
    title: 'x', content: 'y', usedModel: 'claude-opus-4-8',
    _viralScore: { score: 72, bandLabel: 'สูง' }, _missingFacts: { missing: [] },
    _blackbox: ['หนัก'], _rawModelDraft: 'หนัก',
  }]);
  assert.deepEqual(out._viralScore, { score: 72, bandLabel: 'สูง' }, '_viralScore ต้องรอดชั้น compact');
  assert.deepEqual(out._missingFacts, { missing: [] }, '_missingFacts ต้องรอดเหมือนเดิม (สัญญาเดิมของบอท)');
  assert.ok(!('_blackbox' in out) && !('_rawModelDraft' in out), 'ของหนักยังต้องถูกตัดตามเดิม');
});
