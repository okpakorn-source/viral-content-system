// ============================================================
// 🧪 AC-0084 strict quality-gate — PURE fixture test (LANE B)
// ------------------------------------------------------------
// Runs WITHOUT node_modules:  `node tests/ac0084-quality-gates.test.mjs`
// - no network / fs writes / random / Date / third-party imports
//   (only node:test + node:assert/strict + the canary's PURE exports).
// - imports the REAL gate + adapter functions from the live canary scaffold
//   (scripts/test-ac0084-strict-canary.mjs) — one source of truth, not a copy.
//   Importing the canary is INERT (direct-entry guard => no POST).
//
// ── GROUNDING (Lane-B re-audit fix) ─────────────────────────────────────────
// Fixtures mirror the ACTUAL producer, verified in-tree:
//   · REQUEST  (route.js + megaComposerService _strictPrepare + megaAdapters.js):
//     slotPlan rows carry url + (refSlotId for a PRIMARY | backupForRefSlotId for a
//     BACKUP) — NOT composerSlotId/candidateId (those are the SelectionSpec's);
//     selectionSpec uses `v` (=1), not `version`.
//   · TEMPLATE (refTemplate.js dnaToTemplateSpec): the realized template id is
//     'ref_dna' and slot ids are 'main' (hero rect), 'circle', and '{role}_{i}' for
//     other rects (e.g. 'reaction_2', 'context_3'). No hardcoded 'vt_ref_tri'.
//   · SelectionSpec v1 (refSlotContract.js buildSelectionSpec/validateStrict...):
//     v/mode/source/refId/strictReady + slots[{mappingMode,refSlotId,composerSlotId,
//     primary{candidateId,imageUrl},shape,backups}] + counts + diagnostics +
//     specHash/backupPoolHash/replayHash (fnv1a32 → 8 hex, REAL-COMPUTED here).
//   · RESPONSE (megaComposerService.js:1840-1934): manifest.slots[]={slot,imageUrl,
//     aHash,...} (NO shape); manifest.strictRender={verified,refId,specHash,
//     replayHash,slots[{composerSlotId,refSlotId,candidateId,imageUrl}]} (NO person),
//     emitted in AUTHORITY order — preserved RAW here (order/count/dups).
//
// Honesty properties proven here:
//   • No fabricated hash literal: specHash/replayHash are computed by the real
//     fnv1a32 algorithm from the fixture spec; the impossible 'r6l1a7c2' is used
//     ONLY as a negative (rejected as non-hex).
//   • No hardcoded 'vt_ref_tri': the template id is the producer-real 'ref_dna',
//     derived from REAL_PAYLOAD.realizedTemplate.id (the dnaToTemplateSpec output id).
//   • No inferred/invented person or shape field — the response has neither; person
//     lives ONLY in the operator golden's TYPED personAuthority.
//   • RAW ORDERED strict bindings preserved exactly (order, count, duplicates).
//   • Outer manifest.slots[].imageUrl preserved + cross-checked (outer_url_drift).
//   • FULL-state determinism (success + outer url + raw bindings), not lossy.
//   • Golden authority enforced on BOTH response A and B; a contradictory golden is
//     caught PRE-network; the live trigger cannot autorun from an env var.
//
// NOTE (single field I cannot verify in-tree): manifest.outputHash is sha1(jpeg),
// which needs the rendered buffer. OUTPUT_HASH below is a 40-hex value standing in
// for the operator-captured hash; the gate only enforces its 40-hex format + golden
// equality, never a specific literal.
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  fnv1a32,
  computeSelectionSpecHashes,
  adaptLiveResponse,
  evaluateStructuralGates,
  validateGolden,
  validateGoldenAgainstPayload,
  validateAgainstGolden,
  validatePersonAuthorityEntry,
  isPersonRequiredRole,
  assertStrictPayloadContract,
  validateSelectionSpecActivation,
  specHashIsValid,
  outputHashIsValid,
  roleOf,
  stableStringHash,
  canonicalStateOf,
  sameAuthoritativeState,
  shouldRunLive,
  HoldError,
  loadOperatorPayload,
  loadOperatorGolden,
  main,
} from '../scripts/test-ac0084-strict-canary.mjs';

// ------------------------------------------------------------
// Shared identity — one set of ids/urls used by the spec, the response, the golden
// and the payload so they are provably self-consistent.
// ------------------------------------------------------------
const REF_ID = 'AC-0084';
const OUTPUT_HASH = '9f3ab27c00e1d4a5b6c7d8e9f0a1b2c3d4e5f607'; // 40-hex; stands in for the captured sha1(jpeg)

const URLS = {
  hero: 'https://scontent.fbkk.fbcdn.net/ac0084/hero.jpg',
  circle: 'https://pbs.twimg.com/media/ac0084-circle.jpg',
  reaction: 'https://scontent.fbkk.fbcdn.net/ac0084/reaction.jpg',
  context: 'https://scontent.fbkk.fbcdn.net/ac0084/context.jpg',
};

// PRODUCER-REAL realized template — mirrors dnaToTemplateSpec output (refTemplate.js):
//   id 'ref_dna', canvas 1080×1350, hero rect id 'main', 'circle' (shape:'circle'),
//   other rects '{role}_{i}'. TEMPLATE_ID is DERIVED from this (no 'vt_ref_tri' literal).
const REALIZED_TEMPLATE = Object.freeze({
  id: 'ref_dna',
  storyFit: 'โครงตามปกเป้า: tri-collage',
  canvasW: 1080,
  canvasH: 1350,
  feather: 22,
  slots: [
    { id: 'main', x: 0, y: 0, w: 1080, h: 700 },
    { id: 'circle', x: 60, y: 720, w: 300, h: 300, shape: 'circle' },
    { id: 'reaction_2', x: 400, y: 720, w: 620, h: 300 },
    { id: 'context_3', x: 0, y: 1040, w: 1080, h: 310 },
  ],
});
const TEMPLATE_ID = REALIZED_TEMPLATE.id; // 'ref_dna' — producer-real, not hardcoded

// SelectionSpec v1 slots (real shape). composerSlotId (realized id) differs from
// refSlotId (the S6 ref-contract key) — e.g. hero: composerSlotId 'main' / refSlotId 'hero'.
const SPEC_SLOTS = [
  { mappingMode: 'ref_slot_exact', refSlotId: 'hero', composerSlotId: 'main', shape: 'rect', primary: { candidateId: 'cand-hero-001', imageUrl: URLS.hero }, backups: [] },
  { mappingMode: 'ref_slot_exact', refSlotId: 'circle', composerSlotId: 'circle', shape: 'circle', primary: { candidateId: 'cand-circle-002', imageUrl: URLS.circle }, backups: [] },
  { mappingMode: 'ref_slot_exact', refSlotId: 'reaction', composerSlotId: 'reaction_2', shape: 'rect', primary: { candidateId: 'cand-react-003', imageUrl: URLS.reaction }, backups: [] },
  { mappingMode: 'ref_slot_exact', refSlotId: 'context', composerSlotId: 'context_3', shape: 'rect', primary: { candidateId: 'cand-context-004', imageUrl: URLS.context }, backups: [] },
];
// REAL producer hashes, computed by the real fnv1a32 — never hand-typed.
const HASHES = computeSelectionSpecHashes(REF_ID, SPEC_SLOTS);

