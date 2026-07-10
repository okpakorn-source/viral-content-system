import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRefSlotContract,
  buildFinalAssignmentTrace,
  buildSelectionSpec,
  projectLegacySelections,
  restrictCandidateUniverse,
} from '../src/lib/refSlotContract.js';
import { dnaToTemplateSpec } from '../src/lib/refTemplate.js';

const loadLibraryRef = (id) => {
  const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
  const record = refs.find((item) => item.id === id);
  assert.ok(record?.dna, `verified ref ${id} must exist in library`);
  return record.dna;
};

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
  // ★ รอบ 7: switch-off regression — ไม่มี selectionSpec ต้องได้ v1 shape ของ HEAD เดิมทั้งก้อนเป๊ะ
  //   (ไม่มี partition/missingExpected และ slot ไม่มี refSlotId/resolvedBy)
  assert.deepEqual(trace, {
    v: 1,
    total: 5,
    keptExpectedPrimary: 4,
    changedExpectedPrimary: 1,
    unknownExpected: 0,
    slots: [
      { finalSlot: 'main', refRole: 'hero', expectedPlanRole: 'hero', expectedCandidateId: 'h', sourcePlanRole: 'hero', sourceCandidateId: 'h', keptExpectedPrimary: true, status: 'kept_expected_primary' },
      { finalSlot: 'context_1', refRole: 'context', expectedPlanRole: 'reaction', expectedCandidateId: 'r', sourcePlanRole: 'reaction', sourceCandidateId: 'r', keptExpectedPrimary: true, status: 'kept_expected_primary' },
      { finalSlot: 'evidence_2', refRole: 'evidence', expectedPlanRole: 'action', expectedCandidateId: 'a', sourcePlanRole: 'context', sourceCandidateId: 'c', keptExpectedPrimary: false, status: 'reselected_other_primary' },
      { finalSlot: 'reaction_3', refRole: 'reaction', expectedPlanRole: 'context', expectedCandidateId: 'c', sourcePlanRole: 'context', sourceCandidateId: 'c', keptExpectedPrimary: true, status: 'kept_expected_primary' },
      { finalSlot: 'circle', refRole: 'moment', expectedPlanRole: 'circle', expectedCandidateId: 'o', sourcePlanRole: 'circle', sourceCandidateId: 'o', keptExpectedPrimary: true, status: 'kept_expected_primary' },
    ],
  });
});

// ---------- 📜 SelectionSpec v1 (Codex ตรวจรอบ 2) ----------

test('selectionSpec maps REF-mrbq660y-la4b semantically: circle must not borrow the context image', () => {
  const dna = loadLibraryRef('REF-mrbq660y-la4b');
  const contract = buildRefSlotContract({ refDNA: dna });
  const spec = buildSelectionSpec({
    contract,
    realizedTemplate: dnaToTemplateSpec(dna),
    // ความจริงของ S6 panelCount=4 วันนี้: SLOT_ORDER.slice ไม่เคยเลือกภาพให้ circle เลย
    plannedSlots: {
      hero: { id: 'img-h', imageUrl: 'url-h' },
      reaction: { id: 'img-r', imageUrl: 'url-r' },
      action: { id: 'img-a', imageUrl: 'url-a' },
      context: { id: 'img-c', imageUrl: 'url-c' },
    },
    refId: 'REF-mrbq660y-la4b',
  });
  assert.equal(spec.counts.total, 4);
  assert.equal(spec.counts.mapped, 4);
  const composerIds = spec.slots.map((s) => s.composerSlotId);
  assert.equal(new Set(composerIds).size, composerIds.length, 'composerSlotId must be unique');
  assert.ok(composerIds.includes('main') && composerIds.includes('circle'));
  const refIds = spec.slots.map((s) => s.refSlotId);
  assert.equal(new Set(refIds).size, refIds.length, 'refSlotId must be unique');
  const moment = spec.slots.find((s) => s.refSlotId === 'moment');
  assert.equal(moment.composerSlotId, 'circle');
  assert.equal(moment.legacySlot, 'circle');       // บทเชิงความหมาย — วงกลมผูกกับ plannedSlots.circle เท่านั้น
  assert.equal(moment.primary, null);              // แผน 4 ช่องไม่มี circle → เปิดโปงตรงๆ ห้ามยืม img-c
  assert.equal(spec.counts.missingPrimary, 1);
  assert.equal(spec.strictReady, false);           // strict renderer ห้ามเดินจนกว่า S6 จะวางภาพวงกลมจริง
  const victim = spec.slots.find((s) => s.refSlotId === 'victim');
  assert.equal(victim.legacySlot, 'action');       // บทนอกคลังศัพท์ → fallback ตำแหน่งเดิม (deterministic)
  assert.equal(victim.mappingMode, 'legacy_fallback'); // ★ รอบ 4: ป้ายชัดว่าเป็น fallback ไม่ใช่บทแท้
  assert.equal(victim.primary.candidateId, 'img-a'); // candidateId identity (join เพื่อ audit — ไม่ใช่ความถูกต้อง production)
  assert.equal(moment.mappingMode, 'circle_exact');
  assert.equal(spec.counts.semanticFallback, 1);
});

