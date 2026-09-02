import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
// ★ 1 ก.ย. 69: correctionPipeline เพิ่ม helper 3 ตัว (ไฟล์ปลอด import — ใช้ของจริงได้เลย)
import { envOn } from '../src/lib/utils/envFlag.js';
import { guardedReplace, sortLongestFirst } from '../src/lib/correction/guardedReplace.js';
import { scrubHallucinatedPlaces } from '../src/lib/correction/placeScrub.js';
import { findMissingFacts } from '../src/lib/correction/missingFactsGate.js'; // ★ 2 ก.ย. 69 L4.7 (ไฟล์ปลอด import — ใช้ของจริง)

const factSource = readFileSync(new URL('../src/lib/correction/factPreservationCheck.js', import.meta.url), 'utf8');
const checkFactPreservation = new Function(
  `${factSource.replace('export function checkFactPreservation', 'function checkFactPreservation')}\nreturn checkFactPreservation;`,
)();

test('ไม่มี drift ต้อง preserved=true และ action=pass', () => {
  const content = 'เนื้อข่าวเดิมที่ไม่มีข้อมูลสูญหาย '.repeat(6);
  const result = checkFactPreservation(content, content, {});
  assert.equal(result.preserved, true);
  assert.equal(result.action, 'pass');
  assert.deepEqual(result.drifts, []);
});

test('place_missing ต้องรายงาน preserved=false แต่ medium drift ไม่บังคับ rollback', () => {
  const original = `เหตุเกิดที่ โรงพยาบาลศิริราช ${'ประชาชนปลอดภัยและเจ้าหน้าที่ดูแล '.repeat(5)}`;
  const corrected = original.replace('โรงพยาบาลศิริราช', 'สถานพยาบาลแห่งหนึ่ง');
  const result = checkFactPreservation(original, corrected, {});
  assert.ok(result.drifts.some((drift) => drift.type === 'place_missing'));
  assert.equal(result.preserved, false);
  assert.equal(result.action, 'pass');
});

test('paragraph_missing ต้องรายงาน preserved=false แต่ไม่ตีกลับงานขัดเกลาอัตโนมัติ', () => {
  const original = `${'ก'.repeat(80)}\n\n${'ข'.repeat(80)}\n\n${'ค'.repeat(80)}`;
  const corrected = original.replaceAll('\n\n', '\n');
  const result = checkFactPreservation(original, corrected, {});
  assert.ok(result.drifts.some((drift) => drift.type === 'paragraph_missing'));
  assert.equal(result.preserved, false);
  assert.equal(result.action, 'pass');
});

test('length_drift ต้องรายงาน preserved=false แต่ไม่ตีกลับงานขัดเกลาอัตโนมัติ', () => {
  const original = 'ก'.repeat(200);
  const corrected = 'ก'.repeat(250);
  const result = checkFactPreservation(original, corrected, {});
  assert.ok(result.drifts.some((drift) => drift.type === 'length_drift'));
  assert.equal(result.preserved, false);
  assert.equal(result.action, 'pass');
});

test('high drift ยังต้อง rollback', () => {
  const original = `เหตุการณ์นี้มีผู้เกี่ยวข้อง 12 คน ${'ข้อมูลยืนยันตามต้นฉบับ '.repeat(6)}`;
  const corrected = original.replace('12', 'หลาย');
  const result = checkFactPreservation(original, corrected, {});
  assert.ok(result.drifts.some((drift) => drift.type === 'number_missing' && drift.severity === 'high'));
  assert.equal(result.preserved, false);
  assert.equal(result.action, 'rollback');
});

const pipelineSource = readFileSync(new URL('../src/lib/correction/correctionPipeline.js', import.meta.url), 'utf8');
const pipelineStart = pipelineSource.indexOf('export async function runCorrectionPipeline');
assert.ok(pipelineStart >= 0, 'ต้องหา runCorrectionPipeline ใน source จริงได้');
const pipelineFunctionSource = pipelineSource
  .slice(pipelineStart)
  .replace('export async function runCorrectionPipeline', 'async function runCorrectionPipeline');

