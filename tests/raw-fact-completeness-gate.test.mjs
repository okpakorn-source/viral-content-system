import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  auditRawFactCompleteness,
  buildRawFactBlocks,
  enforceRawFactCompleteness,
  isRawFactCompletenessGateEnabled,
  parseSolAuditorResponse,
  parseSolFactEditorResponse,
  persistFactualReviewOrThrow,
  rawFactContextHash,
  repairRawFactContents,
} from '../src/lib/services/rawFactCompletenessGate.js';
import {
  buildPublishableAnalysisResult,
  countFinalVersionSources,
  getPublishablePostText,
  resolveFinalUsedPreset,
} from '../src/lib/utils/publishablePostText.js';

const versions = [
  { title: 'พาดหัวหนึ่ง', hook: 'ฮุกหนึ่ง', content: 'ย่อหน้าแรกของฉบับหนึ่ง\n\nย่อหน้าสองของฉบับหนึ่ง', closing: 'ปิดหนึ่ง', usedModel: 'claude-fable-5', promptId: 'card-a' },
  { title: 'พาดหัวสอง', hook: 'ฮุกสอง', content: 'ย่อหน้าแรกของฉบับสอง\n\nย่อหน้าสองของฉบับสอง', closing: 'ปิดสอง', usedModel: 'claude-fable-5', promptId: 'card-b' },
];

function cleanAudit(candidateVersions, model = 'gpt-5.6-sol') {
  return {
    ok: true,
    issues: [],
    missingFacts: [],
    failingVersionIndexes: [],
    contextHash: rawFactContextHash('RAW ข่าวจริง', candidateVersions),
    model,
  };
}

test('ด่าน Sol เปิดปกติและมีสวิตช์ฉุกเฉิน', () => {
  const before = process.env.RAW_FACT_COMPLETENESS_GATE;
  try {
    delete process.env.RAW_FACT_COMPLETENESS_GATE;
    assert.equal(isRawFactCompletenessGateEnabled(), true);
    process.env.RAW_FACT_COMPLETENESS_GATE = '0';
    assert.equal(isRawFactCompletenessGateEnabled(), false);
  } finally {
    if (before === undefined) delete process.env.RAW_FACT_COMPLETENESS_GATE;
    else process.env.RAW_FACT_COMPLETENESS_GATE = before;
  }
});

test('publish contract ใช้ content เดียวกัน และ metadata ไม่ทำให้ audit/hash เปลี่ยน', () => {
  assert.equal(getPublishablePostText({ content: '  เนื้อโพสต์  ' }), 'เนื้อโพสต์');
  assert.deepEqual(buildRawFactBlocks(versions).map(block => block.id), [
    'V1:P1', 'V1:P2', 'V2:P1', 'V2:P2',
  ]);
  const metadataMutant = versions.map(version => ({
    ...version,
    title: `แต่ง ${version.title}`,
    hook: `แต่ง ${version.hook}`,
    closing: `แต่ง ${version.closing}`,
  }));
  assert.equal(rawFactContextHash('RAW ข่าวจริง', versions), rawFactContextHash('RAW ข่าวจริง', metadataMutant));
  assert.notEqual(
    rawFactContextHash('RAW ข่าวจริง', versions),
    rawFactContextHash('RAW ข่าวจริง', [{ ...versions[0], content: 'เปลี่ยนเนื้อโพสต์' }, versions[1]]),
  );
});

test('auditor เห็น RAW เต็มและเฉพาะทุกย่อหน้าที่พนักงานโพสต์', async () => {
  const raw = `RAW_HEAD\n${'ก'.repeat(12500)}\nRAW_TAIL_AFTER_12000`;
  let capturedPrompt = '';
  const outcome = await auditRawFactCompleteness({
    rawText: raw,
    versions,
    invoke: async ({ prompt, contextHash, blocks, model }) => {
      capturedPrompt = prompt;
      return {
        model,
        value: {
          contextHash,
          blocks: blocks.map(block => ({ id: block.id, issues: [] })),
          missingFacts: versions.map((_, versionIndex) => ({ versionIndex, items: [] })),
        },
      };
    },
  });
  assert.equal(outcome.ok, true);
  assert.match(capturedPrompt, /RAW_TAIL_AFTER_12000/u);
  assert.match(capturedPrompt, /สำนวนสวยและอุปมาที่ไม่เพิ่มใจความใหม่ให้ผ่าน/u);
  assert.doesNotMatch(capturedPrompt, /พาดหัวหนึ่ง|ฮุกหนึ่ง|ปิดหนึ่ง/u);
});

