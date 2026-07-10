import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRefSlotContract,
  buildFinalAssignmentTrace,
  buildSelectionSpec,
  projectLegacySelections,
  restrictCandidateUniverse,
  validateStrictRenderActivation,
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
  // ★ Checkpoint A: completeness เติม spec slot ที่หายจาก manifest (reaction_3, circle) เป็น missing เพิ่มอีก 2
  assert.deepEqual(p, { kept: 1, changed: 1, missingExpected: 3, unmapped: 1 });
  assert.equal(trace.total, 6);
  assert.equal(trace.slots[2].status, 'missing_expected');
  assert.equal(trace.slots[3].status, 'unmapped');
  assert.equal(trace.slots[3].resolvedBy, 'selection_spec_unmapped');
  assert.equal(trace.slots.filter((s) => s.resolvedBy === 'selection_spec_missing_manifest').length, 2);
});

// ═══════════ 🛡️ Strict Renderer Checkpoint A — pure activation validator ═══════════

const SRA_DNA = {
  template: {
    slots: [
      { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
      { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
      { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
    ],
  },
};
const sraValidFixture = () => {
  const contract = buildRefSlotContract({ refDNA: SRA_DNA });
  const realized = dnaToTemplateSpec(SRA_DNA);
  const P = (cid) => ({ candidateId: cid, imageUrl: `https://cdn.test/${cid}.jpg`, backups: [] });
  const spec = buildSelectionSpec({
    contract,
    realizedTemplate: realized,
    plannedByRefSlot: {
      hero: { ...P('H'), backups: [{ candidateId: 'B1', imageUrl: 'https://cdn.test/B1.jpg' }] },
      context: P('C'),
      moment: P('M'),
    },
    refId: 'REF-SRA-VALID',
  });
  return { spec, realized };
};
const sraClone = (o) => JSON.parse(JSON.stringify(o));

test('SRA-1 absent own-property: legacy_absent, active=false, failClosed=false', () => {
  for (const input of [{}, { realizedTemplate: {} }, undefined]) {
    const r = validateStrictRenderActivation(input);
    assert.deepEqual(r, { decision: 'legacy_absent', active: false, failClosed: false, reasons: [] });
  }
});

test('SRA-2 present แต่ undefined/null/array/string/{}: reject_invalid + failClosed — ห้าม silent legacy', () => {
  for (const bad of [undefined, null, [], 'spec', 42]) {
    const r = validateStrictRenderActivation({ selectionSpec: bad });
    assert.equal(r.decision, 'reject_invalid', `ค่า ${JSON.stringify(bad)} ต้อง reject`);
    assert.equal(r.active, false);
    assert.equal(r.failClosed, true);
    assert.ok(r.reasons.length >= 1);
  }
  const r2 = validateStrictRenderActivation({ selectionSpec: {} });
  assert.equal(r2.decision, 'reject_invalid');
  assert.ok(r2.reasons.includes('too_few_slots'));
});

test('SRA-3 valid ครบ: strict_ready + authority normalized (สำเนาลึก ไม่ใช่ reference)', () => {
  const { spec, realized } = sraValidFixture();
  assert.equal(spec.strictReady, true, 'fixture ต้อง ready จริงก่อน');
  const r = validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: realized });
  assert.equal(r.decision, 'strict_ready');
  assert.equal(r.active, true);
  assert.equal(r.failClosed, false);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.authority.refId, 'REF-SRA-VALID');
  assert.equal(r.authority.specHash, spec.specHash);
  assert.deepEqual(r.authority.slots.map((s) => s.composerSlotId), ['main', 'context_1', 'circle']);
  assert.deepEqual(r.authority.slots[0].backups, [{ candidateId: 'B1', imageUrl: 'https://cdn.test/B1.jpg' }]);
  r.authority.slots[0].primary.candidateId = 'HACKED';
  assert.equal(spec.slots[0].primary.candidateId, 'H', 'mutate authority ต้องไม่สะท้อนกลับ spec');
});

test('SRA-4 strictReady=false → reject ด้วยเหตุ strict_ready_false', () => {
  const { spec, realized } = sraValidFixture();
  const s = sraClone(spec);
  s.strictReady = false;
  const r = validateStrictRenderActivation({ selectionSpec: s, realizedTemplate: realized });
  assert.equal(r.decision, 'reject_invalid');
  assert.ok(r.reasons.includes('strict_ready_false'));
});