// TYPED operator personAuthority (P1-4). Every slot verified; approved ids match bindings.
const PERSON_AUTHORITY = Object.freeze({
  'main': { status: 'operator_verified', subjectKey: 'somchai', displayName: 'สมชาย', approvedCandidateId: 'cand-hero-001', approvedImageUrl: URLS.hero },
  'circle': { status: 'operator_verified', subjectKey: 'somying', displayName: 'สมหญิง', approvedCandidateId: 'cand-circle-002', approvedImageUrl: URLS.circle },
  'reaction_2': { status: 'operator_verified', subjectKey: 'somchai', displayName: 'สมชาย', approvedCandidateId: 'cand-react-003', approvedImageUrl: URLS.reaction },
  'context_3': { status: 'operator_verified', subjectKey: 'wichai', displayName: 'วิชัย', approvedCandidateId: 'cand-context-004', approvedImageUrl: URLS.context },
});

// ------------------------------------------------------------
// REALISTIC captured /api/mega/compose strict response (exact producer shape).
// ------------------------------------------------------------
const CAPTURED_RESPONSE = Object.freeze({
  success: true,
  base64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD',
  template: TEMPLATE_ID,
  refSimilarity: null,
  qcFlags: [],
  manifest: {
    composerVersion: 'mega-e-2026-07-10',
    stableOrder: true,
    models: { faceDetector: 'gpt-4o-mini (fallback: gemini-2.5-flash)', eye: 'gpt-4o' },
    slots: [
      { slot: 'main', imageUrl: URLS.hero, aHash: 'f0e1d2c3', faceCount: 1, faceBoxes: [], measured: null },
      { slot: 'circle', imageUrl: URLS.circle, aHash: '1122aabb', faceCount: 1, faceBoxes: [], measured: null },
      { slot: 'reaction_2', imageUrl: URLS.reaction, aHash: '33cc44dd', faceCount: 1, faceBoxes: [], measured: null },
      { slot: 'context_3', imageUrl: URLS.context, aHash: '55ee66ff', faceCount: 0, faceBoxes: [], measured: null },
    ],
    techRules: { mode: 'off', flags: [] },
    refImagePath: null,
    outputHash: OUTPUT_HASH,
    strictRender: {
      verified: true,
      refId: REF_ID,
      specHash: HASHES.specHash,
      replayHash: HASHES.replayHash,
      slots: [
        { composerSlotId: 'main', refSlotId: 'hero', candidateId: 'cand-hero-001', imageUrl: URLS.hero },
        { composerSlotId: 'circle', refSlotId: 'circle', candidateId: 'cand-circle-002', imageUrl: URLS.circle },
        { composerSlotId: 'reaction_2', refSlotId: 'reaction', candidateId: 'cand-react-003', imageUrl: URLS.reaction },
        { composerSlotId: 'context_3', refSlotId: 'context', candidateId: 'cand-context-004', imageUrl: URLS.context },
      ],
    },
  },
});

// Operator CURATED golden matching the captured response exactly (ordered) + the
// TYPED operator-verified personAuthority (the response emits no person).
const CURATED_GOLDEN = Object.freeze({
  templateId: TEMPLATE_ID,
  specHash: HASHES.specHash,
  refId: REF_ID,
  replayHash: HASHES.replayHash,
  outputHash: OUTPUT_HASH,
  strictRender: { verified: true },
  personAuthority: PERSON_AUTHORITY,
  bindings: [
    { composerSlotId: 'main', refSlotId: 'hero', candidateId: 'cand-hero-001', imageUrl: URLS.hero },
    { composerSlotId: 'circle', refSlotId: 'circle', candidateId: 'cand-circle-002', imageUrl: URLS.circle },
    { composerSlotId: 'reaction_2', refSlotId: 'reaction', candidateId: 'cand-react-003', imageUrl: URLS.reaction },
    { composerSlotId: 'context_3', refSlotId: 'context', candidateId: 'cand-context-004', imageUrl: URLS.context },
  ],
});

// ------------------------------------------------------------
// REAL captured wire payload — the old `version`/example.invalid stub must FAIL.
// realizedTemplate is the producer-real REALIZED_TEMPLATE; slotPlan rows carry
// url + refSlotId (primary) ONLY.
// ------------------------------------------------------------
const REAL_PAYLOAD = Object.freeze({
  newsTitle: 'AC-0084 เนื้อข่าวเต็มจริงของเคส — แม่ตามหาลูกชายที่หายตัวไปหลายวัน ญาติเปิดใจ …',
  slotPlan: [
    { url: URLS.hero, refSlotId: 'hero', isHero: true, faces: 1, clean: true },
    { url: URLS.circle, refSlotId: 'circle', isHero: false, faces: 1, clean: true },
    { url: URLS.reaction, refSlotId: 'reaction', isHero: false, faces: 1, clean: true },
    { url: URLS.context, refSlotId: 'context', isHero: false, faces: 0, clean: true },
  ],
  selectionSpec: {
    v: 1,
    mode: 'ref_slot_exact',
    source: 'template.slots',
    refId: REF_ID,
    strictReady: true,
    specHash: HASHES.specHash,
    backupPoolHash: HASHES.backupPoolHash,
    replayHash: HASHES.replayHash,
    counts: { total: 4, mapped: 4, unmapped: 0, missingPrimary: 0, duplicatePrimary: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 },
    diagnostics: { extraPlannedKeys: [], invalidPrimary: [], aliasPrimaryUrls: [], duplicateBackupsDropped: [] },
    slots: SPEC_SLOTS,
  },
  realizedTemplate: REALIZED_TEMPLATE,
});

// The OLD stub the audit flagged — `version` (wrong field), {id}-only template,
// example.invalid urls, slotPlan rows carrying composerSlotId/candidateId but neither
// refSlotId nor backupForRefSlotId (role unresolvable).
const STUB_PAYLOAD = Object.freeze({
  newsTitle: 'AC-0084 strict canary — เนื้อข่าวเต็ม (แทนที่ด้วยเคสจริงก่อนยิง)',
  slotPlan: [
    { url: 'https://example.invalid/ac0084/hero.jpg', isHero: true, faces: 1, clean: true, composerSlotId: 'main', candidateId: 'cand-hero' },
    { url: 'https://example.invalid/ac0084/circle.jpg', isHero: false, faces: 1, clean: true, composerSlotId: 'circle', candidateId: 'cand-circle' },
  ],
  selectionSpec: { refId: REF_ID, version: 1 }, // ← `version` not `v`, and nothing else
  realizedTemplate: { id: TEMPLATE_ID },         // ← no canvas, no slots
});

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const capture = () => clone(CAPTURED_RESPONSE);
const golden = () => clone(CURATED_GOLDEN);

