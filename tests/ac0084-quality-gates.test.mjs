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
// AC-0099 LANE-B: the canonical strict-latch resolver under test (pure, from the contract).
import { resolveStrictLatches, STRICT_LATCH_KEYS } from '../src/lib/refSlotContract.js';
// WAVE1C: SelectionAuthority v1 + SelectionSpec v2 — DIRECT imports of the REAL
// contract functions (never a re-implemented copy). validateStrictRenderActivation
// is imported too, to prove the versioned dispatcher delegates to it verbatim.
import {
  SELECTION_AUTHORITY_VERSION,
  SELECTION_SPEC_V2_VERSION,
  buildSelectionAuthorityV1,
  validateSelectionAuthorityV1,
  buildSelectionSpecV2,
  validateSelectionSpecV2Activation,
  validateStrictRenderActivationVersioned,
  validateStrictRenderActivation,
} from '../src/lib/refSlotContract.js';
import { createHash as _wave1cCreateHash } from 'node:crypto';
// WAVE1C #7 — READ-ONLY imports of the frozen foundation modules, used ONLY by the
// cross-foundation handshake test to source REAL authority hashes (never edited here).
import { buildHeroShotContract } from '../src/lib/heroShotContract.js';
import { buildStoryReferenceAuthorityContract } from '../src/lib/storyReferenceAuthority.js';
import { buildCastManifest, hashCastManifest, validateCastManifestStructure, assertCastManifestIntegrity } from '../src/lib/castManifest.js';
import { buildSemanticGlobalAssignment } from '../src/lib/semanticGlobalAssignment.js';

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

// ============================================================
// AC-0099 LANE-B — the typo latch. Setting the alias MEGA_STRICT_RENDERER='1' (an extra 'R')
// with the canonical MEGA_STRICT_RENDER UNSET must NOT arm the renderer: the payload still
// HOLDs not-armed, AND the alias is surfaced as unknownStrictLikeKeys so the mis-set is loud.
// ============================================================
test('preflight HOLDs on the MEGA_STRICT_RENDERER alias (canonical RENDER unset) + surfaces it as unknownStrictLikeKeys', () => {
  const res = assertStrictPayloadContract(REAL_PAYLOAD, { MEGA_STRICT_RENDERER: '1' });
  assert.equal(res.ok, false, 'alias must not arm the renderer');
  assert.ok(res.reasons.includes('MEGA_STRICT_RENDER_not_armed'), res.reasons.join(','));
  // the alias is reported, not silently swallowed
  assert.ok(Array.isArray(res.unknownStrictLikeKeys), 'result must carry unknownStrictLikeKeys');
  assert.ok(res.unknownStrictLikeKeys.includes('MEGA_STRICT_RENDERER'), res.unknownStrictLikeKeys.join(','));
  // and it is echoed as a NAMED warning (warnings never flip ok)
  assert.ok(res.warnings.includes('strict_like_alias_ignored:MEGA_STRICT_RENDERER'), (res.warnings || []).join(','));
});

// ============================================================
// AC-0099 LANE-B — resolveStrictLatches direct unit tests (arm matrix, hostile env, aliases).
// ============================================================
test('resolveStrictLatches: canonical key list is the frozen expected set', () => {
  assert.deepEqual(STRICT_LATCH_KEYS, [
    'MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_STRICT_PRODUCER', 'MEGA_STRICT_RENDER', 'MEGA_REF_SHOT_AUTHORITY',
  ]);
  assert.ok(Object.isFrozen(STRICT_LATCH_KEYS), 'STRICT_LATCH_KEYS must be frozen');
});

test('resolveStrictLatches: renderer arms on MEGA_STRICT_RENDER === "1" EXACTLY, nothing else', () => {
  // exact '1' arms the renderer
  assert.equal(resolveStrictLatches({ MEGA_STRICT_RENDER: '1' }).armedRenderer, true);
  // every near-miss value must NOT arm
  for (const v of ['1 ', ' 1', '01', 1, 'true', 'TRUE', 'yes', 'on', '', '0', null, undefined, {}, ['1']]) {
    assert.equal(resolveStrictLatches({ MEGA_STRICT_RENDER: v }).armedRenderer, false, `value ${JSON.stringify(v)} must not arm`);
  }
});

test('resolveStrictLatches: producer arms on the ORDINARY 4 core latches (SEMANTIC,SPEC,PRODUCER,RENDER) — mirrors S7 strictWireOn', () => {
  // the ORDINARY semantic-strict wire — NO ref-shot authority involved
  const core = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1', MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1' };
  const full = resolveStrictLatches(core);
  assert.equal(full.armedProducer, true, '4 ordinary core armed WITHOUT REF_SHOT_AUTHORITY => producer armed');
  assert.equal(full.armedRenderer, true, 'RENDER is part of the ordinary wire');
  assert.equal(full.armedRefShotAuthority, false, 'REF_SHOT_AUTHORITY absent => its own flag false, producer still armed');
  // dropping any single core latch disarms the producer
  for (const k of Object.keys(core)) {
    const partial = { ...core }; delete partial[k];
    assert.equal(resolveStrictLatches(partial).armedProducer, false, `missing ${k} => producer NOT armed`);
  }
  // a near-miss value on a core latch also disarms
  assert.equal(resolveStrictLatches({ ...core, MEGA_STRICT_PRODUCER: '1 ' }).armedProducer, false);
});

test('resolveStrictLatches: REF_SHOT_AUTHORITY is a SEPARATE latch — never folded into armedProducer', () => {
  const core = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1', MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1' };
  // REF_SHOT_AUTHORITY alone must arm NOTHING (no ordinary core) — its own flag only
  const alone = resolveStrictLatches({ MEGA_REF_SHOT_AUTHORITY: '1' });
  assert.equal(alone.armedProducer, false, 'ref-shot alone must not arm the ordinary producer');
  assert.equal(alone.armedRenderer, false);
  assert.equal(alone.armedRefShotAuthority, true, 'its own dedicated flag reflects it');
  // adding REF_SHOT_AUTHORITY to a fully-armed ordinary wire does NOT change armedProducer
  const withRef = resolveStrictLatches({ ...core, MEGA_REF_SHOT_AUTHORITY: '1' });
  assert.equal(withRef.armedProducer, true);
  assert.equal(withRef.armedRefShotAuthority, true);
  // removing REF_SHOT_AUTHORITY does not change armedProducer either
  assert.equal(resolveStrictLatches(core).armedProducer, resolveStrictLatches({ ...core, MEGA_REF_SHOT_AUTHORITY: '1' }).armedProducer);
  // and a near-miss ref value does not set its flag
  assert.equal(resolveStrictLatches({ MEGA_REF_SHOT_AUTHORITY: '1 ' }).armedRefShotAuthority, false);
});

test('resolveStrictLatches: values echoes raw canonical values (undefined when absent)', () => {
  const r = resolveStrictLatches({ MEGA_STRICT_RENDER: '1', MEGA_SELECTION_SPEC: 'x' });
  assert.equal(r.values.MEGA_STRICT_RENDER, '1');
  assert.equal(r.values.MEGA_SELECTION_SPEC, 'x');
  assert.equal(r.values.MEGA_SEMANTIC_SELECTION, undefined);
  assert.equal(r.values.MEGA_STRICT_PRODUCER, undefined);
  assert.equal(r.values.MEGA_REF_SHOT_AUTHORITY, undefined);
});

test('resolveStrictLatches: alias detection — MEGA_STRICT_RENDERER (and other strict-like keys) NOT in canonical', () => {
  const r = resolveStrictLatches({ MEGA_STRICT_RENDERER: '1', MEGA_STRICT_RENDER: '1', MEGA_RENDER_STRICT_X: '1', UNRELATED: '1', MEGA_SELECTION_SPEC: '1' });
  assert.equal(r.armedRenderer, true, 'the CANONICAL render key arms');
  assert.ok(r.unknownStrictLikeKeys.includes('MEGA_STRICT_RENDERER'), r.unknownStrictLikeKeys.join(','));
  assert.ok(r.unknownStrictLikeKeys.includes('MEGA_RENDER_STRICT_X'), r.unknownStrictLikeKeys.join(','));
  // canonical + non-strict-like keys are never reported as unknown
  assert.ok(!r.unknownStrictLikeKeys.includes('MEGA_STRICT_RENDER'));
  assert.ok(!r.unknownStrictLikeKeys.includes('MEGA_SELECTION_SPEC'));
  assert.ok(!r.unknownStrictLikeKeys.includes('UNRELATED'));
});