test('auditor/editor ต้องเป็น Sol, stop และ JSON สมบูรณ์', () => {
  const good = model => ({ model, choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  assert.deepEqual(parseSolAuditorResponse(good('gpt-5.6-sol')).value, { ok: true });
  assert.deepEqual(parseSolFactEditorResponse(good('gpt-5.6-sol')).value, { ok: true });
  assert.throws(() => parseSolAuditorResponse(good('gpt-5.6-terra')), /ใช้โมเดลผิด/u);
  assert.throws(() => parseSolFactEditorResponse(good('gpt-5.6-terra')), /ใช้โมเดลผิด/u);
  assert.throws(() => parseSolFactEditorResponse({ ...good('gpt-5.6-sol'), choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), /จบไม่สมบูรณ์/u);
});

test('สองฉบับผิดถูกส่งให้ Sol editor ครั้งเดียว โดยคง Fable provenance และ metadata', async () => {
  const contextHash = rawFactContextHash('RAW ข่าวจริง', versions);
  let calls = 0;
  let captured = '';
  const replacements = await repairRawFactContents({
    rawText: 'RAW ข่าวจริง',
    versions,
    failingVersionIndexes: [0, 1],
    issues: [
      { versionIndex: 0, original: 'ฉบับหนึ่ง', reasonCode: 'UNSUPPORTED_FACT', reason: 'RAW ไม่มี' },
      { versionIndex: 1, original: 'ฉบับสอง', reasonCode: 'AGENCY', reason: 'เพิ่มผู้กระทำ' },
    ],
    missingFacts: [],
    contextHash,
    invoke: async ({ prompt, model, requestedIndexes }) => {
      calls += 1;
      captured = prompt;
      assert.equal(model, 'gpt-5.6-sol');
      assert.deepEqual(requestedIndexes, [0, 1]);
      return {
        model,
        value: {
          contextHash,
          versions: [
            { versionIndex: 0, content: 'เนื้อหนึ่งที่แก้แล้ว' },
            { versionIndex: 1, content: 'เนื้อสองที่แก้แล้ว' },
          ],
        },
      };
    },
  });
  assert.equal(calls, 1);
  assert.match(captured, /รักษามุม จังหวะ และสำนวนที่ไม่เพิ่มข้อเท็จจริง/u);
  assert.equal(replacements[0].version.content, 'เนื้อหนึ่งที่แก้แล้ว');
  assert.equal(replacements[0].version.usedModel, 'claude-fable-5');
  assert.equal(replacements[0].version.promptId, 'card-a');
  assert.equal(replacements[0].version._factualEditorModel, 'gpt-5.6-sol');
});

test('editor response ขาด/เกิน/ซ้ำ/ผิด hash ต้อง fail-closed', async () => {
  const contextHash = rawFactContextHash('RAW ข่าวจริง', versions);
  const run = value => repairRawFactContents({
    rawText: 'RAW ข่าวจริง', versions, failingVersionIndexes: [0, 1], issues: [], missingFacts: [], contextHash,
    invoke: async () => ({ model: 'gpt-5.6-sol', value }),
  });
  await assert.rejects(run({ contextHash: 'wrong', versions: [] }), /contextHash\/versions/u);
  await assert.rejects(run({ contextHash, versions: [{ versionIndex: 0, content: 'x' }] }), /contextHash\/versions/u);
  await assert.rejects(run({ contextHash, versions: [{ versionIndex: 0, content: 'x' }, { versionIndex: 0, content: 'y' }] }), /ผิดลำดับ\/ไม่ครบ/u);
  await assert.rejects(run({ contextHash, versions: [{ versionIndex: 0, content: 'x' }, { versionIndex: 1, content: '' }] }), /ผิดลำดับ\/ไม่ครบ/u);
  await assert.rejects(run({ contextHash, versions: [{ versionIndex: 0, content: 'x' }, { versionIndex: 1, content: 'ย'.repeat(24_001) }] }), /ผิดลำดับ\/ไม่ครบ/u);
});

test('enforcer ไม่รับผลฉบับซ้ำแม้จำนวนรายการครบ', async () => {
  await assert.rejects(enforceRawFactCompleteness({
    rawText: 'RAW ข่าวจริง', versions,
    audit: async ({ versions: candidates }) => ({
      ok: false,
      issues: [],
      missingFacts: [],
      failingVersionIndexes: [0, 1],
      contextHash: rawFactContextHash('RAW ข่าวจริง', candidates),
      model: 'gpt-5.6-sol',
    }),
    repairBatch: async () => [
      { versionIndex: 0, version: { ...versions[0], content: 'แก้ครั้งหนึ่ง' } },
      { versionIndex: 0, version: { ...versions[0], content: 'แก้ซ้ำฉบับเดิม' } },
    ],
  }), /ไม่ครบหรือมีฉบับนอกคำขอ/u);
});

test('ฉบับที่ผ่านครั้งแรกคง object เดิม และ editor ถูกเรียกหนึ่งครั้งเฉพาะฉบับผิด', async () => {
  let auditCalls = 0;
  let editorCalls = 0;
  const outcome = await enforceRawFactCompleteness({
    rawText: 'RAW ข่าวจริง', versions,
    audit: async ({ versions: candidates }) => {
      auditCalls += 1;
      if (auditCalls === 1) return {
        ok: false,
        issues: [{ versionIndex: 0, original: 'ฉบับหนึ่ง', reasonCode: 'UNSUPPORTED_FACT', reason: 'ผิด', scope: 'content' }],
        missingFacts: [], failingVersionIndexes: [0],
        contextHash: rawFactContextHash('RAW ข่าวจริง', candidates), model: 'gpt-5.6-sol',
      };
      return cleanAudit(candidates);
    },
    repairBatch: async ({ failingVersionIndexes }) => {
      editorCalls += 1;
      assert.deepEqual(failingVersionIndexes, [0]);
      return [{ versionIndex: 0, version: { ...versions[0], content: 'ฉบับหนึ่งแก้แล้ว', _factualEditorModel: 'gpt-5.6-sol' } }];
    },
  });
  assert.equal(auditCalls, 2);
  assert.equal(editorCalls, 1);
  assert.strictEqual(outcome.passingVersions[1], versions[1]);
  assert.deepEqual(outcome.repairedIndexes, [0]);
});

test('audit รอบสุดท้าย partition ฉบับผ่าน/กัก โดยไม่เรียก editor รอบสาม', async () => {
  let auditCalls = 0;
  let editorCalls = 0;
  const outcome = await enforceRawFactCompleteness({
    rawText: 'RAW ข่าวจริง', versions,
    audit: async ({ versions: candidates }) => {
      auditCalls += 1;
      return auditCalls === 1
        ? { ok: false, issues: versions.map((_, versionIndex) => ({ versionIndex, original: `V${versionIndex}`, reasonCode: 'UNSUPPORTED_FACT', reason: 'ผิด', scope: 'content' })), missingFacts: [], failingVersionIndexes: [0, 1], contextHash: rawFactContextHash('RAW ข่าวจริง', candidates), model: 'gpt-5.6-sol' }
        : { ok: false, issues: [{ versionIndex: 1, original: 'ยังผิด', reasonCode: 'RELATION', reason: 'ยังผิด', scope: 'content' }], missingFacts: [], failingVersionIndexes: [1], contextHash: rawFactContextHash('RAW ข่าวจริง', candidates), model: 'gpt-5.6-sol' };
    },
    repairBatch: async () => {
      editorCalls += 1;
      return versions.map((version, versionIndex) => ({ versionIndex, version: { ...version, content: `แก้ ${versionIndex}` } }));
    },
  });
  assert.equal(editorCalls, 1);
  assert.equal(auditCalls, 2);
  assert.deepEqual(outcome.passingVersions.map(v => v.content), ['แก้ 0']);
  assert.deepEqual(outcome.quarantinedVersions.map(v => v.content), ['แก้ 1']);
});

test('partial release ใช้จำนวนและการ์ดของฉบับที่รอดจริง', () => {
  const surviving = [{ ...versions[1], _source: 'enhanced' }];
  const presetA = { promptId: 'card-a', promptName: 'การ์ด A' };
  const presetB = { promptId: 'card-b', promptName: 'การ์ด B' };
  assert.deepEqual(countFinalVersionSources(surviving), { classic: 0, enhanced: 1 });
  assert.strictEqual(
    resolveFinalUsedPreset(surviving, new Map([['card-a', presetA], ['card-b', presetB]]), presetA),
    presetB,
  );
});

test('partial release ไม่พา summary/field เนื้อหาของฉบับที่ถูกกักติดผลรวม', () => {
  const safeVersion = { ...versions[1], content: 'SAFE_CONTENT' };
  const result = buildPublishableAnalysisResult({
    primaryResult: {
      summary: 'REJECTED_V1',
      key_points: ['REJECTED_V1'],
      engagement_ending: 'REJECTED_V1',
      news_reference: 'REJECTED_V1',
      versions: [{ ...versions[0], content: 'REJECTED_V1' }],
      emotion: 'อบอุ่น',
      debug: { promptLength: 100 },
    },
    usedPreset: { promptId: 'card-b' },
    usedModel: 'claude-fable-5',
    usedModels: ['claude-fable-5'],
    versions: [safeVersion],
    researchItems: [],
    qualityWarnings: ['กัก V1'],
    factualGate: { status: 'partial', contextHash: 'hash-final' },
  });
  assert.equal(result.summary, 'SAFE_CONTENT');
  assert.deepEqual(result.versions, [safeVersion]);
  assert.equal(result.factualGate.contextHash, 'hash-final');
  assert.doesNotMatch(JSON.stringify(result), /REJECTED_V1/u);
});

test('final audit ไม่ผ่านทั้งคู่ต้องได้ zero publishable โดยไม่วน editor', async () => {
  let auditCalls = 0;
  let editorCalls = 0;
  const outcome = await enforceRawFactCompleteness({
    rawText: 'RAW ข่าวจริง', versions,
    audit: async ({ versions: candidates }) => {
      auditCalls += 1;
      return {
        ok: false,
        issues: candidates.map((_, versionIndex) => ({ versionIndex, original: `ผิด ${versionIndex}`, reasonCode: 'UNSUPPORTED_FACT', reason: 'RAW ไม่รองรับ', scope: 'content' })),
        missingFacts: [], failingVersionIndexes: [0, 1],
        contextHash: rawFactContextHash('RAW ข่าวจริง', candidates), model: 'gpt-5.6-sol',
      };
    },
    repairBatch: async () => {
      editorCalls += 1;
      return versions.map((version, versionIndex) => ({ versionIndex, version: { ...version, content: `ยังผิด ${versionIndex}` } }));
    },
  });
  assert.equal(auditCalls, 2);
  assert.equal(editorCalls, 1);
  assert.deepEqual(outcome.passingVersions, []);
  assert.equal(outcome.quarantinedVersions.length, 2);
});

test('saveFactualReview เก็บเฉพาะ diagnostics และไม่เผยร่างที่ถูกกัก', async () => {
  const workflow = await readFile(new URL('../src/lib/workflow/workflowEngine.js', import.meta.url), 'utf8');
  const start = workflow.indexOf('export async function saveFactualReview(');
  const end = workflow.indexOf('/**', start);
  assert.ok(start >= 0 && end > start);
  const declaration = workflow.slice(start, end).replace('export async function', 'async function');
  const calls = [];
  const saveFactualReview = new Function('prisma', `${declaration}; return saveFactualReview;`)({
    workflowRun: { update: async args => { calls.push(args); return args.data; } },
  });
  const diagnostic = { status: 'factual_review', publishable: false, quarantinedVersions: [1, 2] };
  await saveFactualReview('unify-test', diagnostic);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.currentStep, 'factual_review');
  const saved = JSON.parse(calls[0].data.analysisResult);
  assert.equal(saved.publishable, false);
  assert.deepEqual(saved.versions, []);
  assert.deepEqual(saved.factualGate, diagnostic);
  assert.doesNotMatch(calls[0].data.analysisResult, /ย่อหน้าแรกของฉบับ/u);
});

test('factual_review persistence แยก DB failure และคง typed deadline', async () => {
  const diagnostic = { status: 'factual_review', publishable: false };
  const saved = { id: 'unify-ok' };
  assert.strictEqual(await persistFactualReviewOrThrow({
    workflowId: 'unify-ok', diagnostic, save: async () => saved,
  }), saved);

  await assert.rejects(
    persistFactualReviewOrThrow({ workflowId: 'unify-null', diagnostic, save: async () => null }),
    error => error?.errorType === 'WORKFLOW_PERSIST_FAILED'
      && error?.failedStep === 'auto_workflow_persist'
      && /ไม่พบแถว workflow/u.test(error.message),
  );
  await assert.rejects(
    persistFactualReviewOrThrow({ workflowId: 'unify-throw', diagnostic, save: async () => { throw new Error('DB down'); } }),
    error => error?.errorType === 'WORKFLOW_PERSIST_FAILED'
      && error?.failedStep === 'auto_workflow_persist'
      && /DB down/u.test(error.message),
  );
  const deadline = Object.assign(new Error('หมดเวลา'), {
    code: 'PIPELINE_DEADLINE_EXCEEDED',
    errorType: 'PIPELINE_DEADLINE_EXCEEDED',
    failedStep: 'pipeline_deadline',
  });
  await assert.rejects(
    persistFactualReviewOrThrow({ workflowId: 'unify-deadline', diagnostic, save: async () => { throw deadline; } }),
    error => error === deadline,
  );
});

test('production wiring ไม่มี Fable regeneration และมี partial/zero-pass quarantine', async () => {
  const auto = await readFile(new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url), 'utf8');
  const gate = await readFile(new URL('../src/lib/services/rawFactCompletenessGate.js', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../src/lib/workflow/workflowEngine.js', import.meta.url), 'utf8');
  assert.match(auto, /enforceRawFactCompleteness\(\{\s*rawText,\s*versions: finalVersions,\s*\}\)/u);
  assert.doesNotMatch(auto, /regenerateFactualVersion|factual_regeneration_|formatRawFactRegenerationInstruction/u);
  assert.match(auto, /finalVersions = factOutcome\.passingVersions/u);
  assert.match(auto, /const analysisResult = buildPublishableAnalysisResult\(\{/u);
  assert.doesNotMatch(auto.slice(auto.indexOf('const analysisResult ='), auto.indexOf('const finalPresetId =')), /\.\.\.primaryResult/u);
  assert.match(auto, /usedPreset = resolveFinalUsedPreset\(finalVersions, usedPresetByPromptId, usedPreset\)/u);
  assert.match(auto, /classic: classicVersionCount, enhanced: enhancedVersionCount/u);
  assert.match(auto, /contextHash: factOutcome\.finalAudit\.contextHash/u);
  assert.match(auto, /await persistFactualReviewOrThrow\(\{/u);
  assert.match(gate, /persistError\.failedStep = 'auto_workflow_persist'/u);
  assert.match(auto, /FACTUAL_REVIEW_REQUIRED/u);
  assert.match(auto, /console\.warn\('\[FactGate\] final rejected claims'/u);
  assert.equal((gate.match(/await repairBatch\(/gu) || []).length, 1);
  assert.match(workflow, /currentStep: 'factual_review'/u);
  assert.match(workflow, /versions: \[\]/u);
});

test('UI display/copy/send review ใช้ publishable content เดียวและไม่ส่ง metadata หลังบ้าน', async () => {
  const result = await readFile(new URL('../src/components/content/ResultVersions.js', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/app/content/new/page.js', import.meta.url), 'utf8');
  assert.match(result, /return getPublishablePostText\(version\)/u);
  assert.match(result, /copyText\(buildPostText\(v\)/u);
  assert.match(result, /\{buildPostText\(v\)\}/u);
  assert.doesNotMatch(result, /\{v\.content\}/u);
  assert.match(page, /const publishableContent = getPublishablePostText\(version\)/u);
  assert.match(page, /content: publishableContent/u);
  assert.match(page, /hook: ''/u);
  assert.match(page, /closing: ''/u);
  const reviewBlock = page.slice(page.indexOf('const handleSendToReview'), page.indexOf('const handleSendToReview') + 1900);
  assert.doesNotMatch(reviewBlock, /version\.title|version\.hook|version\.closing/u);
});