function makePipeline(overrides = {}) {
  const defaults = {
    auditOutput: async (version) => ({
      auditScore: 80,
      issues: version.content.includes('ISSUE') ? [{ type: 'test_issue', severity: 'high', text: 'ISSUE' }] : [],
    }),
    safeCorrect: async (content) => ({
      correctedContent: content.replace('ISSUE', 'FIXED'),
      rollbackContent: content,
      corrections: [{ type: 'test_fix', text: 'ISSUE' }],
    }),
    guardCoreNews: () => ({ ok: true, reason: null }),
    checkFactPreservation: (original, candidate) => {
      const drifted = candidate.includes('FACT_REMOVED');
      return {
        preserved: !drifted,
        drifts: drifted ? [{ type: 'test_drift', severity: 'high' }] : [],
        action: drifted ? 'rollback' : 'pass',
      };
    },
    editorialPolish: (content) => ({ polishedContent: `${content}|POLISHED`, changes: ['test-polish'] }),
    semanticSanityCheck: async (content) => ({
      sanitizedContent: content.replace('DROP_LATE', 'FACT_REMOVED'),
      issuesFound: content.includes('DROP_LATE') ? ['late-removal'] : [],
      fixed: content.includes('DROP_LATE'),
    }),
    fabricationGate: async (content) => ({ content, debug: { sus: 0, confirmed: 0, fixed: false } }),
    bbStep: () => {},
  };
  const deps = { ...defaults, ...overrides };
  return new Function(
    'auditOutput',
    'safeCorrect',
    'guardCoreNews',
    'checkFactPreservation',
    'editorialPolish',
    'semanticSanityCheck',
    'fabricationGate',
    'bbStep',
    'envOn',
    'guardedReplace',
    'sortLongestFirst',
    'scrubHallucinatedPlaces',
    'findMissingFacts',
    `${pipelineFunctionSource}\nreturn runCorrectionPipeline;`,
  )(
    deps.auditOutput,
    deps.safeCorrect,
    deps.guardCoreNews,
    deps.checkFactPreservation,
    deps.editorialPolish,
    deps.semanticSanityCheck,
    deps.fabricationGate,
    deps.bbStep,
    envOn,
    guardedReplace,
    sortLongestFirst,
    scrubHallucinatedPlaces,
    findMissingFacts,
  );
}

async function runEnabled(run) {
  const previous = process.env.SKIP_CORRECTION;
  delete process.env.SKIP_CORRECTION;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.SKIP_CORRECTION;
    else process.env.SKIP_CORRECTION = previous;
  }
}

const longContent = (marker) => `${marker} ${'เนื้อข่าวสำหรับทดสอบฉบับจริง '.repeat(6)}`;

test('clean path ตรวจฉบับหลัง semantic+polish และตรวจฉบับ rollback ที่คืนจริง', async () => {
  const checked = [];
  const runPipeline = makePipeline({
    checkFactPreservation: (original, candidate) => {
      checked.push(candidate);
      const drifted = candidate.includes('FACT_REMOVED');
      return { preserved: !drifted, drifts: drifted ? [{ type: 'late' }] : [], action: drifted ? 'rollback' : 'pass' };
    },
  });
  const original = longContent('CLEAN DROP_LATE');
  const [result] = await runEnabled(() => runPipeline([{ content: original, style: 'clean-test' }], {}, {}));
  assert.ok(checked[0].includes('FACT_REMOVED') && checked[0].endsWith('|POLISHED'), 'ต้องตรวจหลัง L4.6 และ L5');
  assert.equal(result.content, original, 'drift หลัง polish ต้อง rollback');
  assert.equal(checked.at(-1), result.content, 'ฉบับที่คืนจริงต้องเป็นฉบับสุดท้ายที่ถูกตรวจ');
  assert.equal(result._correctionDebug.factPreserved, true);
  assert.equal(result._correctionDebug.rolledBack, true);
  assert.equal(result._correctionDebug.rejectedFactDrifts, 1);
});