test('resolveStrictLatches: fail-closed + never throws on hostile env-like inputs', () => {
  // non-object inputs => nothing armed, empty aliases, canonical values undefined
  for (const bad of [null, undefined, 42, 'MEGA_STRICT_RENDER=1', true, Symbol('x')]) {
    const r = resolveStrictLatches(bad);
    assert.equal(r.armedProducer, false);
    assert.equal(r.armedRenderer, false);
    assert.deepEqual(r.unknownStrictLikeKeys, []);
    for (const k of STRICT_LATCH_KEYS) assert.equal(r.values[k], undefined);
  }
  // a throwing getter on the canonical key must be swallowed (read => undefined, not armed)
  const throwyGetter = {};
  Object.defineProperty(throwyGetter, 'MEGA_STRICT_RENDER', { enumerable: true, get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => resolveStrictLatches(throwyGetter));
  assert.equal(resolveStrictLatches(throwyGetter).armedRenderer, false);
  // a Proxy whose ownKeys/get traps throw must be swallowed (no alias enumeration, nothing armed)
  const hostileProxy = new Proxy({}, {
    ownKeys() { throw new Error('ownKeys boom'); },
    get() { throw new Error('get boom'); },
    getOwnPropertyDescriptor() { throw new Error('gopd boom'); },
    has() { throw new Error('has boom'); },
  });
  assert.doesNotThrow(() => resolveStrictLatches(hostileProxy));
  const rp = resolveStrictLatches(hostileProxy);
  assert.equal(rp.armedRenderer, false);
  assert.equal(rp.armedProducer, false);
  assert.deepEqual(rp.unknownStrictLikeKeys, []);
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

// ============================================================
// 🔐 WAVE1C — SelectionAuthority v1 + SelectionSpec v2 (corrective pass)
// ------------------------------------------------------------
// Direct-import suite over the REAL contract functions. Authority hashes on the
// happy paths are derived by an INDEPENDENT canonicalizer here (_w1cSha, over
// node:crypto — allowed in the test), so the impl's pure SHA-256 is cross-checked
// against the standard, and V2 activation is externally PINNED.
// ============================================================

function _w1cSortDeep(v) {
  if (Array.isArray(v)) return v.map(_w1cSortDeep);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = _w1cSortDeep(v[k]);
    return o;
  }
  return v;
}
const _w1cSha = (obj) => _wave1cCreateHash('sha256').update(JSON.stringify(_w1cSortDeep(obj)), 'utf8').digest('hex');
const _w1cClone = (o) => JSON.parse(JSON.stringify(o));
const _w1cNUL = String.fromCharCode(0);

// Pure-SHA-256 evidence chain (see the 'W1C #2' tests below): (a) the node:crypto
// oracle used here is pinned to the NIST SHA-256 known-answer vectors (KAT test);
// (b) the impl's authority hash is proven byte-identical to that oracle across a
// message-length/padding + multi-byte-UTF-8 sweep. Together these establish that the
// impl computes genuine SHA-256 — with NO test-only production export.
const W1C_STORY = 'a1'.repeat(32);  // 64 hex — SHA-256-shaped (story authority)
const W1C_CAST = 'b2'.repeat(32);   // 64 hex (cast manifest)
const W1C_ASSIGN = 'c3'.repeat(32); // 64 hex (global assignment)
const W1C_HEROHASH = '1a2b3c4d';    // 8 hex — fnv1a32-shaped (hero contract)

const W1C_SLOTS = Object.freeze([
  { refSlotId: 'hero', order: 1, role: 'hero', shape: 'rect', personId: 'p1', candidateId: 'c1', sourceAssetId: 's1' },
  { refSlotId: 'circle', order: 2, role: 'circle', shape: 'circle', personId: 'p2', candidateId: 'c2', sourceAssetId: 's2' },
  { refSlotId: 'reaction', order: 3, role: 'reaction', shape: 'rect', personId: null, candidateId: 'c3', sourceAssetId: 's3' },
  { refSlotId: 'context', order: 4, role: 'context', shape: 'rect', personId: 'p4', candidateId: 'c4', sourceAssetId: 's4' },
]);
const W1C_HERO = Object.freeze({ heroContractHash: W1C_HEROHASH, refSlotId: 'hero', personId: 'p1', candidateId: 'c1', sourceAssetId: 's1' });
const W1C_EXPECTED_SEL = _w1cSha({ v: 1, storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN, hero: W1C_HERO, slots: W1C_SLOTS });
const W1C_SPEC_KEYS = ['v', 'mode', 'source', 'refId', 'strictReady', 'authority', 'hero', 'canvas', 'counts', 'diagnostics', 'specHash', 'replayHash', 'slots'];

function w1cBuildInput(over = {}) {
  return {
    storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN,
    hero: _w1cClone(W1C_HERO), slots: _w1cClone(W1C_SLOTS),
    expectedSelectionAuthorityHash: W1C_EXPECTED_SEL,
    expectedStoryAuthorityHash: W1C_STORY, expectedCastManifestHash: W1C_CAST,
    expectedAssignmentHash: W1C_ASSIGN, expectedHeroContractHash: W1C_HEROHASH,
    ...over,
  };
}
function w1cValidateInput(env, over = {}) {
  return {
    selectionAuthority: env, expectedSelectionAuthorityHash: W1C_EXPECTED_SEL,
    expectedStoryAuthorityHash: W1C_STORY, expectedCastManifestHash: W1C_CAST,
    expectedAssignmentHash: W1C_ASSIGN, expectedHeroContractHash: W1C_HEROHASH, ...over,
  };
}
function w1cAuthority() {
  const r = buildSelectionAuthorityV1(w1cBuildInput());
  assert.equal(r.ok, true, `baseline authority must build: ${JSON.stringify(r.reasons)}`);
  return r.selectionAuthority;
}

const W1C_REALIZED = Object.freeze({
  templateId: 'ref_dna', canvasW: 1080, canvasH: 1350, feather: 22,
  slots: [
    { id: 'main', x: 0, y: 0, w: 1080, h: 700, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' },
    { id: 'circle', x: 60, y: 720, w: 300, h: 300, zIndex: 4, border: true, borderWidth: 16, shape: 'circle' },
    { id: 'reaction_2', x: 400, y: 720, w: 620, h: 300, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' },
    { id: 'context_3', x: 0, y: 1040, w: 1080, h: 310, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' },
  ],
});
const W1C_BINDINGS = Object.freeze([
  { refSlotId: 'hero', composerSlotId: 'main', candidateId: 'c1', sourceAssetId: 's1', imageUrl: 'https://cdn/h.jpg' },
  { refSlotId: 'circle', composerSlotId: 'circle', candidateId: 'c2', sourceAssetId: 's2', imageUrl: 'https://cdn/c.jpg' },
  { refSlotId: 'reaction', composerSlotId: 'reaction_2', candidateId: 'c3', sourceAssetId: 's3', imageUrl: 'https://cdn/r.jpg' },
  { refSlotId: 'context', composerSlotId: 'context_3', candidateId: 'c4', sourceAssetId: 's4', imageUrl: 'https://cdn/x.jpg' },
]);
function w1cV2Input(over = {}) {
  return {
    selectionAuthority: w1cAuthority(), expectedSelectionAuthorityHash: W1C_EXPECTED_SEL,
    renderBindings: _w1cClone(W1C_BINDINGS), realizedTemplate: _w1cClone(W1C_REALIZED), refId: 'AC-W1C', ...over,
  };
}
function w1cSpec() {
  const r = buildSelectionSpecV2(w1cV2Input());
  assert.equal(r.ok, true, `baseline v2 spec must build: ${JSON.stringify(r.reasons)}`);
  return r.selectionSpec;
}
// Clean external pins for activation, from a fresh deterministic build.
function w1cCleanPins() { const s = w1cSpec(); return { expectedSpecHash: s.specHash, expectedReplayHash: s.replayHash }; }
// Activate a (possibly tampered) spec against the CLEAN external pins by default.
function w1cActivate(spec, over = {}) {
  const pins = w1cCleanPins();
  return validateSelectionSpecV2Activation({
    selectionSpec: spec, selectionAuthority: w1cAuthority(), expectedSelectionAuthorityHash: W1C_EXPECTED_SEL,
    expectedSpecHash: pins.expectedSpecHash, expectedReplayHash: pins.expectedReplayHash,
    realizedTemplate: _w1cClone(W1C_REALIZED), ...over,
  });
}
// Independent recompute of a spec's specHash/replayHash from the documented payload.
function _w1cV2Hashes(s) {
  const identity = s.slots.map((sl) => ({
    refSlotId: sl.refSlotId, composerSlotId: sl.composerSlotId, order: sl.order, role: sl.role, shape: sl.shape,
    render: { x: sl.render.x, y: sl.render.y, w: sl.render.w, h: sl.render.h, zIndex: sl.render.zIndex, border: sl.render.border, borderWidth: sl.render.borderWidth },
    primary: { personId: sl.primary.personId, candidateId: sl.primary.candidateId, sourceAssetId: sl.primary.sourceAssetId },
  }));
  const sp = {
    v: 2, refId: s.refId,
    authority: { selectionAuthorityHash: s.authority.selectionAuthorityHash, storyAuthorityHash: s.authority.storyAuthorityHash, castManifestHash: s.authority.castManifestHash, assignmentHash: s.authority.assignmentHash, heroContractHash: s.authority.heroContractHash },
    hero: { heroSlotId: s.hero.heroSlotId, personId: s.hero.personId, candidateId: s.hero.candidateId, sourceAssetId: s.hero.sourceAssetId },
    canvas: { templateId: s.canvas.templateId, canvasW: s.canvas.canvasW, canvasH: s.canvas.canvasH, feather: s.canvas.feather },
    slots: identity,
  };
  return { specHash: _w1cSha(sp), replayHash: _w1cSha({ ...sp, urls: s.slots.map((sl) => ({ refSlotId: sl.refSlotId, imageUrl: sl.primary.imageUrl })) }) };
}
// Re-sign a mutated spec so its embedded hashes match its (tampered) contents.
function _w1cReSign(s) { const h = _w1cV2Hashes(s); s.specHash = h.specHash; s.replayHash = h.replayHash; return s; }

function w1cAssertNoEcho(reasons, secret) {
  assert.ok(Array.isArray(reasons) && reasons.length > 0, 'reasons must be a non-empty array');
  for (const r of reasons) {
    assert.equal(typeof r, 'string', `reason must be a string, got ${typeof r}`);
    assert.ok(!r.includes(secret), `reason must not echo caller data: ${JSON.stringify(r)}`);
  }
}
const w1cHas = (reasons, code) => reasons.some((r) => r === code || r.startsWith(`${code}:`));

// ---- version constants + pure-SHA256 reference cross-check ----
test('W1C: version constants are exactly 1 and 2', () => {
  assert.equal(SELECTION_AUTHORITY_VERSION, 1);
  assert.equal(SELECTION_SPEC_V2_VERSION, 2);
});
test('W1C: impl pure SHA-256 equals node:crypto (authority hash is byte-identical to the reference)', () => {
  // If the pure implementation diverged from real SHA-256, the builder could not
  // reproduce W1C_EXPECTED_SEL (computed via node:crypto) and would HOLD.
  const r = buildSelectionAuthorityV1(w1cBuildInput());
  assert.equal(r.ok, true);
  assert.equal(r.selectionAuthority.selectionAuthorityHash, W1C_EXPECTED_SEL);
  assert.match(r.selectionAuthority.selectionAuthorityHash, /^[0-9a-f]{64}$/);
});
test('W1C #2 KAT: the node:crypto oracle satisfies the NIST SHA-256 known-answer vectors', () => {
  // Literal known-answer pin for the differential oracle: sha256("abc") and sha256("").
  assert.equal(_wave1cCreateHash('sha256').update('abc', 'utf8').digest('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(_wave1cCreateHash('sha256').update('', 'utf8').digest('hex'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

// ---- SelectionAuthority v1 — happy path ----
test('W1C SA-v1: happy path assigns; envelope exact-shaped; hero personId preserved', () => {
  const r = buildSelectionAuthorityV1(w1cBuildInput());
  assert.equal(r.ok, true);
  assert.equal(r.decision, 'assigned');
  const env = r.selectionAuthority;
  assert.deepEqual(Object.keys(env).sort(), ['assignmentHash', 'castManifestHash', 'hero', 'selectionAuthorityHash', 'slots', 'storyAuthorityHash', 'v'].sort());
  assert.equal(env.v, 1);
  assert.equal(env.hero.personId, 'p1');
  assert.equal(env.slots[2].personId, null); // non-hero slot may be null
});
test('W1C SA-v1: builder success shape (no reasons key); hold shape (reasons + null)', () => {
  assert.deepEqual(Object.keys(buildSelectionAuthorityV1(w1cBuildInput())).sort(), ['decision', 'ok', 'selectionAuthority']);
  const bad = buildSelectionAuthorityV1(w1cBuildInput({ slots: [] }));
  assert.equal(bad.ok, false); assert.equal(bad.decision, 'hold'); assert.equal(bad.selectionAuthority, null);
  assert.ok(Array.isArray(bad.reasons));
});
test('W1C SA-v1: deep-frozen envelope; caller cannot mutate it back into the contract', () => {
  const env = w1cAuthority();
  assert.throws(() => { env.slots.push({}); });
  assert.throws(() => { env.hero.candidateId = 'x'; });
  assert.ok(Object.isFrozen(env) && Object.isFrozen(env.slots) && Object.isFrozen(env.slots[0]) && Object.isFrozen(env.hero));
});
test('W1C SA-v1: mutating caller input after build never changes the frozen output', () => {
  const input = w1cBuildInput();
  const r = buildSelectionAuthorityV1(input);
  const before = JSON.stringify(r.selectionAuthority);
  input.slots[0].candidateId = 'HACKED'; input.hero.personId = 'HACKED'; input.storyAuthorityHash = 'deadbeef';
  assert.equal(JSON.stringify(r.selectionAuthority), before);
});
test('W1C SA-v1: validator round-trips a freshly built envelope', () => {
  const v = validateSelectionAuthorityV1(w1cValidateInput(w1cAuthority()));
  assert.equal(v.ok, true); assert.equal(v.decision, 'assigned');
  assert.equal(v.selectionAuthority.selectionAuthorityHash, W1C_EXPECTED_SEL);
});

// ---- #7 permutation honesty: OBJECT KEY order permutes; SLOT ARRAY order is canonical ----
test('W1C SA-v1: deterministic under OBJECT-KEY permutation (slot array order is NOT permuted)', () => {
  const permInput = {
    expectedHeroContractHash: W1C_HEROHASH,
    slots: W1C_SLOTS.map((s) => ({ sourceAssetId: s.sourceAssetId, candidateId: s.candidateId, personId: s.personId, shape: s.shape, role: s.role, order: s.order, refSlotId: s.refSlotId })),
    hero: { sourceAssetId: W1C_HERO.sourceAssetId, candidateId: W1C_HERO.candidateId, personId: W1C_HERO.personId, refSlotId: W1C_HERO.refSlotId, heroContractHash: W1C_HERO.heroContractHash },
    expectedAssignmentHash: W1C_ASSIGN, expectedCastManifestHash: W1C_CAST, expectedStoryAuthorityHash: W1C_STORY,
    expectedSelectionAuthorityHash: W1C_EXPECTED_SEL, assignmentHash: W1C_ASSIGN, castManifestHash: W1C_CAST, storyAuthorityHash: W1C_STORY,
  };
  const a = buildSelectionAuthorityV1(w1cBuildInput());
  const b = buildSelectionAuthorityV1(permInput);
  assert.equal(b.ok, true);
  assert.equal(JSON.stringify(a.selectionAuthority), JSON.stringify(b.selectionAuthority));
});
test('W1C SA-v1: reversed slot ARRAY (descending order) ⇒ HOLD (canonical ascending required)', () => {
  const slots = _w1cClone(W1C_SLOTS).reverse(); // orders now 4,3,2,1
  const r = buildSelectionAuthorityV1(w1cBuildInput({ slots }));
  assert.equal(r.ok, false);
  assert.ok(w1cHas(r.reasons, 'sa_order_not_ascending'));
});

// ---- #3 EXACT foundation hash grammars (builder + validator) ----
const _W1C_BAD64 = { short: 'a'.repeat(63), long: 'a'.repeat(65), upper: 'A'.repeat(64), nonhex: 'g'.repeat(64) };
const _W1C_BAD8 = { short: 'a'.repeat(7), long: 'a'.repeat(9), upper: 'AABBCCDD', nonhex: 'gggggggg' };
for (const field of ['storyAuthorityHash', 'castManifestHash', 'assignmentHash']) {
  for (const [kind, bad] of Object.entries(_W1C_BAD64)) {
    test(`W1C #3 builder: ${field} ${kind} (not 64 lc hex) ⇒ HOLD`, () => {
      assert.equal(buildSelectionAuthorityV1(w1cBuildInput({ [field]: bad, [`expected${field[0].toUpperCase()}${field.slice(1)}`]: bad })).ok, false);
    });
    test(`W1C #3 validator: envelope ${field} ${kind} ⇒ HOLD`, () => {
      const env = _w1cClone(w1cAuthority()); env[field] = bad;
      assert.equal(validateSelectionAuthorityV1(w1cValidateInput(env)).ok, false);
    });
  }
}
for (const [kind, bad] of Object.entries(_W1C_BAD8)) {
  test(`W1C #3 builder: heroContractHash ${kind} (not 8 lc hex) ⇒ HOLD`, () => {
    const hero = { ..._w1cClone(W1C_HERO), heroContractHash: bad };
    assert.equal(buildSelectionAuthorityV1(w1cBuildInput({ hero, expectedHeroContractHash: bad })).ok, false);
  });
  test(`W1C #3 validator: envelope heroContractHash ${kind} ⇒ HOLD`, () => {
    const env = _w1cClone(w1cAuthority()); env.hero.heroContractHash = bad;
    assert.equal(validateSelectionAuthorityV1(w1cValidateInput(env, { expectedHeroContractHash: bad })).ok, false);
  });
}
test('W1C #3: 64-hex hero hash rejected (must be 8), 8-hex story hash rejected (must be 64)', () => {
  const hero64 = { ..._w1cClone(W1C_HERO), heroContractHash: 'a'.repeat(64) };
  assert.equal(buildSelectionAuthorityV1(w1cBuildInput({ hero: hero64, expectedHeroContractHash: 'a'.repeat(64) })).ok, false);
  assert.equal(buildSelectionAuthorityV1(w1cBuildInput({ storyAuthorityHash: '1a2b3c4d', expectedStoryAuthorityHash: '1a2b3c4d' })).ok, false);
});
test('W1C #3 validator: envelope selectionAuthorityHash wrong width ⇒ HOLD', () => {
  const env = _w1cClone(w1cAuthority()); env.selectionAuthorityHash = 'a'.repeat(63);
  assert.equal(validateSelectionAuthorityV1(w1cValidateInput(env)).ok, false);
});

// ---- #4 HERO identity nonnull ----
test('W1C #4 builder: hero.personId null ⇒ HOLD (authoritative hero identity required)', () => {
  const r = buildSelectionAuthorityV1(w1cBuildInput({ hero: { ..._w1cClone(W1C_HERO), personId: null } }));
  assert.equal(r.ok, false);
  assert.ok(w1cHas(r.reasons, 'sa_hero_personId_required'));
});
test('W1C #4 builder: hero.personId empty string ⇒ HOLD', () => {
  assert.equal(buildSelectionAuthorityV1(w1cBuildInput({ hero: { ..._w1cClone(W1C_HERO), personId: '' } })).ok, false);
});
test('W1C #4 validator: envelope hero.personId null ⇒ HOLD', () => {
  const env = _w1cClone(w1cAuthority()); env.hero.personId = null;
  assert.equal(validateSelectionAuthorityV1(w1cValidateInput(env)).ok, false);
});
test('W1C #4: non-hero slot personId may be null (contract permits) — baseline reaction slot is null', () => {
  assert.equal(w1cAuthority().slots[2].personId, null);
});

// ---- SA-v1 tamper (every hash + hero field) ----
for (const field of ['storyAuthorityHash', 'castManifestHash', 'assignmentHash']) {
  test(`W1C SA-v1 tamper: body ${field} != expected ⇒ HOLD`, () => {
    const other = field === 'storyAuthorityHash' ? 'f'.repeat(64) : (field === 'castManifestHash' ? 'e'.repeat(64) : 'd'.repeat(64));
    const r = buildSelectionAuthorityV1(w1cBuildInput({ [field]: other }));
    assert.equal(r.ok, false); assert.equal(r.selectionAuthority, null);
  });
}
test('W1C SA-v1 tamper: wrong expectedSelectionAuthorityHash ⇒ HOLD', () => {
  const r = buildSelectionAuthorityV1(w1cBuildInput({ expectedSelectionAuthorityHash: '0'.repeat(64) }));
  assert.equal(r.ok, false);
  assert.ok(w1cHas(r.reasons, 'sa_selection_hash_expected_mismatch'));
});
test('W1C SA-v1 validator tamper: flipped embedded selectionAuthorityHash ⇒ self-mismatch HOLD', () => {
  const env = _w1cClone(w1cAuthority()); env.selectionAuthorityHash = 'e'.repeat(64);
  const v = validateSelectionAuthorityV1(w1cValidateInput(env));
  assert.equal(v.ok, false); assert.ok(w1cHas(v.reasons, 'sa_selection_hash_self_mismatch'));
});
for (const hf of ['personId', 'candidateId', 'sourceAssetId', 'refSlotId']) {
  test(`W1C SA-v1 validator tamper: hero.${hf} changed ⇒ HOLD`, () => {
    const env = _w1cClone(w1cAuthority()); env.hero[hf] = 'TAMPER';
    assert.equal(validateSelectionAuthorityV1(w1cValidateInput(env)).ok, false);
  });
}

// ---- SA-v1 slot invariants ----
test('W1C SA-v1: non-contiguous order [1,2,4] ⇒ HOLD', () => {
  const slots = _w1cClone(W1C_SLOTS); slots[3].order = 5;
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots })).reasons, 'sa_order_not_contiguous'));
});
test('W1C SA-v1: non-ascending order ⇒ HOLD', () => {
  const slots = _w1cClone(W1C_SLOTS); [slots[0].order, slots[1].order] = [2, 1];
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots })).reasons, 'sa_order_not_ascending'));
});
test('W1C SA-v1: duplicate refSlotId / candidateId / sourceAssetId ⇒ HOLD', () => {
  const a = _w1cClone(W1C_SLOTS); a[1].refSlotId = 'hero';
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots: a })).reasons, 'sa_dup_refSlotId'));
  const b = _w1cClone(W1C_SLOTS); b[1].candidateId = 'c1';
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots: b })).reasons, 'sa_dup_candidateId'));
  const c = _w1cClone(W1C_SLOTS); c[1].sourceAssetId = 's1';
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots: c })).reasons, 'sa_dup_sourceAssetId'));
});
test('W1C SA-v1: empty slots ⇒ HOLD; bad shape ⇒ HOLD; empty slot personId string ⇒ HOLD', () => {
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots: [] })).reasons, 'sa_slots_empty'));
  const s1 = _w1cClone(W1C_SLOTS); s1[1].shape = 'hexagon';
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots: s1 })).reasons, 'sa_slot_shape'));
  const s2 = _w1cClone(W1C_SLOTS); s2[2].personId = '';
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots: s2 })).reasons, 'sa_slot_personId'));
});
test('W1C SA-v1: hero.refSlotId with no matching row ⇒ HOLD; hero tuple disagreement ⇒ HOLD', () => {
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ hero: { ..._w1cClone(W1C_HERO), refSlotId: 'ghost' } })).reasons, 'sa_hero_no_row_match'));
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ hero: { ..._w1cClone(W1C_HERO), candidateId: 'nope' }, expectedSelectionAuthorityHash: '0'.repeat(64) })).reasons, 'sa_hero_tuple_mismatch'));
});

