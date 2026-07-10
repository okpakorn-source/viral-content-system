import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { solveSlotAssignments } from '../src/lib/slotSolver.js';

const fixture = {
  slots: [
    { id: 'hero', role: 'hero', wantPerson: 'Alice', refShot: 'closeup' },
    { id: 'reaction', role: 'secondary', wantPerson: 'Bob', refShot: 'bust' },
    { id: 'action', role: 'secondary', refShot: 'medium' },
    { id: 'context', role: 'context', refShot: 'wide' },
    { id: 'circle', role: 'circle', wantPerson: 'Bob', refShot: 'closeup' },
  ],
  characters: [{ name: 'Alice', isHero: true }, { name: 'Bob', isHero: false }],
  images: [
    { id: 'A', identityHits: { Alice: true }, storyFit: 8, newsScene: true, quality: 9, faces: 1, clean: true, shortSide: 900, sharpness: 50, faceBoxHFrac: 0.5, sourceScore: 0.8, sceneKey: 's1', pHash64: '0000000000000000' },
    { id: 'B', identityHits: { Bob: true }, storyFit: 7, newsScene: true, quality: 8, faces: 1, clean: true, shortSide: 850, sharpness: 45, faceBoxHFrac: 0.3, sourceScore: 0.7, sceneKey: 's2', pHash64: 'ffffffffffffffff' },
    { id: 'C', identityHits: {}, storyFit: 9, newsScene: true, quality: 8, faces: 0, clean: true, shortSide: 1000, sharpness: 55, sourceScore: 0.9, sceneKey: 's3', pHash64: '0f0f0f0f0f0f0f0f' },
    { id: 'D', identityHits: { Alice: true }, storyFit: 6, newsScene: true, quality: 7, faces: 1, clean: true, shortSide: 800, sharpness: 40, faceBoxHFrac: 0.2, sourceScore: 0.6, sceneKey: 's4', pHash64: '3333333333333333' },
    { id: 'E', identityHits: { Bob: true }, storyFit: 5, newsScene: true, quality: 7, faces: 1, clean: true, shortSide: 780, sharpness: 38, faceBoxHFrac: 0.25, sourceScore: 0.6, sceneKey: 's5', pHash64: 'cccccccccccccccc' },
    { id: 'F', identityHits: {}, storyFit: 7, newsScene: true, quality: 6, faces: 0, clean: true, shortSide: 920, sharpness: 42, sourceScore: 0.5, sceneKey: 's6', pHash64: '5555555555555555' },
  ],
};

const expectedV1 = '{"assignments":[{"slotId":"hero","imageId":"A","total":93.82,"breakdown":{"identity":1,"event":0.8,"technical":0.96,"clean":1,"shotPose":1,"source":0.8},"top3":[{"id":"A","total":93.82},{"id":"D","total":83.5}]},{"slotId":"circle","imageId":"B","total":88.15,"breakdown":{"identity":1,"event":0.7,"technical":0.92,"clean":1,"shotPose":0.875,"source":0.7},"top3":[{"id":"B","total":88.15},{"id":"E","total":80.6},{"id":"D","total":69.85}]},{"slotId":"reaction","imageId":"E","total":82.35,"breakdown":{"identity":1,"event":0.5,"technical":0.8799999999999999,"clean":1,"shotPose":0.925,"source":0.6},"top3":[{"id":"E","total":82.35},{"id":"D","total":72.85},{"id":"C","total":69.4}]},{"slotId":"action","imageId":"D","total":72.85,"breakdown":{"identity":0.6,"event":0.6,"technical":0.8799999999999999,"clean":1,"shotPose":0.925,"source":0.6},"top3":[{"id":"D","total":72.85},{"id":"C","total":69.4},{"id":"F","total":60.8}]},{"slotId":"context","imageId":"C","total":71.9,"breakdown":{"identity":0.3,"event":0.9,"technical":0.92,"clean":1,"shotPose":0.75,"source":0.9},"top3":[{"id":"C","total":71.9},{"id":"F","total":63.3}]}],"holes":[],"notes":[]}';

const solverPath = fileURLToPath(new URL('../src/lib/slotSolver.js', import.meta.url));
const solverSource = await readFile(solverPath, 'utf8');
assert.equal(/^import\s/m.test(solverSource), false, 'slotSolver.js must remain import-free');

const fixtureBefore = JSON.stringify(fixture);
const v1 = solveSlotAssignments(fixture);
assert.equal(JSON.stringify(v1), expectedV1, 'v1 output changed from the pre-edit regression snapshot');
assert.equal('diagnostics' in v1, false, 'v1 output must not gain diagnostics');
assert.equal(JSON.stringify(fixture), fixtureBefore, 'solver mutated its input');

const ignoredDiagnostics = solveSlotAssignments({ ...fixture, diagnostics: { v: 1 } });
assert.equal(JSON.stringify(ignoredDiagnostics), expectedV1, 'unsupported diagnostics version must preserve v1 behavior');

const diagnosticInput = {
  ...fixture,
  diagnostics: {
    v: 2,
    topK: 5,
    compareBySlot: {
      rawLlm: { hero: 'B', reaction: 'B', action: 'C', context: null, circle: 'B' },
      postGateLlm: { hero: 'A', reaction: 'E', action: 'D', context: 'C', circle: 'B' },
    },
  },
};
const diagnosticBefore = JSON.stringify(diagnosticInput);
const v2a = solveSlotAssignments(diagnosticInput);
const v2b = solveSlotAssignments(diagnosticInput);
assert.equal(JSON.stringify(v2a), JSON.stringify(v2b), 'diagnostics v2 must be byte deterministic');
assert.equal(JSON.stringify(diagnosticInput), diagnosticBefore, 'diagnostics v2 mutated its input');
assert.deepEqual(
  { assignments: v2a.assignments, holes: v2a.holes, notes: v2a.notes },
  v1,
  'diagnostics v2 changed the selected assignments',
);
assert.equal(v2a.diagnostics?.v, 2);
assert.equal(v2a.diagnostics?.topK, 5);

const heroDiag = v2a.diagnostics.perSlot.find((x) => x.slotId === 'hero');
assert.equal(heroDiag.comparisons.rawLlm.status, 'hero_identity_hard_zero');
assert.equal(heroDiag.comparisons.postGateLlm.status, 'ranked');
assert.equal(heroDiag.comparisons.postGateLlm.rank, 1);
assert.equal(heroDiag.exclusions.heroIdentityHardZeroCount, 4);
assert.deepEqual(heroDiag.topK.map((x) => x.id), ['A', 'D']);

const reactionDiag = v2a.diagnostics.perSlot.find((x) => x.slotId === 'reaction');
assert.equal(reactionDiag.comparisons.rawLlm.status, 'already_used_by_solver');
assert.equal(reactionDiag.comparisons.postGateLlm.status, 'ranked');
assert.equal(reactionDiag.comparisons.postGateLlm.rank, 1);

for (const slot of v2a.diagnostics.perSlot) {
  assert.ok(slot.topK.length <= 5, `${slot.slotId} exceeded diagnostics topK`);
  assert.ok(slot.topK.every((x, i) => x.rank === i + 1), `${slot.slotId} ranks are not contiguous`);
}

console.log('slotSolver Phase1 diagnostics: 14/14 assertions passed');