test('strictReady stays false while any slot is legacy_fallback even with a full circle plan', () => {
  const dna = loadLibraryRef('REF-mrbq660y-la4b');
  const spec = buildSelectionSpec({
    contract: buildRefSlotContract({ refDNA: dna }),
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedSlots: {
      hero: { id: 'img-h', imageUrl: 'url-h' },
      reaction: { id: 'img-r', imageUrl: 'url-r' },
      action: { id: 'img-a', imageUrl: 'url-a' },
      context: { id: 'img-c', imageUrl: 'url-c' },
      circle: { id: 'img-o', imageUrl: 'url-o' }, // เติม circle ครบแล้วก็ยังห้ามผ่าน
    },
    refId: 'REF-mrbq660y-la4b',
  });
  assert.equal(spec.counts.missingPrimary, 0);
  assert.equal(spec.counts.semanticFallback, 1); // victim ยังเป็น fallback — S6 ยังไม่ผลิตบท ref แท้
  assert.equal(spec.strictReady, false);
});

test('specHash is identity-based: same candidate new URL keeps hash, new candidate same URL breaks it', () => {
  const dna = loadLibraryRef('REF-mrbq660y-la4b');
  const mk = (heroId, heroUrl) => buildSelectionSpec({
    contract: buildRefSlotContract({ refDNA: dna }),
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedSlots: { hero: { id: heroId, imageUrl: heroUrl } },
    refId: 'REF-mrbq660y-la4b',
  });
  const base = mk('img-h', 'url-old');
  assert.equal(mk('img-h', 'url-new').specHash, base.specHash);        // candidate เดิม URL เปลี่ยน → specHash เดิม
  assert.notEqual(mk('img-other', 'url-old').specHash, base.specHash); // URL เดิม candidate ต่าง → specHash ต้องต่าง
  assert.notEqual(mk('img-h', 'url-new').replayHash, base.replayHash); // replayHash ผูกไฟล์จริง (คนละหน้าที่)
});

test('specHash represents committed primaries only: backup pool changes must not move it', () => {
  const dna = loadLibraryRef('REF-mrbq660y-la4b');
  const mk = (backups) => buildSelectionSpec({
    contract: buildRefSlotContract({ refDNA: dna }),
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedSlots: { hero: { id: 'img-h', imageUrl: 'url-h' } },
    backups,
    refId: 'REF-mrbq660y-la4b',
  });
  const a = mk([{ candidateId: 'b1', imageUrl: 'bu1' }]);
  const b = mk([{ candidateId: 'b2', imageUrl: 'bu2' }, { candidateId: 'b3', imageUrl: 'bu3' }]);
  assert.equal(a.specHash, b.specHash);            // strict ห้ามใช้ backup — พูลเปลี่ยนต้องไม่ขยับตัวตนแผน
  assert.notEqual(a.backupPoolHash, b.backupPoolHash); // ตัวตนพูลสำรองแยกต่างหาก
  assert.notEqual(a.replayHash, b.replayHash);         // replay เห็นความต่างของพูลจริง
});