// ---- #6 bounds + hostile inputs (no echo, no getter, no throw) ----
test('W1C #6 SA-v1: 9 slots exceeds SA_MAX_SLOTS ⇒ HOLD sa_slots_too_many (bounded before iteration)', () => {
  const many = [];
  for (let i = 1; i <= 9; i++) many.push({ refSlotId: `r${i}`, order: i, role: 'reaction', shape: 'rect', personId: null, candidateId: `c${i}`, sourceAssetId: `s${i}` });
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots: many })).reasons, 'sa_slots_too_many'));
});
test('W1C SA-v1: Proxy input ⇒ HOLD, never throws, no echo', () => {
  const SECRET = 'PROXY_SECRET_9f';
  const r = buildSelectionAuthorityV1(new Proxy(w1cBuildInput({ storyAuthorityHash: SECRET }), {}));
  assert.equal(r.ok, false); w1cAssertNoEcho(r.reasons, SECRET);
});
test('W1C SA-v1: accessor(getter) slot field ⇒ HOLD, getter never invoked, no echo', () => {
  const SECRET = 'GETTER_SECRET_ab';
  const input = w1cBuildInput();
  let invoked = false;
  Object.defineProperty(input.slots[0], 'candidateId', { get() { invoked = true; return SECRET; }, enumerable: true, configurable: true });
  const r = buildSelectionAuthorityV1(input);
  assert.equal(r.ok, false); assert.equal(invoked, false); w1cAssertNoEcho(r.reasons, SECRET);
});
test('W1C SA-v1: symbol key / sparse hole / control char / cycle ⇒ HOLD, no echo', () => {
  const sym = w1cBuildInput(); sym[Symbol('x')] = 'SYMBOL_SECRET';
  assert.equal(buildSelectionAuthorityV1(sym).ok, false);
  const sp = _w1cClone(W1C_SLOTS); delete sp[2];
  assert.equal(buildSelectionAuthorityV1(w1cBuildInput({ slots: sp })).ok, false);
  const ctl = _w1cClone(W1C_SLOTS); ctl[0].candidateId = `c1${_w1cNUL}evil`;
  const rc = buildSelectionAuthorityV1(w1cBuildInput({ slots: ctl }));
  assert.equal(rc.ok, false); w1cAssertNoEcho(rc.reasons, `c1${_w1cNUL}evil`);
  const cyc = {}; cyc.self = cyc; const cs = _w1cClone(W1C_SLOTS); cs[0] = cyc;
  assert.equal(buildSelectionAuthorityV1(w1cBuildInput({ slots: cs })).ok, false);
});
test('W1C #6 SA-v1: exotic-prototype slot (class instance) ⇒ HOLD (prototype rejected)', () => {
  class Row {}
  const inst = Object.assign(new Row(), { refSlotId: 'hero', order: 1, role: 'hero', shape: 'rect', personId: 'p1', candidateId: 'c1', sourceAssetId: 's1' });
  const slots = _w1cClone(W1C_SLOTS); slots[0] = inst;
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots })).reasons, 'sa_slot_keys'));
});
test('W1C #6 SA-v1: non-enumerable own data property on a slot ⇒ HOLD', () => {
  const slots = _w1cClone(W1C_SLOTS);
  Object.defineProperty(slots[0], 'hidden', { value: 1, enumerable: false, configurable: true });
  assert.ok(w1cHas(buildSelectionAuthorityV1(w1cBuildInput({ slots })).reasons, 'sa_slot_keys'));
});
test('W1C #6 SA-v1: exotic-prototype top-level input ⇒ HOLD', () => {
  class In {}
  assert.equal(buildSelectionAuthorityV1(Object.assign(new In(), w1cBuildInput())).ok, false);
});