// ============================================================
// hash format helpers (fnv1a32 = 8 hex; sha1 outputHash = 40 hex)
// ============================================================
test('specHashIsValid / outputHashIsValid: format only; reject the fabricated r6l1a7c2', () => {
  assert.equal(specHashIsValid(HASHES.specHash), true);
  assert.equal(specHashIsValid(HASHES.replayHash), true);
  assert.equal(specHashIsValid('r6l1a7c2'), false); // 'r'/'l' not hex — the impossible fabricated golden
  assert.equal(specHashIsValid('A1B2C3D4'), false); // uppercase not allowed
  assert.equal(specHashIsValid('a1b2c3'), false);   // too short
  assert.equal(specHashIsValid('a1b2c3d4e'), false);// too long
  assert.equal(specHashIsValid(''), false);
  assert.equal(specHashIsValid(null), false);
  assert.equal(outputHashIsValid(OUTPUT_HASH), true);
  assert.equal(outputHashIsValid(HASHES.specHash), false); // 8 hex is not a 40-hex sha1
  assert.equal(outputHashIsValid('z'.repeat(40)), false);
});

test('fnv1a32 + computeSelectionSpecHashes: deterministic, 8-hex, matches the real algorithm', () => {
  assert.equal(fnv1a32('abc'), fnv1a32('abc'));
  assert.match(fnv1a32('anything'), /^[0-9a-f]{8}$/);
  const again = computeSelectionSpecHashes(REF_ID, SPEC_SLOTS);
  assert.deepEqual(again, HASHES);
  assert.match(HASHES.specHash, /^[0-9a-f]{8}$/);
  assert.match(HASHES.replayHash, /^[0-9a-f]{8}$/);
  // specHash is identity-only; changing a primary URL moves replayHash but NOT specHash.
  const urlTwisted = clone(SPEC_SLOTS);
  urlTwisted[0].primary.imageUrl = URLS.hero + '?v=2';
  const h2 = computeSelectionSpecHashes(REF_ID, urlTwisted);
  assert.equal(h2.specHash, HASHES.specHash, 'specHash is identity-only (URL not bound)');
  assert.notEqual(h2.replayHash, HASHES.replayHash, 'replayHash binds the URL');
});

// ============================================================
// adaptLiveResponse — maps real shape; RAW ordered strict bindings + outer url
// ============================================================
test('adaptLiveResponse preserves the RAW ordered strict bindings + outer url (no person/shape)', () => {
  const a = adaptLiveResponse(capture());
  assert.equal(a.success, true);
  assert.equal(a.template, TEMPLATE_ID);
  assert.equal(a.manifest.templateId, TEMPLATE_ID);
  assert.equal(a.manifest.verified, true);
  assert.equal(a.manifest.specHash, HASHES.specHash);
  assert.equal(a.manifest.refId, REF_ID);
  assert.equal(a.manifest.replayHash, HASHES.replayHash);
  assert.equal(a.manifest.outputHash, OUTPUT_HASH);
  // outer per-slot list carries slot id + imageHash(aHash) + imageUrl (P1-3)
  assert.equal(a.manifest.slots.length, 4);
  assert.deepEqual(a.manifest.slots[0], { slot: 'main', imageHash: 'f0e1d2c3', imageUrl: URLS.hero });
  // RAW ordered strict bindings preserved EXACTLY (order + count + fields), NO Map collapse
  assert.equal(a.manifest.strictSlots.length, 4);
  assert.deepEqual(a.manifest.strictSlots, [
    { composerSlotId: 'main', refSlotId: 'hero', candidateId: 'cand-hero-001', imageUrl: URLS.hero },
    { composerSlotId: 'circle', refSlotId: 'circle', candidateId: 'cand-circle-002', imageUrl: URLS.circle },
    { composerSlotId: 'reaction_2', refSlotId: 'reaction', candidateId: 'cand-react-003', imageUrl: URLS.reaction },
    { composerSlotId: 'context_3', refSlotId: 'context', candidateId: 'cand-context-004', imageUrl: URLS.context },
  ]);
  // no person/shape leaked anywhere
  for (const s of a.manifest.slots) assert.equal(Object.prototype.hasOwnProperty.call(s, 'shape'), false);
  for (const b of a.manifest.strictSlots) {
    assert.equal(Object.prototype.hasOwnProperty.call(b, 'person'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(b, 'shape'), false);
  }
});

test('adaptLiveResponse on a legacy (non-strict) manifest fails closed (empty strictSlots, unverified)', () => {
  const legacy = { success: true, template: TEMPLATE_ID, manifest: { outputHash: OUTPUT_HASH, slots: [{ slot: 'main', imageUrl: URLS.hero, aHash: 'aa' }] } };
  const a = adaptLiveResponse(legacy);
  assert.equal(a.manifest.verified, false);
  assert.equal(a.manifest.specHash, '');
  assert.equal(a.manifest.strictSlots.length, 0);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('strict_not_verified'), res.reasons.join(','));
});

// ============================================================
// POSITIVE — captured response + matching golden passes every gate
// ============================================================
test('POSITIVE captured response passes structural + golden authority gates', () => {
  const a = adaptLiveResponse(capture());
  const structural = evaluateStructuralGates(a);
  assert.equal(structural.pass, true, `structural: ${structural.reasons.join(',')}`);
  assert.equal(validateGolden(CURATED_GOLDEN).ok, true, `golden: ${validateGolden(CURATED_GOLDEN).reasons.join(',')}`);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, true, `authority: ${res.reasons.join(',')}`);
  assert.deepEqual(res.reasons, []);
});

// ============================================================
// P2 — PURE pre-network golden↔payload consistency
// ============================================================
test('validateGoldenAgainstPayload accepts a golden consistent with the payload (offline)', () => {
  const res = validateGoldenAgainstPayload(CURATED_GOLDEN, REAL_PAYLOAD);
  assert.equal(res.ok, true, res.reasons.join(','));
  assert.deepEqual(res.reasons, []);
});