test('finalAssignmentTrace with SelectionSpec: circle primary=null never counts any image as kept', () => {
  const dna = loadLibraryRef('REF-mrbq660y-la4b');
  const planned = {
    hero: { id: 'img-h', imageUrl: 'url-h' },
    reaction: { id: 'img-r', imageUrl: 'url-r' },
    action: { id: 'img-a', imageUrl: 'url-a' },
    context: { id: 'img-c', imageUrl: 'url-c' },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const spec = buildSelectionSpec({ contract, realizedTemplate: dnaToTemplateSpec(dna), plannedSlots: planned, refId: 'REF-mrbq660y-la4b' });
  const trace = buildFinalAssignmentTrace({
    refSlotContract: contract,
    selectionSpec: spec,
    plannedSlots: planned,
    manifestSlots: [
      { slot: 'main', imageUrl: 'url-h' },
      { slot: 'context_1', imageUrl: 'url-c' },
      { slot: 'victim_2', imageUrl: 'url-a' },
      { slot: 'circle', imageUrl: 'url-c' }, // composer เอาภาพ context ลงวง — ห้ามเป็น kept เด็ดขาด
    ],
  });
  const circle = trace.slots.find((s) => s.finalSlot === 'circle');
  assert.equal(circle.resolvedBy, 'selection_spec');
  assert.equal(circle.expectedPlanRole, 'circle');
  assert.equal(circle.keptExpectedPrimary, false);
  assert.equal(circle.status, 'missing_expected'); // spec บอกไม่มี primary — ภาพใดๆ = missing ไม่ใช่ kept
  assert.equal(trace.partition.kept + trace.partition.changed + trace.partition.missingExpected + trace.partition.unmapped, trace.total);
  assert.equal(trace.missingExpected, 1);
  assert.equal(trace.unknownExpected, 0); // ★ รอบ 4 P1: unknownExpected = unmapped เท่านั้น (ไม่รวม missing)
});

test('with SelectionSpec present, out-of-contract manifest slots are unmapped — never legacy-kept', () => {
  const dna = loadLibraryRef('REF-mrbq660y-la4b');
  const planned = {
    hero: { id: 'img-h', imageUrl: 'url-h' },
    reaction: { id: 'img-r', imageUrl: 'url-r' },
    action: { id: 'img-a', imageUrl: 'url-a' },
    context: { id: 'img-c', imageUrl: 'url-c' },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const spec = buildSelectionSpec({ contract, realizedTemplate: dnaToTemplateSpec(dna), plannedSlots: planned, refId: 'REF-mrbq660y-la4b' });
  const trace = buildFinalAssignmentTrace({
    refSlotContract: contract,
    selectionSpec: spec,
    plannedSlots: planned,
    manifestSlots: [
      { slot: 'main', imageUrl: 'url-h' },
      { slot: 'context_9', imageUrl: 'url-c' }, // composer เพิ่มช่องนอกสัญญา URL ตรง planned context เป๊ะ
    ],
  });
  const rogue = trace.slots.find((s) => s.finalSlot === 'context_9');
  assert.equal(rogue.status, 'unmapped');                    // ห้ามเป็น kept และห้ามถอย legacy positional
  assert.equal(rogue.resolvedBy, 'selection_spec_unmapped');
  assert.equal(rogue.keptExpectedPrimary, false);
  assert.equal(trace.partition.unmapped, 1);
});

test('duplicate composerSlotId inside a spec is ambiguous — no silent last-wins resolution', () => {
  const spec = {
    v: 1,
    slots: [
      { composerSlotId: 'circle', refSlotId: 'moment', refRole: 'moment', legacySlot: 'circle', primary: { candidateId: 'a', imageUrl: 'u-a' } },
      { composerSlotId: 'circle', refSlotId: 'moment_2', refRole: 'moment', legacySlot: null, primary: { candidateId: 'b', imageUrl: 'u-b' } },
    ],
  };
  const trace = buildFinalAssignmentTrace({
    selectionSpec: spec,
    plannedSlots: {},
    manifestSlots: [{ slot: 'circle', imageUrl: 'u-b' }], // ตรง primary ตัวท้าย — last-wins จะให้ kept ซึ่งผิด
  });
  assert.equal(trace.slots[0].status, 'unmapped');
  assert.equal(trace.slots[0].resolvedBy, 'selection_spec_ambiguous');
  assert.equal(trace.slots[0].keptExpectedPrimary, false);
});

test('source-level: refMatch constructors add refId only under the MEGA_SELECTION_SPEC switch', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  const constructors = src.match(/job\.dossier\.refMatch = \{[^\n]*/g) || [];
  assert.equal(constructors.length, 2, 'must have exactly the locked and matched refMatch constructors');
  for (const line of constructors) {
    const hits = (line.match(/refId:/g) || []).length;
    assert.equal(hits, 1, 'refId must appear exactly once per constructor');
    assert.ok(line.includes("process.env.MEGA_SELECTION_SPEC === '1'"), 'refId must be gated by the switch');
    assert.ok(line.includes('? { refId:'), 'refId must exist only inside the switch ternary (switch off = no property at all)');
  }
});

test('source-level: weak-match strip lives on selectionRefDNA only; composer payload keeps legacy refDNA', () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  assert.ok(src.includes('refDNA = m.ref.dna; // payload/composer: legacy เดิมเป๊ะ ห้าม strip'), 'payload refDNA must stay legacy/unstripped');
  assert.ok(src.includes("selectionRefDNA = m.typeMatched ? m.ref.dna : { ...m.ref.dna, slots: [], neededShots: [], storyFlow: '', compositionLogic: '' }"), 'weak strip must apply to selectionRefDNA only');
  assert.ok(src.includes('buildRefSlotContract({ refDNA: selectionRefDNA'), 'spec contract must be built from selectionRefDNA');
  assert.ok(!src.includes('refDNA = m.typeMatched'), 'payload refDNA must never be conditionally stripped');
  assert.ok(src.includes('...(refDNA ? { refDNA } : {})'), 'composer payload must still send the legacy refDNA');
});

test('finalAssignmentTrace resolves multiple circles by composerSlotId exactly (no first-circle shortcut)', () => {
  const dna = {
    template: {
      slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 60, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 60, yPct: 0, wPct: 40, hPct: 100 },
        { role: 'moment', shape: 'circle', xPct: 5, yPct: 60, wPct: 30, hPct: 24 },
        { role: 'moment', shape: 'circle', xPct: 62, yPct: 62, wPct: 30, hPct: 24 },
      ],
    },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const spec = buildSelectionSpec({
    contract,
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedSlots: { circle: { id: 'img-o', imageUrl: 'url-o' } },
  });
  const trace = buildFinalAssignmentTrace({
    refSlotContract: contract,
    selectionSpec: spec,
    plannedSlots: { circle: { id: 'img-o', imageUrl: 'url-o' } },
    manifestSlots: [
      { slot: 'circle', imageUrl: 'url-o' },  // วงแรก = primary จริง
      { slot: 'circle1', imageUrl: 'url-x' }, // วงสอง = คนละ spec slot ห้ามยืมของวงแรก
    ],
  });
  assert.equal(trace.slots[0].refSlotId, 'moment');
  assert.equal(trace.slots[0].status, 'kept_expected_primary');
  assert.equal(trace.slots[1].refSlotId, 'moment_2');
  assert.notEqual(trace.slots[1].status, 'kept_expected_primary'); // ต้องไม่ resolve ชน spec ของวงแรก
  assert.equal(trace.slots[1].status, 'unmapped'); // moment_2 ไม่มีบทให้ join (planKey null)
});