// ---- SelectionSpec v2 happy + independent hash oracle (#7) ----
test('W1C SS-v2: happy path builds a fully-shaped, deep-frozen spec; specHash/replayHash match INDEPENDENT oracle', () => {
  const s = w1cSpec();
  assert.deepEqual(Object.keys(s).sort(), W1C_SPEC_KEYS.slice().sort());
  assert.equal(s.v, 2); assert.equal(s.mode, 'semantic_global_exact'); assert.equal(s.source, 'selection_authority');
  assert.equal(s.strictReady, true); assert.equal(s.refId, 'AC-W1C');
  assert.equal(s.hero.heroSlotId, 'hero'); assert.equal(s.hero.personId, 'p1');
  assert.equal(s.authority.selectionAuthorityHash, W1C_EXPECTED_SEL);
  const exp = _w1cV2Hashes(s);
  assert.equal(s.specHash, exp.specHash, 'specHash must equal independent documented-payload SHA-256');
  assert.equal(s.replayHash, exp.replayHash, 'replayHash must equal independent documented-payload SHA-256');
  assert.notEqual(s.specHash, s.replayHash);
  assert.deepEqual(s.counts, { total: 4, mapped: 4, unmapped: 0, missingPrimary: 0, duplicateCandidate: 0, duplicateSourceAsset: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 });
  assert.deepEqual(s.diagnostics, { codes: [] });
  for (const sl of s.slots) assert.deepEqual(sl.backups, []);
  assert.deepEqual(s.slots[1].render, { x: 60, y: 720, w: 300, h: 300, zIndex: 4, border: true, borderWidth: 16 });
  assert.throws(() => { s.slots.push({}); });
});
test('W1C SS-v2: deterministic under binding array + key permutation', () => {
  const base = w1cSpec();
  const permBindings = [W1C_BINDINGS[3], W1C_BINDINGS[0], W1C_BINDINGS[2], W1C_BINDINGS[1]]
    .map((b) => ({ imageUrl: b.imageUrl, sourceAssetId: b.sourceAssetId, candidateId: b.candidateId, composerSlotId: b.composerSlotId, refSlotId: b.refSlotId }));
  const r = buildSelectionSpecV2(w1cV2Input({ renderBindings: permBindings }));
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.selectionSpec), JSON.stringify(base));
});
test('W1C SS-v2: URL-only change moves replayHash but NOT specHash', () => {
  const base = w1cSpec();
  const bindings = _w1cClone(W1C_BINDINGS); bindings[0].imageUrl = 'https://cdn/h-DIFFERENT.jpg';
  const r = buildSelectionSpecV2(w1cV2Input({ renderBindings: bindings }));
  assert.equal(r.ok, true);
  assert.equal(r.selectionSpec.specHash, base.specHash);
  assert.notEqual(r.selectionSpec.replayHash, base.replayHash);
});
test('W1C SS-v2: geometry change moves specHash; identity change moves specHash', () => {
  const base = w1cSpec();
  const realized = _w1cClone(W1C_REALIZED); realized.slots[0].w = 1000; // on-canvas (0+1000<=1080), still moves geometry
  assert.notEqual(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: realized })).selectionSpec.specHash, base.specHash);
  const slots = _w1cClone(W1C_SLOTS); slots[0].candidateId = 'c1x';
  const hero = { ..._w1cClone(W1C_HERO), candidateId: 'c1x' };
  const expSel = _w1cSha({ v: 1, storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN, hero, slots });
  const authRes = buildSelectionAuthorityV1(w1cBuildInput({ slots, hero, expectedSelectionAuthorityHash: expSel }));
  const bindings = _w1cClone(W1C_BINDINGS); bindings[0].candidateId = 'c1x';
  const r = buildSelectionSpecV2({ selectionAuthority: authRes.selectionAuthority, expectedSelectionAuthorityHash: expSel, renderBindings: bindings, realizedTemplate: _w1cClone(W1C_REALIZED), refId: 'AC-W1C' });
  assert.notEqual(r.selectionSpec.specHash, base.specHash);
});