test('REQUIRED: contradictory golden caught PRE-network (validateGoldenAgainstPayload)', () => {
  // specHash contradicts the payload authority (valid 8-hex format, but not the real value).
  const g = golden();
  g.specHash = 'deadbeef';
  const res = validateGoldenAgainstPayload(g, REAL_PAYLOAD);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('payload_spec_hash_mismatch'), res.reasons.join(','));
  // a binding that contradicts the spec primary is also caught offline.
  const g2 = golden();
  g2.bindings[2].candidateId = 'cand-not-in-spec';
  const res2 = validateGoldenAgainstPayload(g2, REAL_PAYLOAD);
  assert.equal(res2.ok, false);
  assert.ok(res2.reasons.includes('payload_binding_candidate_mismatch:reaction_2'), res2.reasons.join(','));
});

// ============================================================
// NEGATIVES against the golden — each must HOLD (pass:false) with the right reason
// ============================================================
test('NEG missing/false strictRender.verified HOLDs strict_not_verified', () => {
  const cap = capture();
  cap.manifest.strictRender.verified = false;
  const a = adaptLiveResponse(cap);
  assert.equal(a.manifest.verified, false);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('strict_not_verified'), res.reasons.join(','));
  assert.equal(evaluateStructuralGates(a).pass, false); // structural also rejects it
});

test('NEG missing strict binding (drop reaction_2) HOLDs binding_count_mismatch', () => {
  const cap = capture();
  cap.manifest.strictRender.slots = cap.manifest.strictRender.slots.filter((s) => s.composerSlotId !== 'reaction_2');
  const a = adaptLiveResponse(cap);
  assert.equal(a.manifest.strictSlots.length, 3);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('binding_count_mismatch'), res.reasons.join(','));
  assert.ok(res.reasons.some((r) => r.startsWith('binding_slot_mismatch')), res.reasons.join(','));
});

test('NEG wrong candidateId on a slot HOLDs binding_candidate_mismatch', () => {
  const cap = capture();
  cap.manifest.strictRender.slots[1].candidateId = 'cand-someone-else';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('binding_candidate_mismatch:circle'), res.reasons.join(','));
});

test('NEG wrong imageUrl on a slot HOLDs binding_image_mismatch (wrong photo of same candidate)', () => {
  const cap = capture();
  cap.manifest.strictRender.slots[0].imageUrl = 'https://scontent.fbkk.fbcdn.net/ac0084/hero-DIFFERENT.jpg';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('binding_image_mismatch:main'), res.reasons.join(','));
});

test('NEG reused candidate across slots HOLDs candidate_reused (distinctness)', () => {
  const cap = capture();
  cap.manifest.strictRender.slots[2].candidateId = 'cand-hero-001'; // reaction_2 reuses hero candidate
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('candidate_reused:reaction_2'), res.reasons.join(','));
});

test('NEG reused imageUrl across slots HOLDs image_reused (same photo twice)', () => {
  const cap = capture();
  cap.manifest.strictRender.slots[2].imageUrl = URLS.hero; // reaction_2 reuses hero photo
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('image_reused:reaction_2') || res.reasons.includes('binding_image_mismatch:reaction_2'), res.reasons.join(','));
});

test('NEG non-hex specHash (r6l1a7c2) HOLDs spec_hash_invalid (short-circuits equality)', () => {
  const cap = capture();
  cap.manifest.strictRender.specHash = 'r6l1a7c2';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('spec_hash_invalid'), res.reasons.join(','));
  assert.ok(!res.reasons.includes('spec_hash_mismatch'), 'invalid short-circuits the equality check');
});

test('NEG valid-but-wrong specHash HOLDs spec_hash_mismatch', () => {
  const cap = capture();
  cap.manifest.strictRender.specHash = 'deadbeef';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('spec_hash_mismatch'), res.reasons.join(','));
});

test('NEG tampered outputHash HOLDs output_hash_mismatch', () => {
  const cap = capture();
  cap.manifest.outputHash = '0000000000000000000000000000000000000000';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('output_hash_mismatch'), res.reasons.join(','));
});

test('NEG tampered replayHash HOLDs replay_hash_mismatch', () => {
  const cap = capture();
  cap.manifest.strictRender.replayHash = 'ffffffff';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('replay_hash_mismatch'), res.reasons.join(','));
});

test('NEG tampered refId HOLDs ref_id_mismatch', () => {
  const cap = capture();
  cap.manifest.strictRender.refId = 'AC-9999';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('ref_id_mismatch'), res.reasons.join(','));
});

test('NEG template mismatch HOLDs template_mismatch', () => {
  const cap = capture();
  cap.template = 'ref_dna_other';
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('template_mismatch'), res.reasons.join(','));
});

test('REQUIRED: reversed RAW strict array HOLDs binding_slot_mismatch (order enforced)', () => {
  const cap = capture();
  cap.manifest.strictRender.slots.reverse(); // reverse the RAW authoritative order
  const a = adaptLiveResponse(cap);
  // the adapter preserved the reversed RAW order exactly
  assert.deepEqual(a.manifest.strictSlots.map((b) => b.composerSlotId), ['context_3', 'reaction_2', 'circle', 'main']);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.some((r) => r.startsWith('binding_slot_mismatch')), res.reasons.join(','));
});

test('REQUIRED: appended duplicate binding HOLDs live_duplicate_slot + binding_count_mismatch', () => {
  const cap = capture();
  cap.manifest.strictRender.slots.push(clone(cap.manifest.strictRender.slots[0])); // exact dup of main
  const a = adaptLiveResponse(cap);
  assert.equal(a.manifest.strictSlots.length, 5); // duplicate preserved (not collapsed)
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('live_duplicate_slot:main'), res.reasons.join(','));
  assert.ok(res.reasons.includes('binding_count_mismatch'), res.reasons.join(','));
});

test('NEG extra outer slot HOLDs outer_slot_count_mismatch / outer_slot_unexpected', () => {
  const cap = capture();
  cap.manifest.slots.push({ slot: 'extra_9', imageUrl: 'https://scontent.fbkk.fbcdn.net/ac0084/extra.jpg', aHash: 'ab12', faceCount: 0, faceBoxes: [], measured: null });
  const a = adaptLiveResponse(cap);
  const res = validateAgainstGolden(a, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('outer_slot_count_mismatch'), res.reasons.join(','));
  assert.ok(res.reasons.includes('outer_slot_unexpected:extra_9'), res.reasons.join(','));
});

// ============================================================
// GOLDEN integrity — the golden itself must be complete + authoritative
// ============================================================
test('validateGolden accepts the curated golden', () => {
  const res = validateGolden(CURATED_GOLDEN);
  assert.equal(res.ok, true, res.reasons.join(','));
  assert.deepEqual(res.reasons, []);
});

test('validateGolden HOLDs on missing refId / replayHash / outputHash', () => {
  for (const [field, reason] of [['refId', 'golden_ref_id_missing'], ['replayHash', 'golden_replay_hash_invalid'], ['outputHash', 'golden_output_hash_invalid']]) {
    const g = golden();
    delete g[field];
    const res = validateGolden(g);
    assert.equal(res.ok, false, `${field} should HOLD`);
    assert.ok(res.reasons.includes(reason), `${field}: ${res.reasons.join(',')}`);
  }
});

