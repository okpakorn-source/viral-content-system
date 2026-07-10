import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRefSlotContract,
  buildFinalAssignmentTrace,
  projectLegacySelections,
  restrictCandidateUniverse,
} from '../src/lib/refSlotContract.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const ref = {
  template: {
    slots: [
      { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 52, hPct: 100, shot: 'closeup' },
      { role: 'context', shape: 'rect', xPct: 52, yPct: 0, wPct: 48, hPct: 57 },
      { role: 'evidence', shape: 'rect', xPct: 46, yPct: 33, wPct: 51, hPct: 24 },
      { role: 'reaction', shape: 'rect', xPct: 52, yPct: 57, wPct: 48, hPct: 43 },
      { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 36, hPct: 28 },
    ],
  },
  slots: [
    { role: 'hero', subject: 'lead' },
    { role: 'context', subject: 'group' },
    { role: 'evidence', subject: 'phone' },
    { role: 'reaction', subject: 'second person' },
    { role: 'moment', subject: 'mother and child' },
  ],
};
const orders = [
  { i: 0, role: 'hero', personHint: 'Lead', want: 'lead close-up', shot: 'closeup' },
  { i: 2, role: 'evidence', want: 'phone evidence', shot: 'closeup' },
  { i: 4, role: 'moment', personHint: 'Mother', want: 'warm moment', shot: 'medium' },
];

test('derives exact ref roles instead of the legacy five-role schema', () => {
  const contract = buildRefSlotContract({ refDNA: ref, artBriefOrders: orders });
  assert.deepEqual(contract.slots.map((slot) => slot.id), ['hero', 'context', 'evidence', 'reaction', 'moment']);
  assert.deepEqual(contract.slots.map((slot) => slot.legacySlot), ['hero', 'reaction', 'action', 'context', 'circle']);
  assert.equal(contract.mismatches.length, 4);
});

test('keeps semantic role while using circle scoring for a circular moment slot', () => {
  const contract = buildRefSlotContract({ refDNA: ref, artBriefOrders: orders });
  const moment = contract.slots.find((slot) => slot.id === 'moment');
  assert.equal(moment.refRole, 'moment');
  assert.equal(moment.solverRole, 'circle');
  assert.equal(moment.wantPerson, 'Mother');
});

test('projects current LLM/post-gate selections by physical slot position', () => {
  const contract = buildRefSlotContract({ refDNA: ref });
  assert.deepEqual(projectLegacySelections({ hero: 1, reaction: 2, action: 3, context: 4, circle: 5 }, contract), {
    hero: '1', context: '2', evidence: '3', reaction: '4', moment: '5',
  });
});

test('preserves candidate order while removing images the LLM could not see', () => {
  const images = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(restrictCandidateUniverse(images, ['a', 'c']), [images[0], images[2]]);
  assert.deepEqual(restrictCandidateUniverse(images, null), images);
});

test('deduplicates repeated ref roles with stable ids', () => {
  const contract = buildRefSlotContract({ refDNA: { slots: [{ role: 'context' }, { role: 'context' }] }, legacySlots: ['hero', 'context'] });
  assert.deepEqual(contract.slots.map((slot) => slot.id), ['context', 'context_2']);
});

test('is deterministic for identical plain-data input', () => {
  const a = JSON.stringify(buildRefSlotContract({ refDNA: ref, artBriefOrders: orders }));
  const b = JSON.stringify(buildRefSlotContract({ refDNA: ref, artBriefOrders: orders }));
  assert.equal(a, b);
});

test('preserves the actual evidence/moment roles from the verified ref library', () => {
  const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
  const record = refs.find((item) => item.id === 'REF-mrbq8odo-t135');
  assert.ok(record?.dna, 'verified ref REF-mrbq8odo-t135 must exist');
  const contract = buildRefSlotContract({ refDNA: record.dna });
  assert.deepEqual(contract.slots.map((slot) => slot.refRole), ['hero', 'context', 'evidence', 'reaction', 'moment']);
  assert.equal(contract.slots.at(-1).solverRole, 'circle');
});

test('traces composer reselection against the S6 primary expected at each ref position', () => {
  const contract = buildRefSlotContract({ refDNA: ref });
  const trace = buildFinalAssignmentTrace({
    refSlotContract: contract,
    plannedSlots: {
      hero: { id: 'h', imageUrl: 'url-h' },
      reaction: { id: 'r', imageUrl: 'url-r' },
      action: { id: 'a', imageUrl: 'url-a' },
      context: { id: 'c', imageUrl: 'url-c' },
      circle: { id: 'o', imageUrl: 'url-o' },
    },
    manifestSlots: [
      { slot: 'main', imageUrl: 'url-h' },
      { slot: 'context_1', imageUrl: 'url-r' },
      { slot: 'evidence_2', imageUrl: 'url-c' },
      { slot: 'reaction_3', imageUrl: 'url-c' },
      { slot: 'circle', imageUrl: 'url-o' },
    ],
  });
  assert.equal(trace.total, 5);
  assert.equal(trace.keptExpectedPrimary, 4);
  assert.equal(trace.changedExpectedPrimary, 1);
  assert.deepEqual(trace.slots[2], {
    finalSlot: 'evidence_2',
    refRole: 'evidence',
    expectedPlanRole: 'action',
    expectedCandidateId: 'a',
    sourcePlanRole: 'context',
    sourceCandidateId: 'c',
    keptExpectedPrimary: false,
    status: 'reselected_other_primary',
  });
});

console.log(`1..${passed}`);
