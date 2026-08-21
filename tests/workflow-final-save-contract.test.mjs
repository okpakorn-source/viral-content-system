// Production-coupled contract for the authoritative raw-news workflow snapshot.
// In-memory only: no AI, HTTP, Supabase, server, or external writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublishableAnalysisResult } from '../src/lib/utils/publishablePostText.js';

const TESTS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(TESTS, '..');
const autoFlowPath = join(ROOT, 'src', 'lib', 'services', 'autoFlowServiceText.js');
const workflowPath = join(ROOT, 'src', 'lib', 'workflow', 'workflowEngine.js');
const autoFlowSource = readFileSync(autoFlowPath, 'utf8').replace(/\r\n/g, '\n');
const workflowSource = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function makeFinalSnapshotRunner(source = autoFlowSource) {
  const start = source.indexOf('  // === WORKFLOW FINAL SNAPSHOT ===');
  const end = source.indexOf('  // === GENERATION LOG:', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบบล็อก final workflow snapshot จริง');
  const block = source.slice(start, end);
  return new AsyncFunction(
    'primaryResult', 'aggregateUsedModel', 'usedModels', 'finalVersions', 'allVersions',
    'totalResearchItems', 'diversityWarning', 'pipelineQualityWarnings', 'factualGateSummary',
    'usedPreset', 'anglePrompts', '_autoWorkflowId',
    'buildPublishableAnalysisResult', 'saveAnalysis', 'throwStep', 'addLog', 'getActivePipelineDeadline', 'rethrowPipelineDeadline',
    `${block}\nreturn { analysisResult, finalPresetId, finalWorkflowSave };`,
  );
}

function assertFinalSnapshotOrder(source = autoFlowSource) {
  assert.match(source, /import \{ saveAnalysis, saveFactualReview \} from '@\/lib\/workflow\/workflowEngine';/);
  const correction = source.indexOf('  // === POST-GENERATION CORRECTION PIPELINE ===');
  const grounding = source.indexOf('  let grounding = assessRawTextSafety(', correction);
  const diversity = source.indexOf('  const diversity = assessVersionDiversity(finalVersions);', grounding);
  const snapshot = source.indexOf('  // === WORKFLOW FINAL SNAPSHOT ===', diversity);
  const analysisDeclaration = source.indexOf('  const analysisResult = buildPublishableAnalysisResult({', snapshot);
  const save = source.indexOf('finalWorkflowSave = await saveAnalysis(', snapshot);
  const generationLog = source.indexOf('const generationLogAttempt =', snapshot);
  const response = source.indexOf('  return {', generationLog);
  assert.ok(correction >= 0 && grounding > correction && diversity > grounding
    && snapshot > diversity && analysisDeclaration > snapshot && save > analysisDeclaration
    && generationLog > save && response > generationLog,
  'ลำดับต้องเป็น correction → grounding/diversity → final workflow save → Generation Log → response');
  assert.equal((source.match(/finalWorkflowSave = await saveAnalysis\(/g) || []).length, 1,
    'autoFlow ต้องมี authoritative final save เพียงครั้งเดียว');
  assert.match(source.slice(response), /data:\s*\{[\s\S]*?analysisResult,/,
    'response ต้องใช้ analysisResult ก้อนเดียวกับที่บันทึก');
  assert.doesNotMatch(
    source.slice(save, response),
    /(?:^|\r?\n)\s*analysisResult\s*=/,
    'หลังบันทึกแล้วห้ามสร้าง analysisResult ก้อนใหม่ก่อนส่งกลับ',
  );
}

function makeActualSaveAnalysis(prisma, source = workflowSource) {
  const start = source.indexOf('export async function saveAnalysis(');
  const end = source.indexOf('export async function saveFactualReview(', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบ saveAnalysis ตัวจริง');
  const declaration = source.slice(start, end).replace('export async function', 'async function');
  return new Function('prisma', `${declaration}; return saveAnalysis;`)(prisma);
}

function makeInputs(overrides = {}) {
  return {
    primaryResult: { debug: { kept: true } },
    aggregateUsedModel: 'mixed',
    usedModels: ['claude-fable-5', 'gpt-5.6-sol'],
    finalVersions: [
      { title: 'FINAL A', content: 'FINAL CONTENT A', usedModel: 'claude-fable-5' },
      { title: 'FINAL B', content: 'FINAL CONTENT B', usedModel: 'gpt-5.6-sol' },
    ],
    allVersions: [{ title: 'STALE A' }, { title: 'STALE B' }],
    totalResearchItems: [{ id: 'r1' }, { id: 'r2' }],
    diversityWarning: 'V1/V2 ยังคล้ายกัน — ให้พนักงานอ่านเลือก',
    pipelineQualityWarnings: [
      'Correction V1 ล้ม — ใช้ร่างนักเขียนเดิมและส่งเข้าด่าน RAW เต็ม',
      'V1 เพิ่มปริมาณน้ำหนึ่งแก้ว — ให้พนักงานตรวจบริบทก่อนโพสต์',
      'V1/V2 ยังคล้ายกัน — ให้พนักงานอ่านเลือก',
    ],
    factualGateSummary: { model: 'gpt-5.6-sol', regeneratedVersions: [1] },
    usedPreset: { promptId: 'prompt-final', id: 'library' },
    anglePrompts: [{ id: 'prompt-angle' }],
    workflowId: 'unify-job-final',
    ...overrides,
  };
}

async function executeFinalSnapshot(source = autoFlowSource, overrides = {}) {
  const values = makeInputs(overrides);
  const saves = [];
  const logs = [];
  const throwStep = (failedStep, message) => {
    const error = new Error(message);
    error.failedStep = failedStep;
    throw error;
  };
  const saveAnalysis = overrides.saveAnalysis || (async (...args) => {
    saves.push(args);
    return { id: args[0] };
  });
  const deadlineChecks = [];
  const getActivePipelineDeadline = () => ({
    throwIfExpired(step) { deadlineChecks.push(step); },
  });
  const rethrowPipelineDeadline = (error) => {
    if (error?.errorType === 'PIPELINE_DEADLINE_EXCEEDED') throw error;
  };
  const result = await makeFinalSnapshotRunner(source)(
    values.primaryResult, values.aggregateUsedModel, values.usedModels,
    values.finalVersions, values.allVersions, values.totalResearchItems,
    values.diversityWarning, values.pipelineQualityWarnings, values.factualGateSummary,
    values.usedPreset, values.anglePrompts, values.workflowId,
    buildPublishableAnalysisResult, saveAnalysis, throwStep, (...args) => logs.push(args), getActivePipelineDeadline,
    rethrowPipelineDeadline,
  );
  return { result, saves, logs, values, deadlineChecks };
}

async function assertSnapshotRetention(source = autoFlowSource) {
  assertFinalSnapshotOrder(source);
  const run = await executeFinalSnapshot(source);
  assert.equal(run.saves.length, 1);
  assert.strictEqual(run.saves[0][1], run.result.analysisResult);
  assert.strictEqual(run.result.analysisResult.versions, run.values.finalVersions);
  assert.deepEqual(run.result.analysisResult.usedModels, run.values.usedModels);
  assert.equal(run.result.analysisResult.usedModel, run.values.aggregateUsedModel);
  assert.strictEqual(run.result.analysisResult.researchItems, run.values.totalResearchItems);
  assert.deepEqual(run.result.analysisResult.qualityWarnings, run.values.pipelineQualityWarnings);
  assert.strictEqual(run.result.analysisResult.factualGate, run.values.factualGateSummary);
  assert.deepEqual(run.deadlineChecks, ['final_workflow_persist', 'final_workflow_persist']);
  return run;
}

test('final workflow snapshot: เก็บทุกฉบับหลังแก้และใช้ object เดียวกัน', async () => {
  const { result, saves, values } = await assertSnapshotRetention();
  assert.equal(saves.length, 1);
  assert.equal(saves[0][0], values.workflowId);
  assert.notStrictEqual(result.analysisResult.versions, values.allVersions);
  assert.deepEqual(result.analysisResult.versions.map(v => v.title), ['FINAL A', 'FINAL B']);
  assert.equal(result.analysisResult.usedModel, 'mixed');
  assert.deepEqual(result.analysisResult.usedModels, ['claude-fable-5', 'gpt-5.6-sol']);
  assert.equal(saves[0][2], 'prompt-final');
});

test('workflowEngine.saveAnalysis ตัวจริง: เขียน analyzed + exact JSON + preset และส่ง null/error กลับ', async () => {
  const calls = [];
  const update = async args => {
    calls.push(args);
    return { id: args.where.id, ...args.data };
  };
  const saveAnalysis = makeActualSaveAnalysis({ workflowRun: { update } });
  const payload = { versions: [{ title: 'A' }, { title: 'B' }], usedModels: ['m1', 'm2'] };
  const saved = await saveAnalysis('unify-actual', payload, 'prompt-actual');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    where: { id: 'unify-actual' },
    data: {
      currentStep: 'analyzed',
      analysisResult: JSON.stringify(payload),
      presetUsed: 'prompt-actual',
    },
  });
  assert.equal(saved.currentStep, 'analyzed');

  const returnsNull = makeActualSaveAnalysis({ workflowRun: { update: async () => null } });
  assert.equal(await returnsNull('unify-null', payload, 'p'), null);
  const throws = makeActualSaveAnalysis({
    workflowRun: { update: async () => { throw new Error('database unavailable'); } },
  });
  await assert.rejects(throws('unify-error', payload, 'p'), /database unavailable/);
});

test('final workflow snapshot: update คืน null ต้อง fail ก่อน Generation Log', async () => {
  await assert.rejects(
    executeFinalSnapshot(autoFlowSource, { saveAnalysis: async () => null }),
    error => error?.failedStep === 'auto_workflow_persist' && /ไม่พบแถว workflow/.test(error.message),
  );
});

test('final workflow snapshot: update โยน error ต้องคง failedStep ที่ชัดเจน', async () => {
  await assert.rejects(
    executeFinalSnapshot(autoFlowSource, {
      saveAnalysis: async () => { throw new Error('database unavailable'); },
    }),
    error => error?.failedStep === 'auto_workflow_persist' && /database unavailable/.test(error.message),
  );
});

test('final workflow snapshot: deadline ระหว่าง save ต้องคงชนิด 504 ไว้ ไม่แปลงเป็น persist error', async () => {
  const error = new Error('deadline');
  error.errorType = 'PIPELINE_DEADLINE_EXCEEDED';
  error.failedStep = 'pipeline_deadline';
  error.deadlineStep = 'final_workflow_persist';
  await assert.rejects(
    executeFinalSnapshot(autoFlowSource, { saveAnalysis: async () => { throw error; } }),
    caught => caught === error,
  );
});

test('mutations: ใช้ฉบับก่อนแก้ ถอด save หรือย้าย save หลัง log ต้องถูกจับ', async () => {
  const staleVersions = autoFlowSource.replace(
    '    usedModels,\n    versions: finalVersions,',
    '    usedModels,\n    versions: allVersions,',
  );
  assert.notEqual(staleVersions, autoFlowSource);
  await assert.rejects(assertSnapshotRetention(staleVersions));

  const lostResearch = autoFlowSource.replace(
    '    researchItems: totalResearchItems,',
    '    researchItems: [],',
  );
  assert.notEqual(lostResearch, autoFlowSource);
  await assert.rejects(assertSnapshotRetention(lostResearch));

  const lostWarning = autoFlowSource.replace(
    '    qualityWarnings: [...new Set(pipelineQualityWarnings.filter(Boolean))],',
    '    qualityWarnings: [],',
  );
  assert.notEqual(lostWarning, autoFlowSource);
  await assert.rejects(assertSnapshotRetention(lostWarning));

  const lostFactualGate = autoFlowSource.replace(
    '    factualGate: factualGateSummary,',
    '    factualGate: null,',
  );
  assert.notEqual(lostFactualGate, autoFlowSource);
  await assert.rejects(assertSnapshotRetention(lostFactualGate));

  const lostModels = autoFlowSource.replace(
    '    usedModels,',
    "    usedModels: ['claude-fable-5'],",
  );
  assert.notEqual(lostModels, autoFlowSource);
  await assert.rejects(assertSnapshotRetention(lostModels));

  const removedSave = autoFlowSource.replace(
    'finalWorkflowSave = await saveAnalysis(_autoWorkflowId, analysisResult, finalPresetId);',
    'finalWorkflowSave = await Promise.resolve({ id: _autoWorkflowId });',
  );
  assert.notEqual(removedSave, autoFlowSource);
  assert.throws(() => assertFinalSnapshotOrder(removedSave));

  const saveLine = '    finalWorkflowSave = await saveAnalysis(_autoWorkflowId, analysisResult, finalPresetId);';
  const movedSave = autoFlowSource
    .replace(saveLine, '    finalWorkflowSave = { id: _autoWorkflowId };')
    .replace(
      "  addLog('GenLog', `📋 บันทึก Generation Log สำเร็จ (${generationLogResult.caseId})`);",
      "  addLog('GenLog', `📋 บันทึก Generation Log สำเร็จ (${generationLogResult.caseId})`);\n" + saveLine,
    );
  assert.notEqual(movedSave, autoFlowSource);
  assert.throws(() => assertFinalSnapshotOrder(movedSave));

  const commentedSave = autoFlowSource.replace(
    '    finalWorkflowSave = await saveAnalysis(_autoWorkflowId, analysisResult, finalPresetId);',
    '    // finalWorkflowSave = await saveAnalysis(_autoWorkflowId, analysisResult, finalPresetId);',
  );
  assert.notEqual(commentedSave, autoFlowSource);
  await assert.rejects(assertSnapshotRetention(commentedSave));

  const removedDeadlineGuard = autoFlowSource.replace(
    "  getActivePipelineDeadline()?.throwIfExpired('final_workflow_persist');",
    '  void 0;',
  );
  assert.notEqual(removedDeadlineGuard, autoFlowSource);
  await assert.rejects(assertSnapshotRetention(removedDeadlineGuard));

  const rebuiltResponse = autoFlowSource.replace(
    '      analysisResult,',
    '      analysisResult: { ...analysisResult },',
  );
  assert.notEqual(rebuiltResponse, autoFlowSource);
  assert.throws(() => assertFinalSnapshotOrder(rebuiltResponse));

  const reassignedAfterLog = autoFlowSource
    .replace('  const analysisResult = {', '  let analysisResult = {')
    .replace(
      "  addLog('GenLog', `📋 บันทึก Generation Log สำเร็จ (${generationLogResult.caseId})`);",
      "  addLog('GenLog', `📋 บันทึก Generation Log สำเร็จ (${generationLogResult.caseId})`);\n  analysisResult = { ...analysisResult };",
    );
  assert.notEqual(reassignedAfterLog, autoFlowSource);
  assert.throws(() => assertFinalSnapshotOrder(reassignedAfterLog));
});