test('validateGolden HOLDs when strictRender.verified is not true', () => {
  const g = golden();
  g.strictRender = { verified: false };
  const res = validateGolden(g);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('golden_verified_not_true'), res.reasons.join(','));
});

test('validateGolden HOLDs on duplicate binding / duplicate candidate', () => {
  const g = golden();
  g.bindings[2] = clone(g.bindings[0]); // exact duplicate of hero at index 2
  const res = validateGolden(g);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.some((r) => r.startsWith('golden_duplicate_binding') || r.startsWith('golden_duplicate_candidate')), res.reasons.join(','));
});

// ============================================================
// P1-4 — TYPED personAuthority
// ============================================================
test('validatePersonAuthorityEntry: typed ok; null ok on support; null rejected on hero; string rejected', () => {
  const heroBinding = { composerSlotId: 'main', refSlotId: 'hero', candidateId: 'cand-hero-001', imageUrl: URLS.hero };
  const supportBinding = { composerSlotId: 'context_3', refSlotId: 'context', candidateId: 'cand-context-004', imageUrl: URLS.context };
  assert.equal(isPersonRequiredRole(roleOf({ slot: 'main' })), true);
  assert.equal(isPersonRequiredRole(roleOf({ slot: 'context_3' })), false);
  // typed + matching → OK
  assert.deepEqual(validatePersonAuthorityEntry(PERSON_AUTHORITY['main'], heroBinding, 'main'), []);
  // explicit null on a non-person slot → OK
  assert.deepEqual(validatePersonAuthorityEntry(null, supportBinding, 'context_3'), []);
  // explicit null on a person-required slot → reject
  assert.ok(validatePersonAuthorityEntry(null, heroBinding, 'main').includes('person_authority_required:main'));
  // plain string → reject (old untyped style)
  assert.ok(validatePersonAuthorityEntry('สมชาย', heroBinding, 'main').includes('person_authority_not_typed:main'));
  // typed but approvedCandidate/image not matching the binding → reject
  const wrong = { status: 'operator_verified', subjectKey: 'x', displayName: 'x', approvedCandidateId: 'cand-WRONG', approvedImageUrl: URLS.hero };
  assert.ok(validatePersonAuthorityEntry(wrong, heroBinding, 'main').includes('person_authority_candidate_mismatch:main'));
});

test('REQUIRED: plain-string personAuthority is rejected by validateGolden (typed contract)', () => {
  const g = golden();
  g.personAuthority = clone(PERSON_AUTHORITY);
  g.personAuthority['main'] = 'สมชาย'; // old untyped string
  const res = validateGolden(g);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('person_authority_not_typed:main'), res.reasons.join(','));
});

test('REQUIRED: explicit null authority on a non-person slot is accepted', () => {
  const g = golden();
  g.personAuthority = clone(PERSON_AUTHORITY);
  g.personAuthority['context_3'] = null; // context is not a person-required slot
  assert.equal(validateGolden(g).ok, true, validateGolden(g).reasons.join(','));
  const a = adaptLiveResponse(capture());
  const res = validateAgainstGolden(a, g);
  assert.equal(res.pass, true, res.reasons.join(','));
});

test('NEG explicit null authority on a person-required slot (circle) HOLDs person_authority_required', () => {
  const g = golden();
  g.personAuthority = clone(PERSON_AUTHORITY);
  g.personAuthority['circle'] = null; // circle IS person-required
  const res = validateGolden(g);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('person_authority_required:circle'), res.reasons.join(','));
});

test('NEG personAuthority omits a slot HOLDs person_authority_uncovered', () => {
  const g = golden();
  g.personAuthority = clone(PERSON_AUTHORITY);
  delete g.personAuthority['context_3'];
  const res = validateGolden(g);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('person_authority_uncovered:context_3'), res.reasons.join(','));
  const a = adaptLiveResponse(capture());
  assert.equal(validateAgainstGolden(a, g).pass, false);
});

test('NEG personAuthority extra slot (drifted from render) HOLDs person_authority_extra', () => {
  const g = golden();
  g.personAuthority = clone(PERSON_AUTHORITY);
  g.personAuthority['ghost-slot'] = { status: 'operator_verified', subjectKey: 'ghost', displayName: 'ผี', approvedCandidateId: 'cand-x', approvedImageUrl: 'https://x/y.jpg' };
  const res = validateGolden(g);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('person_authority_extra:ghost-slot'), res.reasons.join(','));
});

test('NEG personAuthority entirely missing HOLDs person_authority_missing', () => {
  const g = golden();
  delete g.personAuthority;
  const res = validateGolden(g);
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('person_authority_missing'), res.reasons.join(','));
});

// ============================================================
// MISSING GOLDEN / CURATION => HOLD (never a determinism-only pass)
// ============================================================
test('MISSING curation => HOLD (empty or absent bindings)', () => {
  const a = adaptLiveResponse(capture());
  assert.equal(validateAgainstGolden(a, { templateId: TEMPLATE_ID, specHash: HASHES.specHash, bindings: [] }).pass, false);
  const res = validateAgainstGolden(a, {});
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('golden_bindings_missing'), res.reasons.join(','));
});