test('SRA-5 wrong v/mode/source/stale/refId — จับครบทีละเหตุ', () => {
  const { spec, realized } = sraValidFixture();
  const cases = [
    [(s) => { s.v = 2; }, 'bad_version'],
    [(s) => { s.mode = 'legacy'; }, 'bad_mode'],
    [(s) => { s.source = 'slots'; }, 'bad_source'],
    [(s) => { s.authorityStale = true; }, 'authority_stale'],
    [(s) => { s.refId = '   '; }, 'missing_ref_id'],
  ];
  for (const [mut, reason] of cases) {
    const s = sraClone(spec);
    mut(s);
    const r = validateStrictRenderActivation({ selectionSpec: s, realizedTemplate: realized });
    assert.equal(r.decision, 'reject_invalid', reason);
    assert.ok(r.reasons.includes(reason), `ต้องมีเหตุ ${reason} (ได้: ${r.reasons})`);
  }
});

test('SRA-6 duplicate ทุกชนิด: ref/composer/primary id/primary URL', () => {
  const { spec, realized } = sraValidFixture();
  const cases = [
    [(s) => { s.slots[1].refSlotId = s.slots[0].refSlotId; }, 'dup_ref_slot_id'],
    [(s) => { s.slots[1].composerSlotId = s.slots[0].composerSlotId; }, 'dup_composer_slot_id'],
    [(s) => { s.slots[1].primary.candidateId = s.slots[0].primary.candidateId; }, 'dup_primary_candidate'],
    [(s) => { s.slots[1].primary.imageUrl = s.slots[0].primary.imageUrl; }, 'dup_primary_url'],
  ];
  for (const [mut, reason] of cases) {
    const s = sraClone(spec);
    mut(s);
    const r = validateStrictRenderActivation({ selectionSpec: s, realizedTemplate: realized });
    assert.equal(r.decision, 'reject_invalid', reason);
    assert.ok(r.reasons.includes(reason), `ต้องมีเหตุ ${reason} (ได้: ${r.reasons})`);
  }
});

test('SRA-7 forged counts/diagnostics: เลขสวยแต่โกหกต้องโดน recompute จับ', () => {
  const { spec, realized } = sraValidFixture();
  const s1 = sraClone(spec);
  s1.counts.missingPrimary = 1;
  const r1 = validateStrictRenderActivation({ selectionSpec: s1, realizedTemplate: realized });
  assert.ok(r1.reasons.includes('counts_mismatch:missingPrimary'));
  const s2 = sraClone(spec);
  s2.diagnostics.extraPlannedKeys = ['stale'];
  const r2 = validateStrictRenderActivation({ selectionSpec: s2, realizedTemplate: realized });
  assert.ok(r2.reasons.includes('diagnostics_blocking:extraPlannedKeys'));
  const s3 = sraClone(spec);
  s3.diagnostics.missingRefId = true;
  const r3 = validateStrictRenderActivation({ selectionSpec: s3, realizedTemplate: realized });
  assert.ok(r3.reasons.includes('diagnostics_blocking:missingRefId'));
});

test('SRA-8 tamper จับด้วย hash: candidate-only / URL-only / backup — แยกมิติถูกตัว', () => {
  const { spec, realized } = sraValidFixture();
  const s1 = sraClone(spec);
  s1.slots[0].primary.candidateId = 'H2';
  const r1 = validateStrictRenderActivation({ selectionSpec: s1, realizedTemplate: realized });
  assert.ok(r1.reasons.includes('spec_hash_mismatch'));
  const s2 = sraClone(spec);
  s2.slots[0].primary.imageUrl = 'https://cdn.test/H-moved.jpg';
  const r2 = validateStrictRenderActivation({ selectionSpec: s2, realizedTemplate: realized });
  assert.ok(!r2.reasons.includes('spec_hash_mismatch'), 'specHash = identity ล้วน ห้ามพังเพราะ URL');
  assert.ok(r2.reasons.includes('replay_hash_mismatch'));
  const s3 = sraClone(spec);
  s3.slots[0].backups[0].candidateId = 'B9';
  const r3 = validateStrictRenderActivation({ selectionSpec: s3, realizedTemplate: realized });
  assert.ok(!r3.reasons.includes('spec_hash_mismatch'));
  assert.ok(r3.reasons.includes('backup_pool_hash_mismatch'));
});

