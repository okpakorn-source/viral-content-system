// ============================================================
// 🧪 PL-14 — ด่านท้าย "กักจริง" + ข้อความตรงจริง + หน่วยนับเดียว (tests/publish-quarantine-pl14.test.mjs)
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ)
// ------------------------------------------------------------
// บั๊ก: src/lib/utils/publishablePostText.js ด่านความยาวสุดท้ายทิ้งฉบับที่จ่ายค่าเขียนแล้วโดยไม่เก็บ แต่ข้อความบอก "ระบบกักผลไว้"
//   (ด่านข้อเท็จจริงก็บอก "เนื้อข่าวถูกกักไว้ให้ตรวจ" ทั้งที่บันทึก versions: [] ไม่มีเนื้อ) · เลขฉบับของด่านความยาวนับใหม่หลังด่าน
//   ข้อเท็จจริงคัดออก (V2 เดิมถูกรายงานเป็น V1) · ไม่บอกหน่วยนับ
// แก้ (ค่าเริ่มต้น): ฉบับที่ไม่ผ่าน → quarantine snapshot (เนื้อเต็ม + provenance + คำไทย ICU หน่วยเดียวกับพื้น) เก็บลงเคส workflow
//   (บางฉบับผ่าน → analysisResult.lengthGate/factualGate.quarantine ผ่าน saveAnalysis · ศูนย์ฉบับผ่าน → saveFactualReview ก่อนโยน)
//   ข้อความบอกผลการเก็บตามจริง · ถอย PUBLISH_QUARANTINE=0 = ข้อความ/รูปผล/เลขฉบับเดิมทุกไบต์
// วิธีเทส: (1) หน่วย publishablePostText ตัวจริง (2) ท่อนจริงของ autoFlowServiceText ตั้งแต่ grounding → FactGate → length floor →
//   analysisResult (ตัดจากซอร์ส แบบเดียวกับ editor-post-sanitize-pl06) · Sol/DB เป็นตัวปลอม · ไม่มีเวลา/timer เกี่ยวข้อง
// mutation: ตัดการแนบ quarantine ใน publishablePostText / ตัดการบันทึก length_review ใน autoFlow / ถอดเลขฉบับเดิม → ต้องแดง
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as realPublishable from '../src/lib/utils/publishablePostText.js';
import { persistFactualReviewOrThrow } from '../src/lib/services/rawFactCompletenessGate.js';
import { PipelineDeadlineError } from '../src/lib/utils/pipelineDeadline.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const AUTO_FLOW_SOURCE = read('../src/lib/services/autoFlowServiceText.js');
const PUBLISHABLE_SOURCE = read('../src/lib/utils/publishablePostText.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const makeWords = (count, tag = 'คำ') => Array.from({ length: count }, (_, index) => `${tag}${index + 1}`).join(' ');
const version = (content, extra = {}) => ({
  title: `พาดหัว ${extra.promptId || 'x'}`, content, usedModel: 'claude-opus-5-5', promptId: 'card-a',
  _source: 'classic', _sourceLabel: 'มุมหนึ่ง', style: 'A1_v1', ...extra,
});

async function importData(source, tag) {
  const encoded = Buffer.from(`${source}\n//# sourceURL=${tag}.mjs`, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${tag}`);
}
async function withEnv(value, fn) {
  const old = process.env.PUBLISH_QUARANTINE;
  if (value === undefined) delete process.env.PUBLISH_QUARANTINE;
  else process.env.PUBLISH_QUARANTINE = value;
  try { return await fn(); } finally {
    if (old === undefined) delete process.env.PUBLISH_QUARANTINE;
    else process.env.PUBLISH_QUARANTINE = old;
  }
}

// ── (2) ท่อนจริง autoFlowServiceText: grounding → FactGate → length floor → analysisResult ──
function segmentRunner(source = AUTO_FLOW_SOURCE) {
  const start = source.indexOf('  let grounding = assessRawTextSafety(finalVersions, groundingSourceText);');
  const end = source.indexOf('  const finalPresetId = usedPreset?.promptId');
  assert.ok(start > 0 && end > start, 'ต้องหาท่อน grounding→FactGate→length floor→analysisResult ในซอร์สจริงได้');
  const segment = source.slice(start, end);
  return new AsyncFunction('ctx', `
    let { finalVersions, usedPreset } = ctx;
    const { detectedType, rawText, groundingSourceText, pipelineQualityWarnings, addLog, _autoWorkflowId, throwStep,
      assessRawTextSafety, groundingIssuesToWarnings, assessVersionDiversity, annotateDiversityWarning,
      isRawFactCompletenessGateEnabled, enforceRawFactCompleteness, persistFactualReviewOrThrow, saveFactualReview,
      isLegacyLengthOn, enforceTextNewsPublicationFloor, NEW_LENGTH_CFG, countFinalVersionSources, resolveFinalUsedPreset,
      usedPresetByPromptId, startTime, buildPublishableAnalysisResult, primaryResult, totalResearchItems,
      buildQuarantineSnapshot } = ctx;
    let classicVersionCount, enhancedVersionCount;
    ${segment}
    return { finalVersions, analysisResult, pipelineQualityWarnings, factualGateSummary, textLengthGateSummary };
  `);
}

/** factOutcome รูปเดียวกับ enforceRawFactCompleteness (versions = หลัง editor) */
function factOutcomeFor(versions, failing) {
  const failed = new Set(failing);
  return {
    versions,
    passingVersions: versions.filter((_, index) => !failed.has(index)),
    quarantinedVersions: versions.filter((_, index) => failed.has(index)),
    repairedIndexes: [...failing],
    finalAudit: {
      failingVersionIndexes: [...failing],
      issues: failing.map(index => ({ versionIndex: index, scope: 'content', reasonCode: 'ADDED_EVENT', original: 'x', reason: 'y' })),
      missingFacts: [],
      model: 'gpt-5.6-sol',
      contextHash: 'ctx-pl14',
    },
  };
}

async function runSegment({ versions, factGate = null, save = null, publishable = realPublishable, source } = {}) {
  const logs = [];
  const saves = [];
  const run = segmentRunner(source);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const out = await run({
      finalVersions: versions, usedPreset: null,
      detectedType: 'plain_text', rawText: 'RAW', groundingSourceText: 'RAW', pipelineQualityWarnings: [],
      addLog: (step, msg) => logs.push(`${step}: ${msg}`), _autoWorkflowId: 'unify_pl14',
      throwStep: (id, msg) => { const e = new Error(msg); e.failedStep = id; throw e; },
      assessRawTextSafety: () => ({ issues: [] }), groundingIssuesToWarnings: () => [],
      assessVersionDiversity: () => ({ ok: true, maxSimilarity: 0 }), annotateDiversityWarning: v => ({ versions: v, warning: '' }),
      isRawFactCompletenessGateEnabled: () => factGate !== null,
      enforceRawFactCompleteness: async ({ versions: input }) => factOutcomeFor(
        input.map((item, index) => (factGate.failing.includes(index) ? { ...item, content: `${item.content} [editor]` } : item)),
        factGate.failing,
      ),
      persistFactualReviewOrThrow,
      saveFactualReview: save || (async (id, diagnostic) => { saves.push({ id, diagnostic: JSON.parse(JSON.stringify(diagnostic)) }); return { id }; }),
      isLegacyLengthOn: () => false,
      enforceTextNewsPublicationFloor: publishable.enforceTextNewsPublicationFloor,
      NEW_LENGTH_CFG: { min: 146 },
      countFinalVersionSources: publishable.countFinalVersionSources,
      resolveFinalUsedPreset: publishable.resolveFinalUsedPreset,
      usedPresetByPromptId: new Map(), startTime: Date.now(),
      buildPublishableAnalysisResult: publishable.buildPublishableAnalysisResult,
      primaryResult: {}, totalResearchItems: [],
      buildQuarantineSnapshot: publishable.buildQuarantineSnapshot,
    });
    return { ok: true, ...out, logs, saves };
  } catch (error) {
    return { ok: false, error, logs, saves };
  } finally {
    console.warn = originalWarn;
  }
}

const LONG = makeWords(180);
const SHORT_A = makeWords(131, 'สั้น');
const SHORT_B = makeWords(120, 'ย่อ');

// ── (1) หน่วย publishablePostText ──
test('หน่วย: บางฉบับผ่าน — ค่าเริ่มต้นคืน quarantine เนื้อเต็ม + ICU + provenance · PUBLISH_QUARANTINE=0 = รูปผลเดิมทุกคีย์', async () => {
  const v1 = version(LONG, { promptId: 'card-a' });
  const v2 = version(SHORT_A, { promptId: 'card-b', _sourceLabel: 'มุมสอง', style: 'A2_v1' });
  const fresh = await withEnv(undefined, () => realPublishable.enforceTextNewsPublicationFloor([v1, v2], { minimumWords: 146 }));
  assert.equal(fresh.unit, 'thai_icu_word');
  assert.deepEqual(fresh.passingVersions, [v1]);
  assert.deepEqual(fresh.quarantinedVersions, [v2]);
  assert.deepEqual(fresh.quarantine, {
    stage: 'length', publishable: false, unit: 'thai_icu_word', minimumWords: 146,
    versions: [{ version: 2, wordCount: 131, title: 'พาดหัว card-b', content: SHORT_A, promptId: 'card-b', usedModel: 'claude-opus-5-5', _source: 'classic', _sourceLabel: 'มุมสอง', style: 'A2_v1' }],
  });
  assert.equal(fresh.quarantine.versions[0].wordCount, realPublishable.countPublishableThaiWords(v2), 'หน่วยเดียวกับตัวนับด่านท้าย');

  const legacy = await withEnv('0', () => realPublishable.enforceTextNewsPublicationFloor([v1, v2], { minimumWords: 146 }));
  assert.deepEqual(Object.keys(legacy), ['status', 'publishable', 'minimumWords', 'checks', 'quarantinedVersions', 'passingVersions']);
  assert.equal(await withEnv('0', () => realPublishable.buildQuarantineSnapshot([v2], { stage: 'length' })), null);
});

test('หน่วย: ศูนย์ฉบับผ่าน — ค่าเริ่มต้น error พก quarantine (non-enumerable) · lengthGate ไม่มีเนื้อ · ข้อความไม่อ้างว่า "กักผลไว้" · เดิม = ข้อความเดิมทุกไบต์', async () => {
  const shorts = [version(SHORT_A), version(SHORT_B, { promptId: 'card-b' })];
  const freshError = await withEnv(undefined, () => {
    try { realPublishable.enforceTextNewsPublicationFloor(shorts, { minimumWords: 146 }); } catch (error) { return error; }
    return null;
  });
  assert.equal(freshError?.errorType, 'TEXT_NEWS_LENGTH_REVIEW_REQUIRED');
  assert.equal(JSON.stringify(freshError.lengthGate).includes('content'), false, 'lengthGate บน error ห้ามพาเนื้อ');
  assert.equal(Object.keys(freshError).includes('quarantine'), false, 'quarantine ต้องไม่ enumerable (กันหลุดตอน spread/serialize)');
  assert.deepEqual(freshError.quarantine.versions.map(item => [item.version, item.wordCount, item.content]), [[1, 131, SHORT_A], [2, 120, SHORT_B]]);
  assert.doesNotMatch(freshError.message, /กักผลไว้/u);
  assert.match(freshError.message, /^ไม่มีฉบับที่ยาวถึงขั้นต่ำ 146 คำ \(นับคำไทยแบบ ICU: V1 131 คำ, V2 120 คำ\) — ไม่เผยแพร่ ไม่เติมคำ และไม่เรียก AI ซ้ำ$/u);

  const legacyError = await withEnv('legacy', () => {
    try { realPublishable.enforceTextNewsPublicationFloor(shorts, { minimumWords: 146 }); } catch (error) { return error; }
    return null;
  });
  assert.equal(legacyError.message, 'ไม่มีฉบับที่ยาวถึงขั้นต่ำ 146 คำ ระบบกักผลไว้โดยไม่เติมคำหรือเรียก AI ซ้ำ');
  assert.equal(legacyError.quarantine, undefined);
  assert.deepEqual(Object.keys(legacyError.lengthGate), ['status', 'publishable', 'minimumWords', 'checks', 'quarantinedVersions']);
});

test('หน่วย: versionNumbers = เลขฉบับเดิม (ค่าเริ่มต้น) · ค่าไม่ครบ/ผิดรูป = index+1 · โหมดเดิมไม่อ่าน', async () => {
  const list = [version(LONG), version(SHORT_A)];
  const fresh = await withEnv(undefined, () => realPublishable.enforceTextNewsPublicationFloor(list, { minimumWords: 146, versionNumbers: [2, 3] }));
  assert.deepEqual(fresh.checks.map(check => check.version), [2, 3]);
  assert.deepEqual(fresh.quarantine.versions.map(item => item.version), [3]);
  const invalid = await withEnv(undefined, () => realPublishable.enforceTextNewsPublicationFloor(list, { minimumWords: 146, versionNumbers: [2] }));
  assert.deepEqual(invalid.checks.map(check => check.version), [1, 2]);
  const legacy = await withEnv('0', () => realPublishable.enforceTextNewsPublicationFloor(list, { minimumWords: 146, versionNumbers: [2, 3] }));
  assert.deepEqual(legacy.checks.map(check => check.version), [1, 2]);
});

test('สวิตช์ PUBLISH_QUARANTINE: ไม่ตั้ง/1/on/ค่าอื่น = ใหม่ · 0/legacy/off/false/no (ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = เดิม', () => {
  for (const value of [undefined, '', '1', 'on', 'true', 'yes', 'x']) {
    assert.equal(realPublishable.isPublishQuarantineOn({ PUBLISH_QUARANTINE: value }), true, String(value));
  }
  for (const value of ['0', ' 0', '"0"', 'legacy', 'Legacy', 'off', 'OFF', 'false', 'no']) {
    assert.equal(realPublishable.isPublishQuarantineOn({ PUBLISH_QUARANTINE: value }), false, String(value));
  }
});

// ── (2) ท่อนจริง autoFlow ──
test('ท่อน autoFlow: บางฉบับสั้น — ค่าเริ่มต้นเก็บร่างใน analysisResult.lengthGate.quarantine (ถึงเคสผ่าน saveAnalysis) · versions/summary ไม่มีร่าง · เดิม = ทิ้งเงียบ', async () => {
  const input = [version(LONG, { promptId: 'card-a' }), version(SHORT_A, { promptId: 'card-b' })];
  const fresh = await withEnv(undefined, () => runSegment({ versions: input }));
  assert.equal(fresh.ok, true, fresh.error?.message);
  assert.deepEqual(fresh.analysisResult.versions.map(v => v.promptId), ['card-a']);
  assert.doesNotMatch(JSON.stringify(fresh.analysisResult.versions) + fresh.analysisResult.summary, /สั้น1 /u, 'ร่างที่ถูกกักห้ามปนฉบับโพสต์');
  assert.equal(fresh.analysisResult.lengthGate.quarantine.versions[0].content, SHORT_A, 'ร่างที่ถูกกักต้องถูกเก็บจริง');
  assert.equal(fresh.analysisResult.lengthGate.unit, 'thai_icu_word');
  assert.ok(fresh.analysisResult.qualityWarnings.some(w => w.includes('V2 (131 คำ)') && w.includes('lengthGate.quarantine')), JSON.stringify(fresh.analysisResult.qualityWarnings));

  const legacy = await withEnv('0', () => runSegment({ versions: input }));
  assert.equal(legacy.ok, true);
  assert.deepEqual(Object.keys(legacy.analysisResult.lengthGate), ['status', 'publishable', 'minimumWords', 'checks', 'quarantinedVersions']);
  assert.equal(JSON.stringify(legacy.analysisResult).includes(SHORT_A.slice(0, 30)), false, 'บั๊กเดิม: ร่างที่ "กัก" หายไม่มีที่เก็บ');
  assert.ok(legacy.analysisResult.qualityWarnings.includes('กักฉบับหลังตรวจที่สั้นกว่าขั้นต่ำ 146 คำ: V2 (131 คำ) · ส่งเฉพาะ 1 ฉบับที่ผ่าน โดยไม่เติมคำหรือเรียก AI ซ้ำ'));
});

async function assertLengthReviewStored(result, label = '') {
  assert.equal(result.ok, false, label);
  assert.equal(result.error.errorType, 'TEXT_NEWS_LENGTH_REVIEW_REQUIRED', label);
  assert.equal(result.saves.length, 1, `${label}: ต้องบันทึกสถานะรอตรวจพร้อมร่างหนึ่งครั้ง`);
  const { id, diagnostic } = result.saves[0];
  assert.equal(id, 'unify_pl14');
  assert.equal(diagnostic.status, 'length_review');
  assert.equal(diagnostic.publishable, false);
  assert.deepEqual(diagnostic.quarantine.versions.map(item => [item.version, item.content]), [[1, SHORT_A], [2, SHORT_B]]);
  assert.equal(result.error.lengthGate.quarantineStored, true);
  assert.match(result.error.message, /เก็บร่างที่ถูกกัก V1, V2 ไว้ในเคส workflow unify_pl14 \(สถานะ length_review\) ให้พนักงานดู\/กู้ได้$/u);
  assert.doesNotMatch(result.error.message, /กักผลไว้/u);
}

test('ท่อน autoFlow: ทุกฉบับสั้น — ค่าเริ่มต้นเก็บร่างลงเคส (length_review) ก่อนโยน + ข้อความบอกที่เก็บ · เดิม = โยนเฉยๆ ไม่มีอะไรถูกเก็บ', async () => {
  const input = [version(SHORT_A), version(SHORT_B, { promptId: 'card-b' })];
  await assertLengthReviewStored(await withEnv(undefined, () => runSegment({ versions: input })));

  const legacy = await withEnv('0', () => runSegment({ versions: input }));
  assert.equal(legacy.ok, false);
  assert.equal(legacy.error.errorType, 'TEXT_NEWS_LENGTH_REVIEW_REQUIRED');
  assert.equal(legacy.saves.length, 0, 'บั๊กเดิม: ไม่มีการเก็บร่าง');
  assert.equal(legacy.error.message, 'ไม่มีฉบับที่ยาวถึงขั้นต่ำ 146 คำ ระบบกักผลไว้โดยไม่เติมคำหรือเรียก AI ซ้ำ', 'บั๊กเดิม: ข้อความอ้างว่ากักไว้');
});

test('ท่อน autoFlow: ทุกฉบับสั้น + บันทึกเคสล้ม → ข้อความบอกตามจริงว่าเก็บไม่สำเร็จ · เส้นตายระหว่างบันทึก → โยนเส้นตายเดิม', async () => {
  const input = [version(SHORT_A), version(SHORT_B, { promptId: 'card-b' })];
  const failed = await withEnv(undefined, () => runSegment({ versions: input, save: async () => { throw new Error('db down'); } }));
  assert.equal(failed.error.errorType, 'TEXT_NEWS_LENGTH_REVIEW_REQUIRED');
  assert.equal(failed.error.lengthGate.quarantineStored, false);
  assert.match(failed.error.message, /เก็บร่างที่ถูกกักไม่สำเร็จ \(บันทึกสถานะ factual_review ไม่สำเร็จ: db down\) — ร่างยังไม่ถูกเก็บ$/u);
  const deadline = new PipelineDeadlineError('factual_review_persist');
  const late = await withEnv(undefined, () => runSegment({ versions: input, save: async () => { throw deadline; } }));
  assert.strictEqual(late.error, deadline);
});

test('ท่อน autoFlow: ด่านข้อเท็จจริงกัก V1 + ด่านความยาวกัก V3 — ร่างทั้งสองถูกเก็บ · เลขฉบับตรงของเดิม (V2/V3 ไม่ใช่ V1/V2) · เดิม = เลขเลื่อน/ไม่เก็บ', async () => {
  const input = [version(LONG, { promptId: 'card-a' }), version(LONG, { promptId: 'card-b' }), version(SHORT_A, { promptId: 'card-c' })];
  const fresh = await withEnv(undefined, () => runSegment({ versions: input, factGate: { failing: [0] } }));
  assert.equal(fresh.ok, true, fresh.error?.message);
  assert.deepEqual(fresh.analysisResult.versions.map(v => v.promptId), ['card-b']);
  assert.deepEqual(fresh.textLengthGateSummary.checks.map(c => [c.version, c.passes]), [[2, true], [3, false]]);
  assert.deepEqual(fresh.textLengthGateSummary.quarantine.versions.map(v => [v.version, v.promptId]), [[3, 'card-c']]);
  assert.deepEqual(fresh.factualGateSummary.quarantine.versions.map(v => [v.version, v.promptId]), [[1, 'card-a']]);
  assert.match(fresh.factualGateSummary.quarantine.versions[0].content, /\[editor\]$/u, 'เก็บเนื้อหลัง editor = เนื้อที่ auditor ตีตกจริง');
  assert.ok(fresh.analysisResult.qualityWarnings.some(w => w.includes('V3 (131 คำ)')), JSON.stringify(fresh.analysisResult.qualityWarnings));
  assert.ok(fresh.analysisResult.qualityWarnings.some(w => w.startsWith('Sol กักฉบับที่ไม่ผ่านข้อเท็จจริง V1') && w.includes('factualGate.quarantine')));

  const legacy = await withEnv('0', () => runSegment({ versions: input, factGate: { failing: [0] } }));
  assert.deepEqual(legacy.textLengthGateSummary.checks.map(c => c.version), [1, 2], 'บั๊กเดิม: เลขฉบับเลื่อนหลังด่านข้อเท็จจริง');
  assert.equal('quarantine' in legacy.factualGateSummary, false);
  assert.deepEqual(Object.keys(legacy.factualGateSummary), ['status', 'model', 'contextHash', 'editorModel', 'repairedVersions', 'quarantinedVersions', 'diagnostics']);
});

test('ท่อน autoFlow: ด่านข้อเท็จจริงกักทุกฉบับ — ค่าเริ่มต้นร่างถึง saveFactualReview + ข้อความบอกที่เก็บ · เดิม = diagnostics ล้วน + ข้อความเดิม', async () => {
  const input = [version(LONG, { promptId: 'card-a' }), version(LONG, { promptId: 'card-b' })];
  const fresh = await withEnv(undefined, () => runSegment({ versions: input, factGate: { failing: [0, 1] } }));
  assert.equal(fresh.error.errorType, 'FACTUAL_REVIEW_REQUIRED');
  assert.equal(fresh.saves.length, 1);
  assert.equal(fresh.saves[0].diagnostic.status, 'factual_review');
  assert.deepEqual(fresh.saves[0].diagnostic.quarantine.versions.map(v => v.version), [1, 2]);
  assert.match(fresh.error.message, /^ไม่มีฉบับที่ผ่านด่านข้อเท็จจริง — เก็บร่างที่ถูกกัก V1, V2 ไว้ในเคส workflow unify_pl14 \(สถานะ factual_review\)/u);

  const legacy = await withEnv('0', () => runSegment({ versions: input, factGate: { failing: [0, 1] } }));
  assert.equal(legacy.error.message, 'ไม่มีฉบับที่ผ่านด่านข้อเท็จจริง เนื้อข่าวถูกกักไว้ให้ตรวจและไม่ถูกส่งออก');
  assert.equal('quarantine' in legacy.saves[0].diagnostic, false);
});

test('mutation: ตัดการแนบ quarantine / ตัดการบันทึก length_review / ถอดเลขฉบับเดิม แล้วข้อสอบต้องแดง', async () => {
  const shorts = [version(SHORT_A), version(SHORT_B, { promptId: 'card-b' })];
  // M1 publishablePostText: ไม่แนบ quarantine บน error → autoFlow ไม่มีอะไรให้เก็บ
  const m1Source = PUBLISHABLE_SOURCE.replace("    Object.defineProperty(reviewError, 'quarantine', {", "    void ({");
  assert.notEqual(m1Source, PUBLISHABLE_SOURCE, 'สร้าง M1 ไม่ได้');
  const m1 = await importData(m1Source, 'pl14-m1');
  await assert.rejects(withEnv(undefined, async () => assertLengthReviewStored(await runSegment({ versions: shorts, publishable: m1 }), 'M1')));
  // M2 autoFlow: ตัดการบันทึก length_review (เหลือแค่โยน)
  const m2Source = AUTO_FLOW_SOURCE.replace(
    "      if (lengthError?.errorType === 'TEXT_NEWS_LENGTH_REVIEW_REQUIRED' && lengthError.quarantine) {",
    '      if (false) {',
  );
  assert.notEqual(m2Source, AUTO_FLOW_SOURCE, 'สร้าง M2 ไม่ได้');
  await assert.rejects(withEnv(undefined, async () => assertLengthReviewStored(await runSegment({ versions: shorts, source: m2Source }), 'M2')));
  // M3 autoFlow: ถอดการส่งเลขฉบับเดิม → เลขเลื่อนกลับเป็นบั๊กเดิม
  const m3Source = AUTO_FLOW_SOURCE.replace(
    '        ...(lengthGateVersionNumbers ? { versionNumbers: lengthGateVersionNumbers } : {}),',
    '',
  );
  assert.notEqual(m3Source, AUTO_FLOW_SOURCE, 'สร้าง M3 ไม่ได้');
  const input = [version(LONG, { promptId: 'card-a' }), version(LONG, { promptId: 'card-b' }), version(SHORT_A, { promptId: 'card-c' })];
  const m3 = await withEnv(undefined, () => runSegment({ versions: input, factGate: { failing: [0] }, source: m3Source }));
  assert.notDeepEqual(m3.textLengthGateSummary.checks.map(c => c.version), [2, 3], 'M3 ต้องทำให้เลขฉบับผิด (ข้อสอบเลขฉบับกัดจริง)');
});