test('loadOperatorPayload / loadOperatorGolden HOLD when no operator input is provided', () => {
  const saved = {
    pf: process.env.AC0084_PAYLOAD_FILE, pj: process.env.AC0084_PAYLOAD_JSON,
    gf: process.env.AC0084_GOLDEN_FILE, gj: process.env.AC0084_GOLDEN_JSON,
  };
  delete process.env.AC0084_PAYLOAD_FILE; delete process.env.AC0084_PAYLOAD_JSON;
  delete process.env.AC0084_GOLDEN_FILE; delete process.env.AC0084_GOLDEN_JSON;
  try {
    assert.throws(() => loadOperatorPayload(), (e) => e instanceof HoldError && /no operator-captured payload/.test(e.message));
    assert.throws(() => loadOperatorGolden(), (e) => e instanceof HoldError && /no operator golden/.test(e.message));
  } finally {
    for (const [k, v] of [['AC0084_PAYLOAD_FILE', saved.pf], ['AC0084_PAYLOAD_JSON', saved.pj], ['AC0084_GOLDEN_FILE', saved.gf], ['AC0084_GOLDEN_JSON', saved.gj]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

// ============================================================
// FULL-STATE determinism (audit point 4 — NOT a lossy fingerprint) + A/B on both
// ============================================================
test('sameAuthoritativeState: identical equal; sensitive to image, candidate, strict-url AND outer-url drift', () => {
  const a = adaptLiveResponse(capture());
  const b = adaptLiveResponse(capture());
  assert.equal(sameAuthoritativeState(a, b), true);
  // outer image (aHash) drift => not equal
  const imgTamper = capture(); imgTamper.manifest.slots[2].aHash = 'deadbeef';
  assert.equal(sameAuthoritativeState(a, adaptLiveResponse(imgTamper)), false);
  // candidateId drift (raw strict) => not equal (proves the comparison is NOT lossy on bindings)
  const candTamper = capture(); candTamper.manifest.strictRender.slots[1].candidateId = 'cand-x';
  assert.equal(sameAuthoritativeState(a, adaptLiveResponse(candTamper)), false);
  // strict imageUrl drift => not equal
  const urlTamper = capture(); urlTamper.manifest.strictRender.slots[1].imageUrl = URLS.circle + '?x=1';
  assert.equal(sameAuthoritativeState(a, adaptLiveResponse(urlTamper)), false);
  // outer per-slot imageUrl drift => not equal (P1-3 outer url is in the canonical state)
  const outerTamper = capture(); outerTamper.manifest.slots[2].imageUrl = URLS.reaction + '?o=1';
  assert.equal(sameAuthoritativeState(a, adaptLiveResponse(outerTamper)), false);
});

test('canonicalStateOf carries success + outer url + RAW strict candidateId/imageUrl (full, not lossy)', () => {
  const st = canonicalStateOf(adaptLiveResponse(capture()));
  assert.equal(st.success, true);
  assert.equal(st.slots.length, 4);
  assert.equal(st.slots[0].imageUrl, URLS.hero);   // outer url present
  assert.equal(st.strictSlots.length, 4);
  assert.equal(st.strictSlots[0].candidateId, 'cand-hero-001');
  assert.equal(st.strictSlots[0].imageUrl, URLS.hero);
  assert.equal(st.strictSlots[0].refSlotId, 'hero');
  assert.equal(st.specHash, HASHES.specHash);
  assert.equal(stableStringHash('abc'), stableStringHash('abc'));
  assert.match(stableStringHash('abc'), /^[0-9a-f]{8}$/);
});

test('REQUIRED: response B with success:false HOLDs (structural gate on B)', () => {
  const a = adaptLiveResponse(capture());
  const capB = capture(); capB.success = false;
  const b = adaptLiveResponse(capB);
  // A is fine, but the run must validate B too — and B fails.
  assert.equal(evaluateStructuralGates(a).pass, true);
  const sb = evaluateStructuralGates(b);
  assert.equal(sb.pass, false);
  assert.ok(sb.reasons.includes('not_success'), sb.reasons.join(','));
  assert.equal(validateAgainstGolden(b, CURATED_GOLDEN).pass, false);
});

test('REQUIRED: response B with outer-URL drift vs A HOLDs (golden on B + determinism)', () => {
  const a = adaptLiveResponse(capture());
  const capB = capture();
  capB.manifest.slots[2].imageUrl = 'https://scontent.fbkk.fbcdn.net/ac0084/reaction-DRIFTED.jpg'; // outer only
  const b = adaptLiveResponse(capB);
  // golden authority on B catches the outer-url drift (binding url unchanged, outer drifted)
  const res = validateAgainstGolden(b, CURATED_GOLDEN);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('outer_url_drift:reaction_2'), res.reasons.join(','));
  // and the A/B determinism cross-check also fails (outer url is in the full state)
  assert.equal(sameAuthoritativeState(a, b), false);
});

// ============================================================
// STRUCTURAL gates (roles/counts)
// ============================================================
test('structural: missing hero HOLDs hero_missing', () => {
  const cap = capture();
  cap.manifest.slots = cap.manifest.slots.filter((s) => s.slot !== 'main');
  const res = evaluateStructuralGates(adaptLiveResponse(cap));
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('hero_missing'));
});

test('structural: duplicate hero HOLDs hero_duplicate', () => {
  const cap = capture();
  cap.manifest.slots.push({ slot: 'hero-2', imageUrl: URLS.context, aHash: 'bc12', faceCount: 1, faceBoxes: [], measured: null });
  const res = evaluateStructuralGates(adaptLiveResponse(cap));
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('hero_duplicate'));
});

test('structural: missing circle HOLDs circle_missing', () => {
  const cap = capture();
  cap.manifest.slots = cap.manifest.slots.filter((s) => s.slot !== 'circle');
  const res = evaluateStructuralGates(adaptLiveResponse(cap));
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('circle_missing'));
});

test('structural: success:false HOLDs not_success', () => {
  const cap = capture();
  cap.success = false;
  const res = evaluateStructuralGates(adaptLiveResponse(cap));
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('not_success'));
});

test('roleOf classifies hero / circle / support from the emitted slot id (no shape needed)', () => {
  assert.equal(roleOf({ slot: 'main' }), 'hero');
  assert.equal(roleOf({ slot: 'circle' }), 'circle');
  assert.equal(roleOf({ slot: 'circle-2' }), 'circle');
  assert.equal(roleOf({ slot: 'reaction_2' }), 'support');
  assert.equal(roleOf({ slot: 'context_3' }), 'support');
});

// ============================================================
// PREFLIGHT — real wire; the old `version`/example.invalid stub must FAIL
// ============================================================
test('preflight ACCEPTS a real captured strict-armed payload (slotPlan carries url+refSlotId ONLY)', () => {
  const res = assertStrictPayloadContract(REAL_PAYLOAD, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, true, res.reasons.join(','));
  assert.deepEqual(res.reasons, []);
  // prove the accepted plan rows do NOT carry composerSlotId/candidateId — those are the spec's.
  for (const row of REAL_PAYLOAD.slotPlan) {
    assert.equal('composerSlotId' in row, false);
    assert.equal('candidateId' in row, false);
  }
});

test('REQUIRED: preflight ACCEPTS a legitimate BACKUP row (backupForRefSlotId, no refSlotId)', () => {
  const p = clone(REAL_PAYLOAD);
  // a production backup row for the hero ref slot — valid WITHOUT being a primary.
  p.slotPlan.push({ url: 'https://scontent.fbkk.fbcdn.net/ac0084/hero-backup.jpg', backupForRefSlotId: 'hero', isHero: false, faces: 1, clean: true });
  const res = assertStrictPayloadContract(p, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, true, res.reasons.join(','));
  assert.deepEqual(res.reasons, []);
  // the backup row must NOT be false-HELD for lacking refSlotId
  assert.ok(!res.reasons.some((r) => r.startsWith('slotPlan[4]')), res.reasons.join(','));
});