// ---- SS-v2 HOLD paths ----
test('W1C SS-v2: authority↔expected hash mismatch ⇒ HOLD v2_authority_hash_mismatch', () => {
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ expectedSelectionAuthorityHash: '0'.repeat(64) })).reasons, 'v2_authority_hash_mismatch'));
});
test('W1C SS-v2: candidateId / sourceAssetId substitution ⇒ HOLD v2_asset_substitution', () => {
  const b1 = _w1cClone(W1C_BINDINGS); b1[0].candidateId = 'EVIL';
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ renderBindings: b1 })).reasons, 'v2_asset_substitution'));
  const b2 = _w1cClone(W1C_BINDINGS); b2[2].sourceAssetId = 'EVIL';
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ renderBindings: b2 })).reasons, 'v2_asset_substitution'));
});
test('W1C SS-v2: duplicate composerSlotId / primary URL ⇒ HOLD', () => {
  const b1 = _w1cClone(W1C_BINDINGS); b1[2].composerSlotId = 'main';
  const r1 = buildSelectionSpecV2(w1cV2Input({ renderBindings: b1 }));
  assert.ok(w1cHas(r1.reasons, 'v2_dup_composer_id') || w1cHas(r1.reasons, 'v2_realized_set_mismatch'));
  const b2 = _w1cClone(W1C_BINDINGS); b2[1].imageUrl = b2[0].imageUrl;
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ renderBindings: b2 })).reasons, 'v2_dup_primary_url'));
});
test('W1C SS-v2: unknown refSlot / missing binding / realized set mismatch / extra binding key ⇒ HOLD', () => {
  const b1 = _w1cClone(W1C_BINDINGS); b1.push({ refSlotId: 'ghost', composerSlotId: 'x', candidateId: 'cz', sourceAssetId: 'sz', imageUrl: 'https://cdn/z.jpg' });
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ renderBindings: b1 })).reasons, 'v2_binding_unknown_refSlot'));
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ renderBindings: _w1cClone(W1C_BINDINGS).slice(0, 3) })).reasons, 'v2_binding_missing'));
  const rz = _w1cClone(W1C_REALIZED); rz.slots.pop();
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: rz })).reasons, 'v2_realized_set_mismatch'));
  const b2 = _w1cClone(W1C_BINDINGS); b2[0].backups = [{ candidateId: 'b', imageUrl: 'u' }];
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ renderBindings: b2 })).reasons, 'v2_binding_keys'));
});
test('W1C SS-v2: rounded needs realized rounded evidence (unsupported ⇒ HOLD; supported ⇒ builds); rect vs circle ⇒ HOLD', () => {
  const slots = _w1cClone(W1C_SLOTS); slots[2].shape = 'rounded';
  const hero = _w1cClone(W1C_HERO);
  const expSel = _w1cSha({ v: 1, storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN, hero, slots });
  const env = buildSelectionAuthorityV1(w1cBuildInput({ slots, hero, expectedSelectionAuthorityHash: expSel })).selectionAuthority;
  assert.ok(w1cHas(buildSelectionSpecV2({ selectionAuthority: env, expectedSelectionAuthorityHash: expSel, renderBindings: _w1cClone(W1C_BINDINGS), realizedTemplate: _w1cClone(W1C_REALIZED), refId: 'AC-W1C' }).reasons, 'v2_shape_unsupported'));
  const rr = _w1cClone(W1C_REALIZED); rr.slots[2].shape = 'rounded';
  const okR = buildSelectionSpecV2({ selectionAuthority: env, expectedSelectionAuthorityHash: expSel, renderBindings: _w1cClone(W1C_BINDINGS), realizedTemplate: rr, refId: 'AC-W1C' });
  assert.equal(okR.ok, true); assert.equal(okR.selectionSpec.slots[2].shape, 'rounded');
  const rc = _w1cClone(W1C_REALIZED); rc.slots[0].shape = 'circle';
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: rc })).reasons, 'v2_shape_mismatch'));
});

// ---- #6 V2 bounds ----
test('W1C #6 SS-v2: 9 renderBindings ⇒ HOLD v2_bindings_too_many', () => {
  const many = []; for (let i = 0; i < 9; i++) many.push({ refSlotId: `r${i}`, composerSlotId: `k${i}`, candidateId: `c${i}`, sourceAssetId: `s${i}`, imageUrl: `https://cdn/${i}.jpg` });
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ renderBindings: many })).reasons, 'v2_bindings_too_many'));
});
test('W1C #6 SS-v2: 9 realized slots ⇒ HOLD v2_realized_slots_too_many', () => {
  const rz = _w1cClone(W1C_REALIZED);
  for (let i = 0; i < 5; i++) rz.slots.push({ id: `extra_${i}`, x: 0, y: 0, w: 10, h: 10, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' });
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: rz })).reasons, 'v2_realized_slots_too_many'));
});
test('W1C #6 SS-v2 validator: 33 diagnostics.codes ⇒ HOLD v2_spec_diag_codes_too_many', () => {
  const spec = _w1cClone(w1cSpec());
  spec.diagnostics.codes = Array.from({ length: 33 }, (_, i) => `code_${i}`);
  assert.ok(w1cHas(w1cActivate(spec).reasons, 'v2_spec_diag_codes_too_many'));
});

// ---- #5 GEOMETRY safety ----
test('W1C #5 SS-v2: off-canvas x+w>canvasW ⇒ HOLD v2_realized_offcanvas', () => {
  const rz = _w1cClone(W1C_REALIZED); rz.slots[0].w = 2000;
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: rz })).reasons, 'v2_realized_offcanvas'));
});
test('W1C #5 SS-v2: off-canvas y+h>canvasH ⇒ HOLD', () => {
  const rz = _w1cClone(W1C_REALIZED); rz.slots[3].h = 5000;
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: rz })).reasons, 'v2_realized_offcanvas'));
});
test('W1C #5 SS-v2: z-index over cap ⇒ HOLD; borderWidth over slot bound ⇒ HOLD; feather over canvas bound ⇒ HOLD', () => {
  const z = _w1cClone(W1C_REALIZED); z.slots[0].zIndex = 100000;
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: z })).reasons, 'v2_realized_zindex'));
  const bw = _w1cClone(W1C_REALIZED); bw.slots[1].borderWidth = 400; // > min(300,300)/2
  assert.ok(w1cHas(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: bw })).reasons, 'v2_realized_border_bounds'));
  const f = _w1cClone(W1C_REALIZED); f.canvasW = 10; f.canvasH = 10; f.feather = 400;
  // feather over the hard cap AND over canvas — either fails closed
  assert.equal(buildSelectionSpecV2(w1cV2Input({ realizedTemplate: f })).ok, false);
});

// ---- #1 EXTERNALLY-PINNED activation ----
test('W1C #1 SS-v2 activate: pins required — omitting expectedSpecHash/expectedReplayHash ⇒ HOLD', () => {
  const spec = w1cSpec();
  const r = validateSelectionSpecV2Activation({ selectionSpec: spec, selectionAuthority: w1cAuthority(), expectedSelectionAuthorityHash: W1C_EXPECTED_SEL, realizedTemplate: _w1cClone(W1C_REALIZED) });
  assert.equal(r.ok, false);
  assert.ok(!('active' in r));
});
test('W1C #1 SS-v2 activate: happy path with matching external pins ⇒ assigned', () => {
  const spec = w1cSpec();
  const r = w1cActivate(spec);
  assert.equal(r.ok, true); assert.equal(r.decision, 'assigned');
  assert.equal(r.selectionSpec.specHash, spec.specHash);
});
test('W1C #1 SS-v2 activate: attacker changes imageUrl and RE-SIGNS both hashes ⇒ HOLD (pin mismatch)', () => {
  const spec = _w1cClone(w1cSpec());
  spec.slots[0].primary.imageUrl = 'https://cdn/EVIL.jpg';
  _w1cReSign(spec); // provided.specHash/replayHash now match the tampered contents
  const r = w1cActivate(spec);
  assert.equal(r.ok, false);
  assert.ok(w1cHas(r.reasons, 'v2_replay_hash_pin_mismatch') || w1cHas(r.reasons, 'v2_replay_hash_mismatch'));
});
test('W1C #1 SS-v2 activate: attacker changes refId and RE-SIGNS ⇒ HOLD (pin mismatch)', () => {
  const spec = _w1cClone(w1cSpec()); spec.refId = 'HACKED'; _w1cReSign(spec);
  const r = w1cActivate(spec);
  assert.equal(r.ok, false);
  assert.ok(w1cHas(r.reasons, 'v2_spec_hash_pin_mismatch') || w1cHas(r.reasons, 'v2_spec_hash_mismatch'));
});
test('W1C #1 SS-v2 activate: attacker swaps composerSlotId between same-shape slots, adjusts geometry, RE-SIGNS ⇒ HOLD', () => {
  const spec = _w1cClone(w1cSpec());
  // reaction (idx2, rect) <-> context (idx3, rect): swap composerSlotId AND render geometry so the
  // spec stays internally consistent with realized; then re-sign so provided hashes match.
  const g2 = { ...spec.slots[2].render }, g3 = { ...spec.slots[3].render };
  spec.slots[2].composerSlotId = 'context_3'; spec.slots[2].render = g3;
  spec.slots[3].composerSlotId = 'reaction_2'; spec.slots[3].render = g2;
  _w1cReSign(spec);
  const r = w1cActivate(spec);
  assert.equal(r.ok, false);
  assert.ok(w1cHas(r.reasons, 'v2_spec_hash_pin_mismatch') || w1cHas(r.reasons, 'v2_spec_hash_mismatch'));
});
test('W1C #1 SS-v2 activate: realized geometry drift ⇒ HOLD', () => {
  const spec = w1cSpec();
  const rz = _w1cClone(W1C_REALIZED); rz.slots[2].w = 600; // reaction_2: 400+600=1000<=1080 (on-canvas), != spec's 620
  const r = w1cActivate(spec, { realizedTemplate: rz });
  assert.equal(r.ok, false);
  assert.ok(w1cHas(r.reasons, 'v2_spec_drift') || w1cHas(r.reasons, 'v2_spec_hash_pin_mismatch') || w1cHas(r.reasons, 'v2_spec_hash_mismatch'));
});
test('W1C #1 SS-v2 activate: tampered embedded specHash ⇒ HOLD', () => {
  const spec = _w1cClone(w1cSpec()); spec.specHash = 'd'.repeat(64);
  assert.equal(w1cActivate(spec).ok, false);
});
test('W1C #1 SS-v2 activate: nonempty backups in the spec ⇒ HOLD v2_backup_nonempty', () => {
  const spec = _w1cClone(w1cSpec()); spec.slots[0].backups = [{ candidateId: 'b1', imageUrl: 'https://cdn/b.jpg' }];
  assert.ok(w1cHas(w1cActivate(spec).reasons, 'v2_backup_nonempty'));
});
test('W1C #4 SS-v2 activate: spec hero.personId null ⇒ HOLD (authoritative hero identity required)', () => {
  const spec = _w1cClone(w1cSpec()); spec.hero.personId = null;
  assert.ok(w1cHas(w1cActivate(spec).reasons, 'v2_spec_hero_person_required'));
});