test('corrected path ตรวจฉบับหลัง L4.5/L4.6/L5 ไม่ใช่ correctedContent กลางทาง', async () => {
  const checked = [];
  const runPipeline = makePipeline({
    checkFactPreservation: (original, candidate) => {
      checked.push(candidate);
      const drifted = candidate.includes('FACT_REMOVED');
      return { preserved: !drifted, drifts: drifted ? [{ type: 'late' }] : [], action: drifted ? 'rollback' : 'pass' };
    },
  });
  const original = longContent('ISSUE DROP_LATE');
  const [result] = await runEnabled(() => runPipeline([{ content: original, style: 'corrected-test' }], {}, {}));
  assert.ok(checked.some((candidate) => candidate.includes('FACT_REMOVED') && candidate.endsWith('|POLISHED')), 'candidate ที่ตรวจต้องรวมผลแก้ชั้นท้ายแล้ว');
  assert.equal(result.content, original.replace('ISSUE', 'FIXED'), 'ต้องถอยแค่ถึงผล L3 ที่ผ่าน fact check แล้ว');
  assert.doesNotMatch(result.content, /\bISSUE\b/, 'ห้ามคืนคำเสี่ยงที่ L3 แก้สำเร็จแล้วกลับมา');
  assert.equal(checked.at(-1), result.content);
  assert.equal(result._correctionDebug.factPreserved, true);
  assert.equal(result._correctionDebug.rolledBack, true);
});

test('rollback scrub ที่ทำให้ drift ต้องถูกตรวจและทิ้งก่อนคืน output', async () => {
  const checked = [];
  const runPipeline = makePipeline({
    safeCorrect: async (content) => ({
      correctedContent: content.replace('ISSUE', 'FACT_REMOVED'),
      rollbackContent: content,
      corrections: [{ type: 'test_fix', text: 'ISSUE' }],
    }),
    auditOutput: async (version) => ({
      auditScore: 50,
      issues: version.content.includes('FORBIDDEN')
        ? [{ type: 'forbidden_word', severity: 'high', text: 'FORBIDDEN', suggestion: 'FACT_REMOVED' }]
        : [{ type: 'test_issue', severity: 'high', text: 'ISSUE' }],
    }),
    checkFactPreservation: (original, candidate) => {
      checked.push(candidate);
      const drifted = candidate.includes('FACT_REMOVED');
      return { preserved: !drifted, drifts: drifted ? [{ type: 'late' }] : [], action: drifted ? 'rollback' : 'pass' };
    },
  });
  const original = longContent('ISSUE FORBIDDEN DROP_LATE');
  const [result] = await runEnabled(() => runPipeline([{ content: original, style: 'rollback-scrub-test' }], {}, {}));
  assert.ok(checked.length >= 3, 'candidate, scrubbed rollback และ fallback จริงต้องถูกตรวจ');
  assert.ok(checked.some((content) => content.includes('FACT_REMOVED')));
  assert.equal(result.content, original, 'scrub ที่ทำให้ fact drift ต้องถูกทิ้ง');
  assert.equal(checked.at(-1), result.content);
  assert.equal(result._correctionDebug.factPreserved, true);
});

test('happy path ยังคืนผล polish เดิมและตรวจ output เพียงครั้งเดียว', async () => {
  const checked = [];
  const runPipeline = makePipeline({
    checkFactPreservation: (original, candidate) => {
      checked.push(candidate);
      return { preserved: true, drifts: [], action: 'pass' };
    },
  });
  const original = longContent('CLEAN');
  const [result] = await runEnabled(() => runPipeline([{ content: original, style: 'happy-test' }], {}, {}));
  assert.equal(result.content, `${original}|POLISHED`);
  assert.deepEqual(checked, [result.content]);
  assert.equal(result._correctionDebug.factPreserved, true);
  assert.equal(result._correctionDebug.rolledBack, false);
});

test('medium drift รักษาผลขัดเกลาไว้แต่ธง factPreserved ต้องไม่โกหก', async () => {
  const runPipeline = makePipeline({
    checkFactPreservation: (_original, candidate) => {
      const polished = candidate.endsWith('|POLISHED');
      return {
        preserved: !polished,
        drifts: polished ? [{ type: 'length_drift', severity: 'medium' }] : [],
        action: 'pass',
      };
    },
  });
  const original = longContent('CLEAN');
  const [result] = await runEnabled(() => runPipeline([{ content: original, style: 'medium-drift-test' }], {}, {}));
  assert.equal(result.content, `${original}|POLISHED`);
  assert.equal(result._correctionDebug.factPreserved, false);
  assert.equal(result._correctionDebug.factDrifts, 1);
  assert.equal(result._correctionDebug.rolledBack, false);
  assert.equal(result._correctionDebug.rejectedFactDrifts, 0);
});
