// Focused tests — src/lib/solverShadowMetrics.js (PURE aggregator, ไม่มี IO)
//   ตรง 100% · ตรง 0% · บาง slot ต่าง (จัดหมวดเหตุผลถูก) · field หาย/ผิดรูปแบบไม่ throw · ไม่มี record → สรุปว่าง
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  aggregateSolverShadow,
  formatSolverShadowReport,
  classifyDiffReason,
} = await import('../src/lib/solverShadowMetrics.js');

// ---------- helper: สร้าง record v1 ให้ตรงสัญญาจริงของ megaAdapters.js ----------
function v1Rec({ jobId, perSlot }) {
  const agree = perSlot.filter((p) => p.match).length;
  return {
    jobId,
    at: '2026-07-19T00:00:00.000Z',
    solverShadow: { v: 1, agree, total: perSlot.length, perSlot },
    solverShadowV2: null,
  };
}

test('classifyDiffReason: จัดหมวดถูกทุกกรณีตามฟิลด์จริง (slot/llm/solver/top3)', () => {
  assert.equal(classifyDiffReason('hero', 'A', 'B', []), 'hero_mismatch');
  assert.equal(classifyDiffReason('reaction', 'A', null, []), 'solver_hole');
  assert.equal(classifyDiffReason('action', null, 'B', []), 'llm_empty_solver_filled');
  assert.equal(classifyDiffReason('context', 'A', 'B', ['B', 'A', 'C']), 'near_miss_top3');
  assert.equal(classifyDiffReason('circle', 'A', 'B', ['B', 'C', 'D']), 'different_pick');
});

test('ตรง 100%: overall.pct=100, perSlot ทุกช่อง pct=100, ไม่มี diffReasons', () => {
  const records = [
    v1Rec({
      jobId: 'MG-0001',
      perSlot: [
        { slot: 'hero', llm: '11', solver: '11', match: true, top3: ['11', '22', '33'] },
        { slot: 'reaction', llm: '12', solver: '12', match: true, top3: ['12'] },
        { slot: 'action', llm: '13', solver: '13', match: true, top3: ['13'] },
        { slot: 'context', llm: '14', solver: '14', match: true, top3: ['14'] },
        { slot: 'circle', llm: '15', solver: '15', match: true, top3: ['15'] },
      ],
    }),
  ];
  const s = aggregateSolverShadow(records);
  assert.equal(s.totalRecords, 1);
  assert.equal(s.runsWithShadowV1, 1);
  assert.equal(s.overall.total, 5);
  assert.equal(s.overall.agree, 5);
  assert.equal(s.overall.pct, 100);
  for (const slot of ['hero', 'reaction', 'action', 'context', 'circle']) {
    assert.equal(s.perSlot[slot].pct, 100);
  }
  assert.deepEqual(s.diffReasons, []);
});

test('ตรง 0%: overall.pct=0, ทุกช่องมีเหตุผลต่างครบ', () => {
  const records = [
    v1Rec({
      jobId: 'MG-0002',
      perSlot: [
        { slot: 'hero', llm: '11', solver: '99', match: false, top3: ['99'] },
        { slot: 'reaction', llm: '12', solver: null, match: false, top3: [] },
        { slot: 'action', llm: null, solver: '13', match: false, top3: [] },
        { slot: 'context', llm: '14', solver: '77', match: false, top3: ['77', '14'] }, // near miss
        { slot: 'circle', llm: '15', solver: '88', match: false, top3: ['88', '66'] }, // different, ไม่ติด top3
      ],
    }),
  ];
  const s = aggregateSolverShadow(records);
  assert.equal(s.overall.total, 5);
  assert.equal(s.overall.agree, 0);
  assert.equal(s.overall.pct, 0);
  for (const slot of ['hero', 'reaction', 'action', 'context', 'circle']) {
    assert.equal(s.perSlot[slot].pct, 0);
  }
  const byReason = Object.fromEntries(s.diffReasons.map((r) => [r.reason, r.count]));
  assert.equal(byReason.hero_mismatch, 1);
  assert.equal(byReason.solver_hole, 1);
  assert.equal(byReason.llm_empty_solver_filled, 1);
  assert.equal(byReason.near_miss_top3, 1);
  assert.equal(byReason.different_pick, 1);
  // sample แนบ jobId ไว้ตรวจสอบย้อนกลับได้
  assert.equal(s.diffSamples.hero_mismatch[0].jobId, 'MG-0002');
});

test('บาง slot ต่าง: mixed หลายงาน — perSlot pct คำนวณถูกต่อช่อง ไม่ใช่ถูกเฉลี่ยทั้งระบบผิด', () => {
  const records = [
    v1Rec({ jobId: 'MG-A', perSlot: [
      { slot: 'hero', llm: '1', solver: '1', match: true, top3: ['1'] },
      { slot: 'circle', llm: '2', solver: '3', match: false, top3: ['3'] },
    ] }),
    v1Rec({ jobId: 'MG-B', perSlot: [
      { slot: 'hero', llm: '4', solver: '4', match: true, top3: ['4'] },
      { slot: 'circle', llm: '5', solver: '5', match: true, top3: ['5'] },
    ] }),
  ];
  const s = aggregateSolverShadow(records);
  assert.equal(s.perSlot.hero.total, 2);
  assert.equal(s.perSlot.hero.agree, 2);
  assert.equal(s.perSlot.hero.pct, 100);
  assert.equal(s.perSlot.circle.total, 2);
  assert.equal(s.perSlot.circle.agree, 1);
  assert.equal(s.perSlot.circle.pct, 50);
  assert.equal(s.overall.total, 4);
  assert.equal(s.overall.agree, 3);
  assert.equal(s.overall.pct, 75);
});