test('strictReady rejects duplicate primary candidateId across slots', () => {
  const dna = loadLibraryRef('REF-mrbq6pds-3dil');
  const spec = buildSelectionSpec({
    contract: buildRefSlotContract({ refDNA: dna }),
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedSlots: {
      hero: { id: 'dup', imageUrl: 'u1' },
      reaction: { id: 'dup', imageUrl: 'u2' }, // id ซ้ำข้ามช่อง — ต้องไม่ strictReady
      action: { id: 'p3', imageUrl: 'u3' },
      context: { id: 'p4', imageUrl: 'u4' },
      circle: { id: 'p5', imageUrl: 'u5' },
    },
    refId: 'REF-mrbq6pds-3dil',
  });
  assert.equal(spec.counts.missingPrimary, 0);
  assert.equal(spec.counts.duplicatePrimary, 1);
  assert.equal(spec.strictReady, false);
});

test('selectionSpec keeps duplicated roles unique for REF-mrbq6pds-3dil', () => {
  const dna = loadLibraryRef('REF-mrbq6pds-3dil');
  const contract = buildRefSlotContract({ refDNA: dna });
  const planned = {
    hero: { id: 'p1', imageUrl: 'u1' },
    reaction: { id: 'p2', imageUrl: 'u2' },
    action: { id: 'p3', imageUrl: 'u3' },
    context: { id: 'p4', imageUrl: 'u4' },
    circle: { id: 'p5', imageUrl: 'u5' },
  };
  const spec = buildSelectionSpec({ contract, realizedTemplate: dnaToTemplateSpec(dna), plannedSlots: planned, refId: 'REF-mrbq6pds-3dil' });
  assert.equal(spec.counts.total, 5);
  assert.equal(spec.counts.unmapped, 0);
  assert.deepEqual(spec.slots.map((s) => s.refSlotId), ['hero', 'hero_2', 'context', 'context_2', 'moment']);
  const composerIds = spec.slots.map((s) => s.composerSlotId);
  assert.equal(new Set(composerIds).size, composerIds.length, 'duplicated roles must still yield unique composer ids');
  const heroDup = spec.slots.find((s) => s.refSlotId === 'hero_2');
  assert.equal(heroDup.legacySlot, 'reaction');
  assert.equal(heroDup.primary.candidateId, 'p2');
});