// ---- #2/#6 fail-closed diagnostics.codes (never throws) ----
function _w1cCodesOutcome(codesValue) {
  const spec = _w1cClone(w1cSpec()); spec.diagnostics.codes = codesValue;
  let threw = null, res = null;
  try { res = w1cActivate(spec); } catch (e) { threw = e; }
  return { threw, res };
}
test('W1C SS-v2 activate: cyclic / BigInt / accessor diagnostics.codes ⇒ HOLD, never throws', () => {
  const cyc = []; cyc.push(cyc);
  for (const codes of [cyc, [10n], [1]]) {
    const { threw, res } = _w1cCodesOutcome(codes);
    assert.equal(threw, null, `must not throw for ${typeof codes[0]}`);
    assert.equal(res.ok, false);
    assert.ok(w1cHas(res.reasons, 'v2_spec_diag_code_invalid'));
  }
  const el = {}; let invoked = false;
  Object.defineProperty(el, 'boom', { get() { invoked = true; throw new Error('x'); }, enumerable: true, configurable: true });
  const g = _w1cCodesOutcome([el]);
  assert.equal(g.threw, null); assert.equal(invoked, false); assert.equal(g.res.ok, false);
});
test('W1C SS-v2 activate: Proxy spec ⇒ HOLD, no echo, never throws', () => {
  const SECRET = 'V2_PROXY_SECRET';
  const px = new Proxy({ ..._w1cClone(w1cSpec()), refId: SECRET }, {});
  let threw = null, res = null;
  try { res = w1cActivate(px); } catch (e) { threw = e; }
  assert.equal(threw, null); assert.equal(res.ok, false); w1cAssertNoEcho(res.reasons, SECRET);
});

// ---- version dispatch ----
test('W1C dispatch: v===2 routes to the v2 activation validator (with pins) ⇒ assigned', () => {
  const spec = w1cSpec(); const pins = w1cCleanPins();
  const d = validateStrictRenderActivationVersioned({ selectionSpec: spec, selectionAuthority: w1cAuthority(), expectedSelectionAuthorityHash: W1C_EXPECTED_SEL, expectedSpecHash: pins.expectedSpecHash, expectedReplayHash: pins.expectedReplayHash, realizedTemplate: _w1cClone(W1C_REALIZED) });
  assert.equal(d.ok, true); assert.equal(d.decision, 'assigned');
});
test('W1C dispatch: v2-shaped input missing pins HOLDs in v2 (never downgrades to legacy)', () => {
  const d = validateStrictRenderActivationVersioned({ selectionSpec: w1cSpec(), realizedTemplate: _w1cClone(W1C_REALIZED) });
  assert.equal(d.ok, false); assert.equal(d.decision, 'hold'); assert.ok(!('active' in d));
});
test('W1C dispatch: non-v2 specs delegate to validateStrictRenderActivation byte-for-byte', () => {
  const v1spec = {
    v: 1, mode: 'ref_slot_exact', source: 'template.slots', refId: REF_ID, strictReady: true,
    specHash: HASHES.specHash, backupPoolHash: HASHES.backupPoolHash, replayHash: HASHES.replayHash,
    counts: { total: 4, mapped: 4, unmapped: 0, missingPrimary: 0, duplicatePrimary: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 },
    diagnostics: { extraPlannedKeys: [], invalidPrimary: [], aliasPrimaryUrls: [], duplicateBackupsDropped: [] },
    slots: SPEC_SLOTS,
  };
  const cases = [
    {}, { selectionSpec: v1spec, realizedTemplate: REALIZED_TEMPLATE },
    { selectionSpec: { v: 1 } }, { selectionSpec: { v: 0 } }, { selectionSpec: { v: 3 } },
    { selectionSpec: { version: 2 } }, { selectionSpec: { v: '2' } },
  ];
  for (const input of cases) {
    assert.equal(JSON.stringify(validateStrictRenderActivationVersioned(input)), JSON.stringify(validateStrictRenderActivation(input)), `verbatim v1 parity failed for ${JSON.stringify(input).slice(0, 60)}`);
  }
});
test('W1C dispatch: hostile Proxy input with v===2 ⇒ stable HOLD in v2, never throws (getter not triggered)', () => {
  // A get-trap proxy: saPeekSpecVersion reads `v` via descriptor (never the get trap),
  // sees 2, routes to v2, which fails closed on the input-key mismatch — no throw.
  const px = new Proxy({ selectionSpec: { v: 2 } }, { get() { throw new Error('trap'); } });
  let threw = null, res = null;
  try { res = validateStrictRenderActivationVersioned(px); } catch (e) { threw = e; }
  assert.equal(threw, null);
  assert.equal(res.ok, false); assert.equal(res.decision, 'hold');
});

// ---- #7 GENUINE cross-foundation handshake — ONE coherent Story→Cast→Hero→Global→SA ----
// The Cast manifest is the IDENTITY AUTHORITY: it is supplied genuine eligible-candidate
// evidence for every required person, its integrity (hold===null + structure + hash) is
// asserted BEFORE any downstream work, and every personId (person_<sha256>), candidateId and
// sourceAssetId used downstream is DERIVED from castM.people[].candidates — never handwritten.
// Hero + Global are built from those derived values; SA rows/hero are derived from
// gaR.assignments + the real Hero binding; exact tuple equality is asserted at each boundary.
const HANDSHAKE_REF = {
  layoutTopology: 'tri-split',
  slotGeometry: [{ shape: 'circle', id: 'circle', xPct: 60, yPct: 0, wPct: 40, hPct: 50 }, { shape: 'rect', id: 'hero', xPct: 0, yPct: 0, wPct: 60, hPct: 100 }],
  prominence: [{ weight: 0.2, slotId: 'circle' }, { weight: 0.8, slotId: 'hero' }],
  shotArchetype: 'tight_portrait_left_wide_right',
  layerIntent: [{ zIndex: 1, slotId: 'circle' }, { zIndex: 0, slotId: 'hero' }],
  ringBorderFeatherSeam: { seam: false, feather: true, border: false, ring: true },
  negativeSpace: { right: 10, left: 0, bottom: 5, top: 5 }, hierarchyTargets: ['circle', 'hero'],
};
// Cast's documented candidate-evidence shape: the six readiness gates all true + a mandatory
// sourceAssetId (defaulted from candidateId), exactly as castManifest requires for eligibility.
const _w1cReadyCandidate = (name, candidateId, over = {}) => ({ name, candidateId, sourceAssetId: `asset-${candidateId}`, searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true, ...over });
const _w1cEligible = (c) => [c.searched, c.triaged, c.clean, c.highResolution, c.cropSafe, c.identityVerified].every(Boolean);
// The Global input, parameterised so the negative test can tamper exactly one field.
function _w1cGlobalInput({ lisaPersonId, rosaPersonId, lisaCand, rosaCand }) {
  return {
    slots: [{ slotId: 'hero', order: 0, role: 'role', shape: 'shape', personId: lisaPersonId }, { slotId: 'reaction', order: 1, role: 'role', shape: 'shape', personId: rosaPersonId }],
    candidates: [
      { candidateId: lisaCand.candidateId, sourceAssetId: lisaCand.sourceAssetId, personId: lisaPersonId, eligibleSlotIds: ['hero'], semanticScore: 9, qualityScore: 9, slotFitScore: 9, sceneKey: 'k-lisa' },
      { candidateId: rosaCand.candidateId, sourceAssetId: rosaCand.sourceAssetId, personId: rosaPersonId, eligibleSlotIds: ['reaction'], semanticScore: 7, qualityScore: 7, slotFitScore: 7, sceneKey: 'k-rosa' },
    ],
    requiredCast: [{ personId: lisaPersonId, required: true, priority: 0 }, { personId: rosaPersonId, required: true, priority: 0 }],
    heroAuthority: { heroSlotId: 'hero', heroPersonId: lisaPersonId, approvedCandidateIds: [lisaCand.candidateId] },
    limits: { maxPersonRepeats: 3, maxSceneRepeats: 3 },
  };
}