test('preflight REJECTS the old stub (version-not-v spec, example.invalid, {id}-only template, unresolved role)', () => {
  const res = assertStrictPayloadContract(STUB_PAYLOAD, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('slotPlan[0].url_placeholder'), res.reasons.join(','));
  assert.ok(res.reasons.includes('slotPlan[1].url_placeholder'), res.reasons.join(','));
  // neither refSlotId nor backupForRefSlotId => role_unresolved (composerSlotId/candidateId are NOT plan fields)
  assert.ok(res.reasons.includes('slotPlan[0].role_unresolved'), res.reasons.join(','));
  assert.ok(res.reasons.includes('selectionSpec_not_strict_ready'), res.reasons.join(','));
  assert.ok(res.reasons.includes('spec:bad_version'), res.reasons.join(',')); // `v !== 1`
  assert.ok(res.reasons.includes('realizedTemplate.canvas_invalid'), res.reasons.join(','));
  assert.ok(res.reasons.includes('realizedTemplate.slots_empty'), res.reasons.join(','));
});

test('preflight HOLDs when selectionSpec uses `version` instead of `v` (the exact re-audit finding)', () => {
  const p = clone(REAL_PAYLOAD);
  p.selectionSpec.version = p.selectionSpec.v; // rename v -> version
  delete p.selectionSpec.v;
  const res = assertStrictPayloadContract(p, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('spec:bad_version'), res.reasons.join(','));
});

test('preflight HOLDs when a PRIMARY slotPlan row drops refSlotId (role_unresolved + primary binding)', () => {
  const p = clone(REAL_PAYLOAD);
  delete p.slotPlan[1].refSlotId; // circle row is a primary but declares no role now
  const res = assertStrictPayloadContract(p, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('slotPlan[1].role_unresolved'), res.reasons.join(','));
  assert.ok(res.reasons.some((r) => r.startsWith('primary_ref_mismatch')), res.reasons.join(','));
});

test('preflight HOLDs when the primary url is not present in slotPlan (STRICT_PRIMARY_UNAVAILABLE)', () => {
  const p = clone(REAL_PAYLOAD);
  p.slotPlan[2].url = 'https://scontent.fbkk.fbcdn.net/ac0084/NOT-THE-PRIMARY.jpg';
  const res = assertStrictPayloadContract(p, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('primary_missing:reaction_2'), res.reasons.join(','));
});

test('preflight HOLDs on a tampered selectionSpec hash (recomputed, not trusted)', () => {
  const p = clone(REAL_PAYLOAD);
  p.selectionSpec.specHash = 'deadbeef';
  const res = assertStrictPayloadContract(p, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('spec:spec_hash_mismatch'), res.reasons.join(','));
});

test('preflight HOLDs on realizedTemplate geometry outside the fixed 1080×1350 canvas', () => {
  const p = clone(REAL_PAYLOAD);
  p.realizedTemplate.slots[0].w = 2000; // x+w > 1080
  const res = assertStrictPayloadContract(p, { MEGA_STRICT_RENDER: '1' });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.some((r) => r.startsWith('realizedTemplate.slot_out_of_canvas')), res.reasons.join(','));
});

test('preflight HOLDs when strict pipeline is not armed (MEGA_STRICT_RENDER unset)', () => {
  const res = assertStrictPayloadContract(REAL_PAYLOAD, { /* unset */ });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('MEGA_STRICT_RENDER_not_armed'), res.reasons.join(','));
});

test('validateSelectionSpecActivation returns strict_ready with a normalized authority for the real spec', () => {
  const act = validateSelectionSpecActivation({ selectionSpec: REAL_PAYLOAD.selectionSpec, realizedTemplate: REAL_PAYLOAD.realizedTemplate });
  assert.equal(act.decision, 'strict_ready', act.reasons.join(','));
  assert.equal(act.authority.refId, REF_ID);
  assert.equal(act.authority.slots.length, 4);
  assert.equal(act.authority.slots[0].composerSlotId, 'main');
  assert.equal(act.authority.slots[0].primary.imageUrl, URLS.hero);
});

// ============================================================
// TRIGGER — live fires ONLY on `run` argv + direct entry; env var alone cannot
// ============================================================
test('shouldRunLive: fires only on `run` argv AND direct entry', () => {
  const scriptPath = 'scripts/test-ac0084-strict-canary.mjs';
  const otherPath = 'tests/ac0084-quality-gates.test.mjs';
  const url = pathToFileURL(scriptPath).href;
  assert.equal(shouldRunLive(['node', scriptPath, 'run'], url), true);
  assert.equal(shouldRunLive(['node', scriptPath], url), false);        // no `run` (also the "env var alone" case)
  assert.equal(shouldRunLive(['node', otherPath, 'run'], url), false);  // imported, not direct entry
  assert.equal(shouldRunLive(['node', scriptPath, 'go'], url), false);  // wrong subcommand
  assert.equal(shouldRunLive(null, url), false);
});

// ============================================================
// P1 re-audit (Codex HOLD) — the OUTER manifest.slots[] must be 1:1 with the curated
// bindings. A duplicated outer slot + a missing one AT THE SAME LENGTH used to
// false-PASS because validateAgainstGolden Map-collapsed the outer slots by id
// (a repeated id silently overwrote its twin; a missing id went undetected).
// ============================================================

// A self-consistent 3-slot fixture ([main, circle, support_2]) built from the REAL
// producer shapes + REAL fnv1a32 hashes (no hand-typed hash, no invented field).
const SPEC_SLOTS_3 = [
  { mappingMode: 'ref_slot_exact', refSlotId: 'hero', composerSlotId: 'main', shape: 'rect', primary: { candidateId: 'cand-hero-001', imageUrl: URLS.hero }, backups: [] },
  { mappingMode: 'ref_slot_exact', refSlotId: 'circle', composerSlotId: 'circle', shape: 'circle', primary: { candidateId: 'cand-circle-002', imageUrl: URLS.circle }, backups: [] },
  { mappingMode: 'ref_slot_exact', refSlotId: 'support', composerSlotId: 'support_2', shape: 'rect', primary: { candidateId: 'cand-support-003', imageUrl: URLS.reaction }, backups: [] },
];
const HASHES_3 = computeSelectionSpecHashes(REF_ID, SPEC_SLOTS_3);

const GOLDEN_3 = Object.freeze({
  templateId: TEMPLATE_ID,
  specHash: HASHES_3.specHash,
  refId: REF_ID,
  replayHash: HASHES_3.replayHash,
  outputHash: OUTPUT_HASH,
  strictRender: { verified: true },
  personAuthority: {
    'main': { status: 'operator_verified', subjectKey: 'somchai', displayName: 'สมชาย', approvedCandidateId: 'cand-hero-001', approvedImageUrl: URLS.hero },
    'circle': { status: 'operator_verified', subjectKey: 'somying', displayName: 'สมหญิง', approvedCandidateId: 'cand-circle-002', approvedImageUrl: URLS.circle },
    'support_2': null, // support is not a person-required slot → explicit null OK
  },
  bindings: [
    { composerSlotId: 'main', refSlotId: 'hero', candidateId: 'cand-hero-001', imageUrl: URLS.hero },
    { composerSlotId: 'circle', refSlotId: 'circle', candidateId: 'cand-circle-002', imageUrl: URLS.circle },
    { composerSlotId: 'support_2', refSlotId: 'support', candidateId: 'cand-support-003', imageUrl: URLS.reaction },
  ],
});