test('selectionSpec supports multiple circles with unique ids', () => {
  const dna = {
    template: {
      slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 60, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 60, yPct: 0, wPct: 40, hPct: 100 },
        { role: 'moment', shape: 'circle', xPct: 5, yPct: 60, wPct: 30, hPct: 24 },
        { role: 'moment', shape: 'circle', xPct: 62, yPct: 62, wPct: 30, hPct: 24 },
      ],
    },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const spec = buildSelectionSpec({ contract, realizedTemplate: dnaToTemplateSpec(dna), plannedSlots: {} });
  assert.deepEqual(spec.slots.map((s) => s.refSlotId), ['hero', 'context', 'moment', 'moment_2']);
  const circles = spec.slots.filter((s) => s.shape === 'circle').map((s) => s.composerSlotId);
  assert.equal(new Set(circles).size, 2, 'both circles must map to distinct realized ids');
  assert.equal(spec.counts.missingPrimary, 4); // ไม่มีแผน = missing ทุกช่อง ไม่ throw ไม่เดา
  assert.equal(spec.strictReady, false);
});

test('selectionSpec is deterministic (same input → same JSON and specHash)', () => {
  const dna = loadLibraryRef('REF-mrbq6pds-3dil');
  const build = () => buildSelectionSpec({
    contract: buildRefSlotContract({ refDNA: dna }),
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedSlots: { hero: { id: 'p1', imageUrl: 'u1' }, reaction: { id: 'p2', imageUrl: 'u2' } },
    backups: [{ candidateId: 'b1', imageUrl: 'bu1' }],
    refId: 'REF-mrbq6pds-3dil',
  });
  const a = build();
  const b = build();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.specHash, b.specHash);
  assert.match(a.specHash, /^[0-9a-f]{8}$/);
  assert.equal(a.slots[0].backups[0].candidateId, 'b1'); // backup candidateId identity
});

test('finalAssignmentTrace partition (spec-present): kept+changed+missingExpected+unmapped = total and missing never counts as changed', () => {
  const planned = {
    hero: { id: 'h', imageUrl: 'url-h' },
    reaction: { id: 'r', imageUrl: 'url-r' },
    // action หายจากแผน (missing) — ต้องไม่ถูกนับเป็น changed · circle หายด้วย
    context: { id: 'c', imageUrl: 'url-c' },
  };
  const contract = buildRefSlotContract({ refDNA: ref });
  const spec = buildSelectionSpec({ contract, realizedTemplate: dnaToTemplateSpec(ref), plannedSlots: planned });
  const trace = buildFinalAssignmentTrace({
    refSlotContract: contract,
    selectionSpec: spec,
    plannedSlots: planned,
    manifestSlots: [
      { slot: 'main', imageUrl: 'url-h' },        // kept (spec hero primary)
      { slot: 'context_1', imageUrl: 'url-x' },    // changed (spec context คาด url-c)
      { slot: 'evidence_2', imageUrl: 'url-c' },   // missing_expected (evidence จับบท action ที่แผนไม่มี)
      { slot: 'mystery_9', imageUrl: 'url-z' },    // unmapped (นอกสัญญา — spec authority)
    ],
  });
  const p = trace.partition;
  assert.equal(p.kept + p.changed + p.missingExpected + p.unmapped, trace.total);
  assert.deepEqual(p, { kept: 1, changed: 1, missingExpected: 1, unmapped: 1 });
  assert.equal(trace.slots[2].status, 'missing_expected');
  assert.equal(trace.slots[3].status, 'unmapped');
  assert.equal(trace.slots[3].resolvedBy, 'selection_spec_unmapped');
});

console.log(`1..${passed}`);