test('SRA-9 backup ชน primary / ซ้ำข้าม owner — จับพร้อมเหตุราย slot', () => {
  const { spec, realized } = sraValidFixture();
  const s1 = sraClone(spec);
  s1.slots[1].backups = [{ candidateId: 'H', imageUrl: 'https://cdn.test/other.jpg' }];
  const r1 = validateStrictRenderActivation({ selectionSpec: s1, realizedTemplate: realized });
  assert.ok(r1.reasons.some((x) => x.startsWith('backup_collides_primary')));
  const s2 = sraClone(spec);
  s2.slots[1].backups = [{ candidateId: 'B1', imageUrl: 'https://cdn.test/B1.jpg' }];
  const r2 = validateStrictRenderActivation({ selectionSpec: s2, realizedTemplate: realized });
  assert.ok(r2.reasons.some((x) => x.startsWith('backup_dup_across_owners')));
});

test('SRA-10 realized missing/หาย/เกิน/เปลี่ยนชื่อ: เซ็ต id ต้องเท่ากับ composerSlotId เป๊ะ', () => {
  const { spec, realized } = sraValidFixture();
  const r0 = validateStrictRenderActivation({ selectionSpec: spec });
  assert.ok(r0.reasons.includes('realized_missing'));
  const rt1 = sraClone(realized);
  rt1.slots = rt1.slots.slice(0, 2);
  assert.ok(validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: rt1 }).reasons.includes('realized_set_mismatch'));
  const rt2 = sraClone(realized);
  rt2.slots.push({ ...rt2.slots[0], id: 'ghost_9' });
  assert.ok(validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: rt2 }).reasons.includes('realized_set_mismatch'));
  const rt3 = sraClone(realized);
  rt3.slots[0].id = 'main_renamed';
  assert.ok(validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: rt3 }).reasons.includes('realized_set_mismatch'));
});

test('SRA-11 determinism: input เดิม 2 รอบ byte-identical ทั้งขา ready และขา reject', () => {
  const { spec, realized } = sraValidFixture();
  const a = validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: realized });
  const b = validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: realized });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const bad = sraClone(spec);
  bad.strictReady = false;
  bad.slots[1].primary.candidateId = bad.slots[0].primary.candidateId;
  const c1 = validateStrictRenderActivation({ selectionSpec: bad, realizedTemplate: realized });
  const c2 = validateStrictRenderActivation({ selectionSpec: bad, realizedTemplate: realized });
  assert.equal(JSON.stringify(c1), JSON.stringify(c2), 'reasons ต้อง deterministic ทั้งค่าและลำดับ');
});