// Build all four real foundation outputs coherently; asserts Cast integrity up front.
function w1cHandshakeFoundations() {
  // CAST — supply genuine eligible-candidate evidence for BOTH required persons.
  const castM = buildCastManifest({ article: { requiredCast: ['Lisa', 'Rosa'] }, candidates: [_w1cReadyCandidate('Lisa', 'c-lisa-1'), _w1cReadyCandidate('Rosa', 'c-rosa-1')] });
  // Cast INTEGRITY GATE — must be a genuine success state before any downstream work.
  assert.equal(castM.hold, null, `Cast must not HOLD: ${JSON.stringify(castM.hold)}`);
  assert.equal(validateCastManifestStructure(castM), null, 'Cast manifest structure must be valid');
  assert.doesNotThrow(() => assertCastManifestIntegrity(castM, castM.hash), 'Cast manifest integrity must verify against its own hash');

  const lisa = castM.people.find((p) => p.canonicalName === 'Lisa');
  const rosa = castM.people.find((p) => p.canonicalName === 'Rosa');
  assert.ok(lisa && rosa, 'Cast must carry both required people');
  assert.match(lisa.personId, /^person_[0-9a-f]{64}$/, 'Cast personId is person_<sha256> (never a handwritten name)');
  const lisaCand = lisa.candidates.find(_w1cEligible);
  const rosaCand = rosa.candidates.find(_w1cEligible);
  assert.ok(lisaCand && rosaCand, 'Cast must expose an eligible candidate per required person');

  // STORY about the same person (editorial hero Lisa); provenance uses Cast's real asset ids.
  const storyC = buildStoryReferenceAuthorityContract({
    story: { identities: ['Lisa', 'Rosa'], requiredCast: ['Lisa'], optionalCast: ['Rosa'], editorialHero: 'Lisa', eventContext: 'gallery opening night', facts: ['opening was in Seoul', 'Lisa unveiled the mural'], storySemantics: 'an artist unveiling a mural', eligibleAssetProvenance: [lisaCand.sourceAssetId, rosaCand.sourceAssetId] },
    reference: HANDSHAKE_REF,
  });
  assert.ok(storyC.contract && /^[0-9a-f]{64}$/.test(storyC.contract.hash), 'Story contract must build with a 64-hex hash');
  assert.deepEqual(storyC.contract.rejections, [], 'Story contract must have zero rejections');

  // HERO contract for the Cast person Lisa — bound to Cast's asset + Cast's personId.
  const heroC = buildHeroShotContract({ sourceAssetId: lisaCand.sourceAssetId, heroSlotId: 'hero', story: { personId: lisa.personId, identityConfidenceMin: 0.8 }, reference: { shotClass: 'closeup' } });

  // GLOBAL assigns the Cast-derived candidates (real person_<sha256> ids, real candidate/asset ids).
  const gaInput = _w1cGlobalInput({ lisaPersonId: lisa.personId, rosaPersonId: rosa.personId, lisaCand, rosaCand });
  const gaR = buildSemanticGlobalAssignment(gaInput);
  assert.equal(gaR.decision, 'assigned', `Global must assign: ${gaR.reason}`);

  return {
    castM, storyC, heroC, gaR, lisa, rosa, lisaCand, rosaCand, gaInput,
    REAL_HERO: heroC.contractHash, REAL_STORY: storyC.contract.hash, REAL_CAST: hashCastManifest(castM), REAL_ASSIGN: gaR.assignmentHash,
  };
}
// Derive canonical SA slots (ascending order) from the real Global assignments.
function w1cSaSlotsFromAssignments(gaR, heroSlotId) {
  const asn = gaR.assignments.slice().sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  return asn.map((a, i) => ({ refSlotId: a.slotId, order: i + 1, role: a.slotId === heroSlotId ? 'hero' : a.slotId, shape: 'rect', personId: a.personId, candidateId: a.candidateId, sourceAssetId: a.sourceAssetId }));
}