test('v2 diagnostics: solverTopScore / llmRankInSolver / candidateUniverse คำนวณถูกเมื่อมีข้อมูล', () => {
  const records = [
    {
      jobId: 'MG-V2',
      at: '2026-07-19T00:00:00.000Z',
      solverShadow: null,
      solverShadowV2: {
        v: 2,
        candidateUniverse: { llmCount: 10, solverCount: 12, commonCount: 9, identical: false },
        solver: {
          slots: { hero: '1' },
          diagnostics: {
            v: 2,
            topK: 3,
            perSlot: [
              {
                slotId: 'hero',
                topK: [{ rank: 1, id: '1', total: 8.5 }],
                comparisons: { postGateLlm: { imageId: '2', status: 'ranked', rank: 3, total: 6 } },
              },
              {
                slotId: 'circle',
                topK: [{ rank: 1, id: '9', total: 7.5 }],
                comparisons: { postGateLlm: { imageId: '9', status: 'ranked', rank: 1, total: 7.5 } },
              },
            ],
          },
        },
      },
    },
  ];
  const s = aggregateSolverShadow(records);
  assert.equal(s.runsWithShadowV2, 1);
  assert.equal(s.solverTopScore.count, 2);
  assert.equal(s.solverTopScore.avg, 8); // (8.5+7.5)/2
  assert.equal(s.llmRankInSolver.count, 2);
  assert.equal(s.llmRankInSolver.avg, 2); // (3+1)/2
  assert.equal(s.candidateUniverse.sampleCount, 1);
  assert.equal(s.candidateUniverse.avgLlmCount, 10);
  assert.equal(s.candidateUniverse.avgSolverCount, 12);
  assert.equal(s.candidateUniverse.avgCommonCount, 9);
  assert.equal(s.candidateUniverse.identicalPct, 0);
});

test('field หาย/ผิดรูปแบบ: ไม่ throw และข้ามเงียบๆ (ทนพังทุกรูปแบบ)', () => {
  const weird = [
    null,
    undefined,
    42,
    'not-an-object',
    [],
    {},
    { jobId: 'X', solverShadow: null, solverShadowV2: null },
    { jobId: 'Y', solverShadow: { v: 1 } }, // ไม่มี perSlot
    { jobId: 'Z', solverShadow: { v: 1, perSlot: 'not-array' } },
    { jobId: 'W', solverShadow: { v: 1, perSlot: [null, 42, {}, { slot: '' }, { slot: 123 }] } },
    { jobId: 'V', solverShadow: { v: 1, perSlot: [{ slot: 'hero' /* ไม่มี llm/solver/match/top3 */ }] } },
    { jobId: 'U', solverShadowV2: { candidateUniverse: 'nope', solver: { diagnostics: { perSlot: 'nope' } } } },
    { jobId: 'T', solverShadowV2: { solver: { diagnostics: { perSlot: [{ topK: 'nope', comparisons: null }] } } } },
  ];
  assert.doesNotThrow(() => aggregateSolverShadow(weird));
  const s = aggregateSolverShadow(weird);
  assert.equal(s.totalRecords, weird.length);
  // record 'V' มี slot ที่ไม่มี llm/solver → llm===solver===null → นับเป็น match (ไม่ throw, ไม่ใช่ diff)
  assert.equal(s.perSlot.hero.total, 1);
  assert.equal(s.perSlot.hero.agree, 1);
  assert.doesNotThrow(() => formatSolverShadowReport(s));
});

test('aggregateSolverShadow รับ input ที่ไม่ใช่ array เลย (undefined/null/object) โดยไม่ throw', () => {
  for (const bad of [undefined, null, {}, 'x', 123]) {
    assert.doesNotThrow(() => aggregateSolverShadow(bad));
    const s = aggregateSolverShadow(bad);
    assert.equal(s.totalRecords, 0);
  }
});

test('ไม่มี record เลย → สรุปว่าง (totalRecords=0, overall.pct=null, perSlot={}, diffReasons=[])', () => {
  const s = aggregateSolverShadow([]);
  assert.equal(s.totalRecords, 0);
  assert.equal(s.runsWithShadowV1, 0);
  assert.equal(s.runsWithShadowV2, 0);
  assert.equal(s.overall.total, 0);
  assert.equal(s.overall.pct, null);
  assert.deepEqual(s.perSlot, {});
  assert.deepEqual(s.diffReasons, []);
  assert.equal(s.solverTopScore.avg, null);
  assert.equal(s.candidateUniverse.sampleCount, 0);
});

test('formatSolverShadowReport: ไม่มีข้อมูล → ข้อความ "ยังไม่มี shadow — ทำปกก่อน"', () => {
  const s = aggregateSolverShadow([]);
  const text = formatSolverShadowReport(s);
  assert.match(text, /ยังไม่มี shadow — ทำปกก่อน/);
});

test('formatSolverShadowReport: มีข้อมูล → มีตัวเลข % และชื่อช่องปรากฏในรายงาน ไม่ throw', () => {
  const records = [
    v1Rec({ jobId: 'MG-R', perSlot: [
      { slot: 'hero', llm: '1', solver: '1', match: true, top3: ['1'] },
      { slot: 'circle', llm: '2', solver: '3', match: false, top3: ['9'] },
    ] }),
  ];
  const s = aggregateSolverShadow(records);
  const text = formatSolverShadowReport(s);
  assert.match(text, /ตรงกันรวม/);
  assert.match(text, /circle/);
  assert.match(text, /สรุป:/);
});