test('SRA-17 (P0 fail-open): diagnostics เป็นส่วนบังคับ — หาย/พัง/forge ต้อง reject · sanitation ยัง ready ได้', () => {
  const { spec, realized } = sraValidFixture();
  // (A) valid spec แต่ลบ diagnostics ทั้งก้อน → reject failClosed
  const sA = sraClone(spec);
  delete sA.diagnostics;
  const rA = validateStrictRenderActivation({ selectionSpec: sA, realizedTemplate: realized });
  assert.equal(rA.decision, 'reject_invalid');
  assert.equal(rA.failClosed, true);
  assert.ok(rA.reasons.includes('diagnostics_not_object'));
  // (B) diagnostics={} → malformed ทั้ง 4 field · และลบ required array ทีละตัว → malformed ราย field
  const sB = sraClone(spec);
  sB.diagnostics = {};
  const rB = validateStrictRenderActivation({ selectionSpec: sB, realizedTemplate: realized });
  for (const f of ['extraPlannedKeys', 'invalidPrimary', 'aliasPrimaryUrls', 'duplicateBackupsDropped']) {
    assert.ok(rB.reasons.includes(`diagnostics_malformed:${f}`), `ต้องฟ้อง ${f}`);
  }
  for (const f of ['extraPlannedKeys', 'invalidPrimary', 'aliasPrimaryUrls', 'duplicateBackupsDropped']) {
    const sBi = sraClone(spec);
    delete sBi.diagnostics[f];
    const rBi = validateStrictRenderActivation({ selectionSpec: sBi, realizedTemplate: realized });
    assert.equal(rBi.decision, 'reject_invalid', f);
    assert.ok(rBi.reasons.includes(`diagnostics_malformed:${f}`));
    const sBn = sraClone(spec);
    sBn.diagnostics[f] = null; // null/wrong type ก็ต้อง reject
    assert.ok(validateStrictRenderActivation({ selectionSpec: sBn, realizedTemplate: realized }).reasons.includes(`diagnostics_malformed:${f}`));
  }
  // (C) adversarial ตาม reproduce ของ Codex: extra 'ghost' → forge strictReady=true + delete diagnostics
  const contract = buildRefSlotContract({ refDNA: SRA_DNA });
  const P = (cid) => ({ candidateId: cid, imageUrl: `https://cdn.test/${cid}.jpg`, backups: [] });
  const ghostSpec = buildSelectionSpec({
    contract,
    realizedTemplate: realized,
    plannedByRefSlot: { hero: P('H'), context: P('C'), moment: P('M'), ghost: P('G') },
    refId: 'REF-SRA-VALID',
  });
  assert.equal(ghostSpec.strictReady, false);
  assert.deepEqual(ghostSpec.diagnostics.extraPlannedKeys, ['ghost']);
  const forged = sraClone(ghostSpec);
  forged.strictReady = true;
  delete forged.diagnostics;
  const rC = validateStrictRenderActivation({ selectionSpec: forged, realizedTemplate: realized });
  assert.equal(rC.decision, 'reject_invalid', 'forge strictReady + ลบ diagnostics ต้องไม่หลุดเป็น strict_ready');
  assert.equal(rC.active, false);
  assert.ok(rC.reasons.includes('diagnostics_not_object'));
  // (D) sanitation จริงจาก builder: backup ชน primary ถูก drop (dropped nonempty) + backup ที่เหลือ valid → ยัง strict_ready
  const sanSpec = buildSelectionSpec({
    contract,
    realizedTemplate: realized,
    plannedByRefSlot: {
      hero: { ...P('H'), backups: [ { candidateId: 'C', imageUrl: 'https://cdn.test/xx.jpg' }, { candidateId: 'B3', imageUrl: 'https://cdn.test/B3.jpg' } ] },
      context: P('C'),
      moment: P('M'),
    },
    refId: 'REF-SRA-VALID',
  });
  assert.ok(sanSpec.diagnostics.duplicateBackupsDropped.length >= 1, 'fixture ต้องมี sanitation จริง');
  assert.equal(sanSpec.strictReady, true);
  const rD = validateStrictRenderActivation({ selectionSpec: sanSpec, realizedTemplate: realized });
  assert.equal(rD.decision, 'strict_ready', 'sanitation nonempty + backup เหลือ valid ต้องยัง ready');
  assert.deepEqual(rD.authority.slots[0].backups, [{ candidateId: 'B3', imageUrl: 'https://cdn.test/B3.jpg' }]);
});

// ── Checkpoint A: trace completeness (เส้น spec v2 เท่านั้น) ──

const sraSpecForTrace = () => {
  const contract = buildRefSlotContract({ refDNA: SRA_DNA });
  const P = (cid) => ({ candidateId: cid, imageUrl: `https://cdn.test/${cid}.jpg`, backups: [] });
  return buildSelectionSpec({
    contract,
    realizedTemplate: dnaToTemplateSpec(SRA_DNA),
    plannedByRefSlot: { hero: P('H'), context: P('C'), moment: P('M') },
    refId: 'REF-SRA-TRACE',
  });
};

test('SRA-12 completeness: spec 3 + manifest 2 → total3 kept2 missingExpected1 (ช่องหายถูกเติมพร้อม resolvedBy)', () => {
  const spec = sraSpecForTrace();
  const trace = buildFinalAssignmentTrace({
    selectionSpec: spec,
    plannedSlots: {},
    manifestSlots: [
      { slot: 'main', imageUrl: 'https://cdn.test/H.jpg' },
      { slot: 'context_1', imageUrl: 'https://cdn.test/C.jpg' },
    ],
  });
  assert.equal(trace.total, 3);
  assert.deepEqual(trace.partition, { kept: 2, changed: 0, missingExpected: 1, unmapped: 0 });
  const missing = trace.slots.find((s) => s.finalSlot === 'circle');
  assert.equal(missing.status, 'missing_expected');
  assert.equal(missing.resolvedBy, 'selection_spec_missing_manifest');
  assert.equal(missing.expectedCandidateId, 'M');
});

test('SRA-13 completeness: manifest ว่าง → missing ครบทุกช่อง', () => {
  const spec = sraSpecForTrace();
  const trace = buildFinalAssignmentTrace({ selectionSpec: spec, plannedSlots: {}, manifestSlots: [] });
  assert.equal(trace.total, 3);
  assert.deepEqual(trace.partition, { kept: 0, changed: 0, missingExpected: 3, unmapped: 0 });
  assert.ok(trace.slots.every((s) => s.resolvedBy === 'selection_spec_missing_manifest'));
});