test('W1C #7 handshake: COHERENT Story→Cast→Hero→Global→SA — every identity DERIVED from real Cast output; exact cross-boundary equality', () => {
  const F = w1cHandshakeFoundations();
  assert.match(F.REAL_HERO, /^[0-9a-f]{8}$/, 'real heroContractHash is 8 hex (fnv1a32)');
  assert.match(F.REAL_STORY, /^[0-9a-f]{64}$/);
  assert.match(F.REAL_CAST, /^[0-9a-f]{64}$/);
  assert.match(F.REAL_ASSIGN, /^[0-9a-f]{64}$/);

  // Story→Cast: the Story's required person resolves to a real Cast person.
  assert.ok(F.castM.people.some((p) => p.canonicalName === 'Lisa'), 'Cast carries the Story required person Lisa');

  // Cast→Hero: hero identity + asset come from the Cast person Lisa (person_<sha256>, real asset).
  assert.equal(F.heroC.story.personId, F.lisa.personId, 'Hero personId == Cast Lisa personId');
  assert.equal(F.heroC.binding.sourceAssetId, F.lisaCand.sourceAssetId, 'Hero asset == Cast Lisa candidate asset');

  // Cast→Global: every Global assignment tuple equals its Cast source exactly.
  const heroAsn = F.gaR.assignments.find((a) => a.slotId === 'hero');
  const reactAsn = F.gaR.assignments.find((a) => a.slotId === 'reaction');
  assert.deepEqual({ personId: heroAsn.personId, candidateId: heroAsn.candidateId, sourceAssetId: heroAsn.sourceAssetId }, { personId: F.lisa.personId, candidateId: F.lisaCand.candidateId, sourceAssetId: F.lisaCand.sourceAssetId }, 'Global hero assignment == Cast Lisa tuple');
  assert.deepEqual({ personId: reactAsn.personId, candidateId: reactAsn.candidateId, sourceAssetId: reactAsn.sourceAssetId }, { personId: F.rosa.personId, candidateId: F.rosaCand.candidateId, sourceAssetId: F.rosaCand.sourceAssetId }, 'Global reaction assignment == Cast Rosa tuple');

  // Global→SA: derive SA rows + hero from gaR + the real Hero binding.
  const heroSlotId = F.heroC.binding.heroSlotId;
  const heroAsn2 = F.gaR.assignments.find((a) => a.slotId === heroSlotId);
  const slots = w1cSaSlotsFromAssignments(F.gaR, heroSlotId);
  const hero = { heroContractHash: F.REAL_HERO, refSlotId: heroSlotId, personId: heroAsn2.personId, candidateId: heroAsn2.candidateId, sourceAssetId: F.heroC.binding.sourceAssetId };
  const expSel = _w1cSha({ v: 1, storyAuthorityHash: F.REAL_STORY, castManifestHash: F.REAL_CAST, assignmentHash: F.REAL_ASSIGN, hero, slots });
  const sa = buildSelectionAuthorityV1({ storyAuthorityHash: F.REAL_STORY, castManifestHash: F.REAL_CAST, assignmentHash: F.REAL_ASSIGN, hero, slots, expectedSelectionAuthorityHash: expSel, expectedStoryAuthorityHash: F.REAL_STORY, expectedCastManifestHash: F.REAL_CAST, expectedAssignmentHash: F.REAL_ASSIGN, expectedHeroContractHash: F.REAL_HERO });
  assert.equal(sa.ok, true, `SA build from real Cast-derived rows: ${JSON.stringify(sa.reasons)}`);

  // SA hero ↔ Cast/Hero/Global (all identity fields, person_<sha256>).
  assert.equal(sa.selectionAuthority.hero.refSlotId, F.heroC.binding.heroSlotId);
  assert.equal(sa.selectionAuthority.hero.personId, F.lisa.personId);
  assert.equal(sa.selectionAuthority.hero.candidateId, F.lisaCand.candidateId);
  assert.equal(sa.selectionAuthority.hero.sourceAssetId, F.lisaCand.sourceAssetId);
  assert.equal(sa.selectionAuthority.hero.sourceAssetId, F.heroC.binding.sourceAssetId);
  // SA slot set == Global assignment set; every SA slot == its assignment on all 4 fields.
  assert.deepEqual([...sa.selectionAuthority.slots.map((s) => s.refSlotId)].sort(), F.gaR.assignments.map((a) => a.slotId).sort(), 'SA slotIds == Global assignment slotIds');
  for (const a of F.gaR.assignments) {
    const s = sa.selectionAuthority.slots.find((x) => x.refSlotId === a.slotId);
    assert.ok(s, `SA must carry a slot for Global slotId ${a.slotId}`);
    assert.deepEqual({ slotId: s.refSlotId, personId: s.personId, candidateId: s.candidateId, sourceAssetId: s.sourceAssetId }, { slotId: a.slotId, personId: a.personId, candidateId: a.candidateId, sourceAssetId: a.sourceAssetId }, `SA slot ${a.slotId} == Global assignment`);
  }

  // SA→V2: carry the same identities through V2 + pinned activation.
  const realized = { templateId: 'ref_dna', canvasW: 1080, canvasH: 1350, feather: 22, slots: slots.map((s, i) => ({ id: `comp_${s.refSlotId}`, x: 0, y: i * 600, w: 1080, h: 600, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' })) };
  const bind = slots.map((s) => ({ refSlotId: s.refSlotId, composerSlotId: `comp_${s.refSlotId}`, candidateId: s.candidateId, sourceAssetId: s.sourceAssetId, imageUrl: `https://cdn/${s.candidateId}.jpg` }));
  const spec = buildSelectionSpecV2({ selectionAuthority: sa.selectionAuthority, expectedSelectionAuthorityHash: expSel, renderBindings: bind, realizedTemplate: realized, refId: 'HANDSHAKE' });
  assert.equal(spec.ok, true, `V2 build from real Cast-derived rows: ${JSON.stringify(spec.reasons)}`);
  assert.equal(spec.selectionSpec.authority.heroContractHash, F.REAL_HERO);
  assert.equal(spec.selectionSpec.authority.storyAuthorityHash, F.REAL_STORY);
  assert.equal(spec.selectionSpec.authority.castManifestHash, F.REAL_CAST);
  assert.equal(spec.selectionSpec.authority.assignmentHash, F.REAL_ASSIGN);
  assert.equal(spec.selectionSpec.hero.personId, F.lisa.personId);
  assert.equal(spec.selectionSpec.hero.candidateId, F.lisaCand.candidateId);
  assert.equal(spec.selectionSpec.hero.sourceAssetId, F.lisaCand.sourceAssetId);
  assert.deepEqual([...spec.selectionSpec.slots.map((s) => s.refSlotId)].sort(), F.gaR.assignments.map((a) => a.slotId).sort(), 'V2 slotIds == Global assignment slotIds');
  for (const a of F.gaR.assignments) {
    const sl = spec.selectionSpec.slots.find((x) => x.refSlotId === a.slotId);
    assert.ok(sl, `V2 must carry a slot for Global slotId ${a.slotId}`);
    assert.deepEqual({ slotId: sl.refSlotId, personId: sl.primary.personId, candidateId: sl.primary.candidateId, sourceAssetId: sl.primary.sourceAssetId }, { slotId: a.slotId, personId: a.personId, candidateId: a.candidateId, sourceAssetId: a.sourceAssetId }, `V2 slot ${a.slotId} primary == Global assignment`);
  }

  const act = validateSelectionSpecV2Activation({ selectionSpec: spec.selectionSpec, selectionAuthority: sa.selectionAuthority, expectedSelectionAuthorityHash: expSel, expectedSpecHash: spec.selectionSpec.specHash, expectedReplayHash: spec.selectionSpec.replayHash, realizedTemplate: realized });
  assert.equal(act.ok, true, `pinned activation from real Cast-derived rows: ${JSON.stringify(act.reasons)}`);
});

test('W1C #7 handshake NEGATIVE: Cast↔Global disagreement (Global records a DIFFERENT asset for Cast Lisa) ⇒ HOLD', () => {
  const F = w1cHandshakeFoundations();
  const heroSlotId = F.heroC.binding.heroSlotId;
  // Tamper ONLY the Global's recorded sourceAssetId for Lisa's candidate — Cast/Hero authoritatively
  // bind Lisa to F.lisaCand.sourceAssetId, but this Global attributes a contradicting asset.
  const badInput = _w1cGlobalInput({ lisaPersonId: F.lisa.personId, rosaPersonId: F.rosa.personId, lisaCand: { candidateId: F.lisaCand.candidateId, sourceAssetId: 'asset-CONTRADICTS-CAST' }, rosaCand: F.rosaCand });
  const badGa = buildSemanticGlobalAssignment(badInput);
  assert.equal(badGa.decision, 'assigned', `tampered Global still assigns: ${badGa.reason}`);
  const badHeroAsn = badGa.assignments.find((a) => a.slotId === heroSlotId);
  assert.notEqual(badHeroAsn.sourceAssetId, F.heroC.binding.sourceAssetId, 'the tampered asset must differ from Cast/Hero');

  const slots = w1cSaSlotsFromAssignments(badGa, heroSlotId); // hero row asset = 'asset-CONTRADICTS-CAST'
  // Hero tuple uses the Cast/Hero-authoritative asset; the Global-derived row uses the contradicting one.
  const hero = { heroContractHash: F.REAL_HERO, refSlotId: heroSlotId, personId: badHeroAsn.personId, candidateId: badHeroAsn.candidateId, sourceAssetId: F.heroC.binding.sourceAssetId };
  const expSel = _w1cSha({ v: 1, storyAuthorityHash: F.REAL_STORY, castManifestHash: F.REAL_CAST, assignmentHash: badGa.assignmentHash, hero, slots });
  const sa = buildSelectionAuthorityV1({ storyAuthorityHash: F.REAL_STORY, castManifestHash: F.REAL_CAST, assignmentHash: badGa.assignmentHash, hero, slots, expectedSelectionAuthorityHash: expSel, expectedStoryAuthorityHash: F.REAL_STORY, expectedCastManifestHash: F.REAL_CAST, expectedAssignmentHash: badGa.assignmentHash, expectedHeroContractHash: F.REAL_HERO });
  assert.equal(sa.ok, false);
  assert.ok(w1cHas(sa.reasons, 'sa_hero_tuple_mismatch'), `expected sa_hero_tuple_mismatch, got ${JSON.stringify(sa.reasons)}`);
});

// ---- corrective round 2: revoked / throwing-trap Proxies must FAIL CLOSED (never throw) ----
// (Array.isArray throws on a revoked Proxy; the descriptor helpers must guard it.)
function _w1cRevokedObj() { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; }
function _w1cRevokedArr() { const { proxy, revoke } = Proxy.revocable([], {}); revoke(); return proxy; }
function _w1cThrowTrap() { return new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('trap'); }, ownKeys() { throw new Error('trap'); }, getPrototypeOf() { throw new Error('trap'); } }); }
function _w1cNoThrow(fn) { let threw = null, res = null; try { res = fn(); } catch (e) { threw = e; } return { threw, res }; }

test('W1C #6 SA-v1: revoked object/array Proxy (top-level + nested) ⇒ stable HOLD, never throws', () => {
  for (const bad of [_w1cRevokedObj(), _w1cRevokedArr()]) {
    const o = _w1cNoThrow(() => buildSelectionAuthorityV1(bad));
    assert.equal(o.threw, null, 'top-level revoked Proxy must not throw');
    assert.equal(o.res.ok, false); assert.equal(o.res.decision, 'hold');
  }
  const n1 = _w1cNoThrow(() => buildSelectionAuthorityV1(w1cBuildInput({ slots: _w1cRevokedArr() })));
  assert.equal(n1.threw, null); assert.equal(n1.res.ok, false);
  const n2 = _w1cNoThrow(() => buildSelectionAuthorityV1(w1cBuildInput({ hero: _w1cRevokedObj() })));
  assert.equal(n2.threw, null); assert.equal(n2.res.ok, false);
  const slots = _w1cClone(W1C_SLOTS); slots[0] = _w1cRevokedObj();
  const n3 = _w1cNoThrow(() => buildSelectionAuthorityV1(w1cBuildInput({ slots })));
  assert.equal(n3.threw, null); assert.equal(n3.res.ok, false);
  // validator path + determinism
  const env = _w1cClone(w1cAuthority()); env.slots = _w1cRevokedArr();
  assert.equal(_w1cNoThrow(() => validateSelectionAuthorityV1(w1cValidateInput(env))).threw, null);
  assert.equal(JSON.stringify(buildSelectionAuthorityV1(_w1cRevokedObj())), JSON.stringify(buildSelectionAuthorityV1(_w1cRevokedObj())));
});
test('W1C #6 SA-v1: Proxy with THROWING descriptor/ownKeys/getPrototypeOf traps ⇒ stable HOLD, never throws', () => {
  const o = _w1cNoThrow(() => buildSelectionAuthorityV1(_w1cThrowTrap()));
  assert.equal(o.threw, null); assert.equal(o.res.ok, false); assert.equal(o.res.decision, 'hold');
  const slots = _w1cClone(W1C_SLOTS); slots[0] = _w1cThrowTrap();
  const n = _w1cNoThrow(() => buildSelectionAuthorityV1(w1cBuildInput({ slots })));
  assert.equal(n.threw, null); assert.equal(n.res.ok, false);
});
test('W1C #6 SS-v2: revoked / throwing-trap Proxy in build + activation inputs ⇒ stable HOLD, never throws', () => {
  assert.equal(_w1cNoThrow(() => buildSelectionSpecV2(w1cV2Input({ renderBindings: _w1cRevokedArr() }))).threw, null);
  assert.equal(buildSelectionSpecV2(w1cV2Input({ renderBindings: _w1cRevokedArr() })).ok, false);
  assert.equal(_w1cNoThrow(() => buildSelectionSpecV2(w1cV2Input({ realizedTemplate: _w1cRevokedObj() }))).threw, null);
  const b = _w1cClone(W1C_BINDINGS); b[0] = _w1cThrowTrap();
  assert.equal(_w1cNoThrow(() => buildSelectionSpecV2(w1cV2Input({ renderBindings: b }))).threw, null);
  const pins = w1cCleanPins();
  const actIn = (over) => ({ selectionSpec: w1cSpec(), selectionAuthority: w1cAuthority(), expectedSelectionAuthorityHash: W1C_EXPECTED_SEL, expectedSpecHash: pins.expectedSpecHash, expectedReplayHash: pins.expectedReplayHash, realizedTemplate: _w1cClone(W1C_REALIZED), ...over });
  assert.equal(_w1cNoThrow(() => validateSelectionSpecV2Activation(actIn({ selectionSpec: _w1cRevokedObj() }))).threw, null);
  assert.equal(_w1cNoThrow(() => validateSelectionSpecV2Activation(actIn({ realizedTemplate: _w1cRevokedArr() }))).threw, null);
  const spec = _w1cClone(w1cSpec()); spec.slots[0] = _w1cRevokedObj();
  const r = _w1cNoThrow(() => validateSelectionSpecV2Activation(actIn({ selectionSpec: spec })));
  assert.equal(r.threw, null); assert.equal(r.res.ok, false);
});

// ---- corrective round 2: pure SHA-256 == node:crypto across padding & UTF-8 boundaries ----
test('W1C #2: pure SHA-256 matches node:crypto across message-length/padding boundaries', () => {
  // The builder assigns ONLY if its pure digest equals the node:crypto digest of the
  // SAME canonical JSON. Sweeping a clean id's length walks the canonical byte length
  // across every SHA-256 pad/block boundary (55/56/63/64/119/120...).
  for (let n = 1; n <= 130; n++) {
    const rid = 'x'.repeat(n);
    const slots = [{ refSlotId: rid, order: 1, role: 'hero', shape: 'rect', personId: 'p1', candidateId: 'c1', sourceAssetId: 's1' }];
    const hero = { heroContractHash: W1C_HEROHASH, refSlotId: rid, personId: 'p1', candidateId: 'c1', sourceAssetId: 's1' };
    const expSel = _w1cSha({ v: 1, storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN, hero, slots });
    const r = buildSelectionAuthorityV1({ storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN, hero, slots, expectedSelectionAuthorityHash: expSel, expectedStoryAuthorityHash: W1C_STORY, expectedCastManifestHash: W1C_CAST, expectedAssignmentHash: W1C_ASSIGN, expectedHeroContractHash: W1C_HEROHASH });
    assert.equal(r.ok, true, `pure SHA-256 diverged from node:crypto at id length ${n}: ${JSON.stringify(r.reasons)}`);
    assert.equal(r.selectionAuthority.selectionAuthorityHash, expSel);
  }
});
test('W1C #2: pure SHA-256 matches node:crypto for multi-byte UTF-8 ids (2/3/4-byte + surrogate pair)', () => {
  const NON_ASCII = [
    'h' + String.fromCharCode(0xe9) + 'llo',      // é — 2-byte
    String.fromCharCode(0x65e5, 0x672c) + 'go',   // 日本 — 3-byte
    String.fromCodePoint(0x1f4a5) + 'x',          // 💥 — 4-byte surrogate pair
    String.fromCharCode(0x7f - 1) + String.fromCharCode(0xa9), // boundary + ©
  ];
  for (const s of NON_ASCII) {
    const slots = [{ refSlotId: s, order: 1, role: 'hero', shape: 'rect', personId: 'p1', candidateId: s + '-c', sourceAssetId: 's1' }];
    const hero = { heroContractHash: W1C_HEROHASH, refSlotId: s, personId: 'p1', candidateId: s + '-c', sourceAssetId: 's1' };
    const expSel = _w1cSha({ v: 1, storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN, hero, slots });
    const r = buildSelectionAuthorityV1({ storyAuthorityHash: W1C_STORY, castManifestHash: W1C_CAST, assignmentHash: W1C_ASSIGN, hero, slots, expectedSelectionAuthorityHash: expSel, expectedStoryAuthorityHash: W1C_STORY, expectedCastManifestHash: W1C_CAST, expectedAssignmentHash: W1C_ASSIGN, expectedHeroContractHash: W1C_HEROHASH });
    assert.equal(r.ok, true, `pure SHA-256 diverged for UTF-8 id ${JSON.stringify(s)}: ${JSON.stringify(r.reasons)}`);
  }
});