const RESPONSE_3 = Object.freeze({
  success: true,
  template: TEMPLATE_ID,
  refSimilarity: null,
  qcFlags: [],
  manifest: {
    composerVersion: 'mega-e-2026-07-10',
    stableOrder: true,
    slots: [
      { slot: 'main', imageUrl: URLS.hero, aHash: 'f0e1d2c3', faceCount: 1, faceBoxes: [], measured: null },
      { slot: 'circle', imageUrl: URLS.circle, aHash: '1122aabb', faceCount: 1, faceBoxes: [], measured: null },
      { slot: 'support_2', imageUrl: URLS.reaction, aHash: '33cc44dd', faceCount: 1, faceBoxes: [], measured: null },
    ],
    outputHash: OUTPUT_HASH,
    strictRender: {
      verified: true,
      refId: REF_ID,
      specHash: HASHES_3.specHash,
      replayHash: HASHES_3.replayHash,
      slots: [
        { composerSlotId: 'main', refSlotId: 'hero', candidateId: 'cand-hero-001', imageUrl: URLS.hero },
        { composerSlotId: 'circle', refSlotId: 'circle', candidateId: 'cand-circle-002', imageUrl: URLS.circle },
        { composerSlotId: 'support_2', refSlotId: 'support', candidateId: 'cand-support-003', imageUrl: URLS.reaction },
      ],
    },
  },
});

test('REQUIRED(P1): a valid 3-slot response with a DUPLICATE outer circle (strict bindings exact, same length) HOLDs on BOTH gates', () => {
  // 0) prove the untampered 3-slot response is genuinely VALID on both gates, so the
  //    HOLD below is caused by the tamper, not a broken fixture.
  const clean = adaptLiveResponse(clone(RESPONSE_3));
  assert.equal(evaluateStructuralGates(clean).pass, true, evaluateStructuralGates(clean).reasons.join(','));
  assert.equal(validateGolden(GOLDEN_3).ok, true, validateGolden(GOLDEN_3).reasons.join(','));
  assert.equal(validateAgainstGolden(clean, GOLDEN_3).pass, true, validateAgainstGolden(clean, GOLDEN_3).reasons.join(','));

  // 1) replace outer slots[2] (support_2) with a DUPLICATE of the circle OUTER slot —
  //    SAME length (3); the RAW strictRender.slots bindings stay EXACT/correct.
  const resp = clone(RESPONSE_3);
  resp.manifest.slots[2] = clone(resp.manifest.slots[1]); // outer now [main, circle, circle]
  assert.deepEqual(resp.manifest.slots.map((s) => s.slot), ['main', 'circle', 'circle']);
  assert.deepEqual(resp.manifest.strictRender.slots.map((s) => s.composerSlotId), ['main', 'circle', 'support_2']); // bindings intact

  const a = adaptLiveResponse(resp);

  // evaluateStructuralGates HOLDs: a duplicated circle is now caught (symmetric to hero_duplicate)
  const structural = evaluateStructuralGates(a);
  assert.equal(structural.pass, false);
  assert.ok(structural.reasons.includes('circle_duplicate'), structural.reasons.join(','));

  // validateAgainstGolden HOLDs, flagging BOTH the duplicate AND the missing outer slot
  const res = validateAgainstGolden(a, GOLDEN_3);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes('outer_slot_duplicate:circle'), res.reasons.join(','));
  assert.ok(res.reasons.includes('outer_slot_missing:support_2'), res.reasons.join(','));
});

test('REQUIRED(P1): main() runs the outer 1:1 check in the LIVE path — malformed A+B HOLDs (fetch stubbed, offline)', async () => {
  // Prove the check fires on the real run path, not just in an isolated unit test.
  // Uses a SUPPORT-slot duplicate so the malformed response PASSES the structural gate
  // and main() must specifically exercise validateAgainstGolden's new outer 1:1 check
  // (a circle/hero duplicate would be caught earlier by the structural gate). SAME
  // length + duplicate + missing — the exact false-PASS shape, proven end-to-end.
  const tampered = clone(CAPTURED_RESPONSE);
  tampered.manifest.slots[3] = clone(tampered.manifest.slots[2]); // outer [main, circle, reaction_2, reaction_2]; context_3 missing
  assert.deepEqual(tampered.manifest.slots.map((s) => s.slot), ['main', 'circle', 'reaction_2', 'reaction_2']);
  assert.deepEqual(tampered.manifest.strictRender.slots.map((s) => s.composerSlotId), ['main', 'circle', 'reaction_2', 'context_3']); // bindings intact
  // sanity: this malformation PASSES the structural gate — only the golden outer check can catch it.
  assert.equal(evaluateStructuralGates(adaptLiveResponse(clone(tampered))).pass, true);

  const savedFetch = global.fetch;
  const saved = {
    pj: process.env.AC0084_PAYLOAD_JSON, gj: process.env.AC0084_GOLDEN_JSON,
    pf: process.env.AC0084_PAYLOAD_FILE, gf: process.env.AC0084_GOLDEN_FILE,
    strict: process.env.MEGA_STRICT_RENDER,
  };
  let calls = 0;
  // Offline fetch stub — NO real network. Returns the identical malformed response for A and B.
  global.fetch = async () => { calls++; return { status: 200, json: async () => clone(tampered) }; };
  process.env.AC0084_PAYLOAD_JSON = JSON.stringify(REAL_PAYLOAD);
  process.env.AC0084_GOLDEN_JSON = JSON.stringify(CURATED_GOLDEN);
  delete process.env.AC0084_PAYLOAD_FILE; delete process.env.AC0084_GOLDEN_FILE;
  process.env.MEGA_STRICT_RENDER = '1';
  try {
    await assert.rejects(
      main(),
      (e) => e instanceof HoldError
        && /golden authority validation failed on response A/.test(e.message)
        && /outer_slot_duplicate:reaction_2/.test(e.message)
        && /outer_slot_missing:context_3/.test(e.message),
    );
    // BOTH identical POSTs (A and B) were issued on the live path before validation ran.
    assert.equal(calls, 2, `expected two live POSTs (A + B), got ${calls}`);
  } finally {
    global.fetch = savedFetch;
    for (const [k, v] of [['AC0084_PAYLOAD_JSON', saved.pj], ['AC0084_GOLDEN_JSON', saved.gj], ['AC0084_PAYLOAD_FILE', saved.pf], ['AC0084_GOLDEN_FILE', saved.gf], ['MEGA_STRICT_RENDER', saved.strict]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