test('SRA-14 completeness: extra row นอกสัญญา + expected หาย → นับทั้ง unmapped และ missing', () => {
  const spec = sraSpecForTrace();
  const trace = buildFinalAssignmentTrace({
    selectionSpec: spec,
    plannedSlots: {},
    manifestSlots: [
      { slot: 'main', imageUrl: 'https://cdn.test/H.jpg' },
      { slot: 'context_1', imageUrl: 'https://cdn.test/C.jpg' },
      { slot: 'ghost_7', imageUrl: 'https://cdn.test/G.jpg' },
    ],
  });
  assert.equal(trace.total, 4); // 3 rows จริง + เติม circle ที่หาย
  assert.deepEqual(trace.partition, { kept: 2, changed: 0, missingExpected: 1, unmapped: 1 });
});

test('SRA-15 duplicate final row (P1-D): row แรกเท่านั้นนับ kept — row ซ้ำ = unmapped + resolvedBy duplicate_manifest', () => {
  const spec = sraSpecForTrace();
  const trace = buildFinalAssignmentTrace({
    selectionSpec: spec,
    plannedSlots: {},
    manifestSlots: [
      { slot: 'main', imageUrl: 'https://cdn.test/H.jpg' },
      { slot: 'main', imageUrl: 'https://cdn.test/H.jpg' }, // row ซ้ำ — ห้ามนับ kept เบิ้ล
      { slot: 'context_1', imageUrl: 'https://cdn.test/C.jpg' },
      { slot: 'circle', imageUrl: 'https://cdn.test/M.jpg' },
    ],
  });
  const p = trace.partition;
  assert.equal(p.kept + p.changed + p.missingExpected + p.unmapped, trace.total, 'invariant ต้องคงอยู่');
  assert.equal(trace.total, 4);
  // ★ รอบ 2: เดิม kept=4 (นับซ้ำ = โกงเปอร์เซ็นต์ได้) → ตอนนี้ kept=3 unmapped=1
  assert.deepEqual(p, { kept: 3, changed: 0, missingExpected: 0, unmapped: 1 });
  const dup = trace.slots[1];
  assert.equal(dup.finalSlot, 'main');
  assert.equal(dup.status, 'unmapped');
  assert.equal(dup.resolvedBy, 'selection_spec_duplicate_manifest');
  assert.equal(dup.keptExpectedPrimary, false);
  assert.equal(trace.slots[0].status, 'kept_expected_primary', 'row แรกของช่องเดิมยังนับปกติ');
});

test('SRA-18 (P0-A) spec present แต่ malformed ({} / slots:[] / slots:"bad"): เดิน v2 เสมอ · kept=0 · ทุก row unmapped — ห้ามถอย legacy', () => {
  // plannedSlots + manifest URL ตรงกันเป๊ะ — เส้น legacy v1 จะนับ kept ได้ 2 ทันที
  // spec ที่ "มีตัวตนแต่พัง" ต้องกันไม่ให้เกิดขึ้น: v2 + unmapped ล้วน
  const planned = {
    hero: { id: 'h', imageUrl: 'https://cdn.test/H.jpg' },
    context: { id: 'c', imageUrl: 'https://cdn.test/C.jpg' },
  };
  const manifest = [
    { slot: 'main', imageUrl: 'https://cdn.test/H.jpg' },
    { slot: 'context_1', imageUrl: 'https://cdn.test/C.jpg' },
  ];
  for (const badSpec of [{}, { slots: [] }, { slots: 'bad' }]) {
    const trace = buildFinalAssignmentTrace({ selectionSpec: badSpec, plannedSlots: planned, manifestSlots: manifest });
    assert.equal(trace.v, 2, `spec ${JSON.stringify(badSpec)} ต้องเดิน v2 ไม่ใช่ legacy v1`);
    assert.equal(trace.total, 2);
    assert.deepEqual(trace.partition, { kept: 0, changed: 0, missingExpected: 0, unmapped: 2 });
    assert.ok(trace.slots.every((s) => s.status === 'unmapped' && s.resolvedBy === 'selection_spec_unmapped'));
    assert.ok(trace.slots.every((s) => s.keptExpectedPrimary === false));
  }
});

test('SRA-19 (P1-B) own-property บนพาหะไม่ใช่ plain object: array/function พก selectionSpec → input_not_plain_object · ไม่พก → legacy_absent', () => {
  const arr = [];
  arr.selectionSpec = { slots: [] };
  assert.deepEqual(
    validateStrictRenderActivation(arr),
    { decision: 'reject_invalid', active: false, failClosed: true, reasons: ['input_not_plain_object'] },
    'array ที่พก selectionSpec ห้ามหลุดเป็น legacy_absent'
  );
  const fn = () => {};
  fn.selectionSpec = null;
  assert.deepEqual(
    validateStrictRenderActivation(fn),
    { decision: 'reject_invalid', active: false, failClosed: true, reasons: ['input_not_plain_object'] },
    'function ที่พก selectionSpec (แม้ค่า null) ต้อง reject ไม่ใช่ legacy'
  );
  // พาหะแบบเดียวกันแต่ "ไม่มี" property จริง → legacy_absent ตามสัญญาเดิม
  for (const noProp of [[], () => {}, null, undefined]) {
    assert.deepEqual(
      validateStrictRenderActivation(noProp),
      { decision: 'legacy_absent', active: false, failClosed: false, reasons: [] }
    );
  }
});

test('SRA-20 (P1-C) schema hardening: stale ครึ่งจริง / backups หาย / shape พัง / BigInt / cyclic — reject หมดโดยไม่ throw', () => {
  const { spec, realized } = sraValidFixture();
  // (A) authorityStale ครึ่งจริง → authority_stale_invalid · false/ไม่มี field = ยอม
  for (const half of ['true', 1, {}]) {
    const s = sraClone(spec);
    s.authorityStale = half;
    const r = validateStrictRenderActivation({ selectionSpec: s, realizedTemplate: realized });
    assert.equal(r.decision, 'reject_invalid', `stale=${JSON.stringify(half)}`);
    assert.ok(r.reasons.includes('authority_stale_invalid'));
  }
  const sFalse = sraClone(spec);
  sFalse.authorityStale = false;
  assert.equal(validateStrictRenderActivation({ selectionSpec: sFalse, realizedTemplate: realized }).decision, 'strict_ready', 'false ต้องยังผ่าน');
  // (B) backups missing/null/ชนิดผิด → backups_not_array:<i> (เดิม null = หลุดผ่านเงียบ)
  for (const badBk of ['__DELETE__', null, 'bad']) {
    const s = sraClone(spec);
    if (badBk === '__DELETE__') delete s.slots[1].backups; else s.slots[1].backups = badBk;
    const r = validateStrictRenderActivation({ selectionSpec: s, realizedTemplate: realized });
    assert.equal(r.decision, 'reject_invalid', `backups=${String(badBk)}`);
    assert.ok(r.reasons.includes('backups_not_array:1'));
  }
  // (C) shape พัง (null/{}/blank) → slot_shape_invalid:<i> — authority ใช้ shape จริง ห้ามรับขยะ
  for (const badShape of [null, {}, '', '   ']) {
    const s = sraClone(spec);
    s.slots[0].shape = badShape;
    const r = validateStrictRenderActivation({ selectionSpec: s, realizedTemplate: realized });
    assert.equal(r.decision, 'reject_invalid', `shape=${JSON.stringify(badShape)}`);
    assert.ok(r.reasons.includes('slot_shape_invalid:0'));
  }
  // (D) BigInt ในช่อง identity/backups — JSON.stringify(BigInt) ปกติ throw · validator ต้อง reject เฉยๆ
  const sBig = sraClone(spec);
  sBig.slots[0].refSlotId = BigInt(7);
  let rBig;
  assert.doesNotThrow(() => { rBig = validateStrictRenderActivation({ selectionSpec: sBig, realizedTemplate: realized }); });
  assert.equal(rBig.decision, 'reject_invalid');
  assert.ok(rBig.reasons.includes('slot_ref_id_blank:0'));
  const sBig2 = sraClone(spec);
  sBig2.slots[0].backups = [{ candidateId: BigInt(9), imageUrl: 'https://cdn.test/bx.jpg' }];
  let rBig2;
  assert.doesNotThrow(() => { rBig2 = validateStrictRenderActivation({ selectionSpec: sBig2, realizedTemplate: realized }); });
  assert.equal(rBig2.decision, 'reject_invalid');
  assert.ok(rBig2.reasons.includes('backup_invalid:0'));
  // (E) cyclic object ในช่อง identity — ห้าม throw ตอน stringify hash
  const sCyc = sraClone(spec);
  const cyc = {};
  cyc.self = cyc;
  sCyc.slots[0].primary.candidateId = cyc;
  let rCyc;
  assert.doesNotThrow(() => { rCyc = validateStrictRenderActivation({ selectionSpec: sCyc, realizedTemplate: realized }); });
  assert.equal(rCyc.decision, 'reject_invalid');
  assert.ok(rCyc.reasons.includes('primary_invalid:0'));
  // (F) prototype แปลกปลอม: Date-as-spec / Map-as-diagnostics — plain object แท้เท่านั้น
  assert.deepEqual(
    validateStrictRenderActivation({ selectionSpec: new Date(), realizedTemplate: realized }),
    { decision: 'reject_invalid', active: false, failClosed: true, reasons: ['spec_not_plain_object'] }
  );
  const sMap = sraClone(spec);
  sMap.diagnostics = new Map();
  assert.ok(
    validateStrictRenderActivation({ selectionSpec: sMap, realizedTemplate: realized }).reasons.includes('diagnostics_not_object'),
    'Map มี typeof object แต่ไม่ใช่สัญญา — ต้องโดน diagnostics_not_object'
  );
});

test('SRA-21 (P1-D) mapping พังใน spec + manifest ว่าง: ห้ามหายเงียบ — missing ครบพร้อม resolvedBy บอกสาเหตุ', () => {
  const spec = sraClone(sraSpecForTrace());
  spec.slots[0].composerSlotId = '';        // blank → invalid mapping
  spec.slots[1].composerSlotId = 'circle';  // ชนกับ slots[2] → ambiguous ทั้งคู่
  const trace = buildFinalAssignmentTrace({ selectionSpec: spec, plannedSlots: {}, manifestSlots: [] });
  assert.equal(trace.v, 2);
  assert.equal(trace.total, 3, 'ทุกช่องของ spec ต้องโผล่ใน trace แม้ mapping พัง');
  assert.deepEqual(trace.partition, { kept: 0, changed: 0, missingExpected: 3, unmapped: 0 });
  assert.deepEqual(
    trace.slots.map((s) => s.resolvedBy),
    ['selection_spec_invalid_mapping', 'selection_spec_ambiguous_mapping', 'selection_spec_ambiguous_mapping']
  );
  assert.ok(trace.slots.every((s) => s.status === 'missing_expected' && s.keptExpectedPrimary === false));
});

test('SRA-22 (รอบ3 P1-1) shape authority tamper: circle↔rect สลับ → shape_mismatch:<i> · garbage → slot_shape_invalid · ref จริงผ่าน', () => {
  const { spec, realized } = sraValidFixture();
  // circle (moment, index 2) ปลอมเป็น rect — hash ไม่ผูก shape เดิมหลุด strict_ready + authority แบกค่าปลอม
  const s1 = sraClone(spec);
  s1.slots[2].shape = 'rect';
  const r1 = validateStrictRenderActivation({ selectionSpec: s1, realizedTemplate: realized });
  assert.equal(r1.decision, 'reject_invalid');
  assert.ok(r1.reasons.includes('shape_mismatch:2'), `ได้: ${r1.reasons}`);
  assert.ok(!r1.reasons.includes('spec_hash_mismatch'), 'ยืนยันช่องโหว่จริง: hash จับไม่ได้ — ต้องเป็น shape_mismatch ที่จับ');
  // rect (hero, index 0) ปลอมเป็น circle
  const s2 = sraClone(spec);
  s2.slots[0].shape = 'circle';
  const r2 = validateStrictRenderActivation({ selectionSpec: s2, realizedTemplate: realized });
  assert.equal(r2.decision, 'reject_invalid');
  assert.ok(r2.reasons.includes('shape_mismatch:0'));
  // garbage นอก enum → slot_shape_invalid เท่านั้น (enum พังฟ้องก่อน ไม่เทียบต่อ — กัน reason เบิ้ล)
  const s3 = sraClone(spec);
  s3.slots[1].shape = 'blob';
  const r3 = validateStrictRenderActivation({ selectionSpec: s3, realizedTemplate: realized });
  assert.equal(r3.decision, 'reject_invalid');
  assert.ok(r3.reasons.includes('slot_shape_invalid:1'));
  assert.ok(!r3.reasons.some((x) => x.startsWith('shape_mismatch')));
  // ref จริงยังผ่าน + authority shape ตรง realized ทุกช่อง (rect ฝั่ง realized ไม่มี property = canonical 'rect')
  const rOk = validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: realized });
  assert.equal(rOk.decision, 'strict_ready');
  assert.deepEqual(rOk.authority.slots.map((s) => s.shape), ['rect', 'rect', 'circle']);
});

test('SRA-23 (รอบ3 P1-2) spec พัง + manifest ว่าง: sentinel unmapped 1 row — trace ศูนย์ล้วนห้ามอ่านว่า "ผ่าน"', () => {
  for (const badSpec of [{}, { slots: [] }, { slots: 'bad' }]) {
    const trace = buildFinalAssignmentTrace({ selectionSpec: badSpec, plannedSlots: {}, manifestSlots: [] });
    assert.equal(trace.v, 2, `spec ${JSON.stringify(badSpec)} ต้องเดิน v2`);
    assert.equal(trace.total, 1, 'ต้องมี sentinel 1 row ไม่ใช่ total0');
    assert.deepEqual(trace.partition, { kept: 0, changed: 0, missingExpected: 0, unmapped: 1 });
    assert.equal(trace.slots[0].status, 'unmapped');
    assert.equal(trace.slots[0].resolvedBy, 'selection_spec_invalid');
    assert.equal(trace.slots[0].keptExpectedPrimary, false);
  }
  // spec ดี + manifest ว่าง → missing ครบตามเดิม ไม่มี sentinel (สัญญา SRA-13 คงเดิม)
  const good = buildFinalAssignmentTrace({ selectionSpec: sraSpecForTrace(), plannedSlots: {}, manifestSlots: [] });
  assert.deepEqual(good.partition, { kept: 0, changed: 0, missingExpected: 3, unmapped: 0 });
  assert.ok(good.slots.every((s) => s.resolvedBy === 'selection_spec_missing_manifest'));
  // ไม่มี spec จริง (absent/null) → v1 เดิม total0 ไม่มี sentinel — byte-parity legacy คงอยู่
  for (const absent of [undefined, null]) {
    const t = buildFinalAssignmentTrace({ selectionSpec: absent, plannedSlots: {}, manifestSlots: [] });
    assert.equal(t.v, 1);
    assert.equal(t.total, 0);
    assert.ok(!t.slots.some((s) => 'resolvedBy' in s));
  }
});

test('SRA-24 (รอบ3 P1-3) diagnostics.missingRefId type: true=blocking · absent/false=ผ่าน · ครึ่งจริง=malformed', () => {
  const { spec, realized } = sraValidFixture();
  for (const half of ['true', 1, {}, null]) {
    const s = sraClone(spec);
    s.diagnostics.missingRefId = half;
    const r = validateStrictRenderActivation({ selectionSpec: s, realizedTemplate: realized });
    assert.equal(r.decision, 'reject_invalid', `missingRefId=${JSON.stringify(half)}`);
    assert.ok(r.reasons.includes('diagnostics_malformed:missingRefId'));
    assert.ok(!r.reasons.includes('diagnostics_blocking:missingRefId'), 'ครึ่งจริงต้องเป็น malformed ไม่ใช่ blocking');
  }
  const sTrue = sraClone(spec);
  sTrue.diagnostics.missingRefId = true;
  const rTrue = validateStrictRenderActivation({ selectionSpec: sTrue, realizedTemplate: realized });
  assert.ok(rTrue.reasons.includes('diagnostics_blocking:missingRefId'));
  assert.ok(!rTrue.reasons.includes('diagnostics_malformed:missingRefId'));
  const sFalse = sraClone(spec);
  sFalse.diagnostics.missingRefId = false;
  assert.equal(validateStrictRenderActivation({ selectionSpec: sFalse, realizedTemplate: realized }).decision, 'strict_ready', 'false ต้องผ่าน');
  assert.equal(validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: realized }).decision, 'strict_ready', 'absent (builder spec ดี) ต้องผ่าน');
});

test('SRA-16 legacy v1 (ไม่มี spec): ห้ามเติม missing rows — พฤติกรรม/ shape HEAD เดิม', () => {
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
    ],
  });
  assert.equal(trace.v, 1);
  assert.equal(trace.total, 2, 'v1 ห้ามเติม missing rows');
  assert.ok(!trace.slots.some((s) => 'resolvedBy' in s), 'v1 ไม่มี field resolvedBy');
});

console.log(`1..${passed}`);
