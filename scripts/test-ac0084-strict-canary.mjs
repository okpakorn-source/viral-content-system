// ============================================================
// 🐤 AC-0084 STRICT quality-gate LIVE canary — HONESTLY-INERT scaffold
// ------------------------------------------------------------
// A SCAFFOLD + a library of PURE gate functions that the fixture test
// (tests/ac0084-quality-gates.test.mjs) imports and exercises.
//
//   • Importing it, `node --check`-ing it, or running it WITHOUT the explicit
//     `run` argv does NOTHING — no POST, no server, no side effects.
//   • The live run fires ONLY via `node scripts/test-ac0084-strict-canary.mjs run`
//     AND a direct-entry guard (import.meta.url === entry). An env var ALONE
//     (e.g. AC0084_CANARY) can NEVER autorun it.
//
// ── GROUNDING (Lane-B re-audit fix) ─────────────────────────────────────────
// Every field name below is derived from the REAL producer, not invented:
//   · POST /api/mega/compose          src/app/api/mega/compose/route.js
//   · composeAndVerify RESPONSE       src/lib/services/megaComposerService.js
//   · SelectionSpec + strict activation  src/lib/refSlotContract.js
//   · realized template shape/id       src/lib/refTemplate.js dnaToTemplateSpec
//   · slotPlan row shape (primary+backup) src/lib/megaAdapters.js
//
// REAL request wire (route.js:19-32 + megaComposerService _strictPrepare:428-517):
//   { newsTitle,
//     slotPlan: [ { url, slot?, refSlotId?, backupForRefSlotId?, isHero?, faces?, clean?, newsScene?, thumbnailUrl? } ],
//     selectionSpec, realizedTemplate, refDNA?, refImagePath? }
//   ‣ slotPlan rows carry NEITHER composerSlotId NOR candidateId — those are the
//     authority's (selectionSpec's). A PRIMARY authority row carries refSlotId; a
//     PRODUCTION BACKUP row carries backupForRefSlotId and is valid WITHOUT being a
//     primary (megaAdapters.js:3193-3194). Every row carries a real url.
//   ‣ _strictPrepare binds an authority slot's primary to the ONE plan row whose
//     url == primary.imageUrl and demands that row's refSlotId == authority refSlotId
//     (megaComposerService.js:476-487). Backup rows never collide (different urls).
//   ‣ selectionSpec uses `v` (must be 1) — NOT `version`. (refSlotContract.js:622)
//
// REAL compose RESPONSE (megaComposerService.js:1840-1934):
//   { success, base64, template /* = realizedTemplate.id == core.spec.id; the real
//       dnaToTemplateSpec id is 'ref_dna' (refTemplate.js:196) */,
//     refSimilarity, qcFlags, placed, crops,
//     manifest: {
//       composerVersion, stableOrder, models,
//       slots: [ { slot, imageUrl, aHash, faceCount, faceBoxes, measured } ], // outer per-slot; NO shape
//       techRules, refImagePath,
//       outputHash,                     // sha1(jpeg) → 40 lowercase hex
//       strictRender: {                 // present ONLY in strict mode
//         verified: true,
//         refId, specHash, replayHash,  // = authority hashes (fnv1a32 → 8 hex)
//         slots: [ { composerSlotId, refSlotId, candidateId, imageUrl } ] // NO person, NO shape
//       } } }
//   ‣ strictRender.slots is emitted from strictCtx.snapshot IN AUTHORITY ORDER
//     (megaComposerService.js:1874) — it is the RAW ORDERED authority. This canary
//     PRESERVES that array EXACTLY (order, count, duplicates) — never Map-collapsed.
//   ‣ manifest.slots[].slot === strictRender.slots[].composerSlotId (both authority
//     order — megaComposerService.js:639-662, 1851-1879). manifest.slots[].imageUrl
//     and strictRender.slots[].imageUrl both come from the same loaded record, so a
//     healthy strict render has them equal per slot (checked as outer_url_drift).
//   ‣ The RESPONSE emits NO `person` and NO `shape`. `person` is operator-curated
//     ONLY (golden.personAuthority); role is derived from the emitted slot id.
//
// Honesty rules baked in after the Lane-B audit (the old design false-passed on
// fabricated fixtures / an impossible 'r6l1a7c2' golden / a lossy fingerprint / a
// Map-collapsed binding join that hid order & duplicates):
//   1. NO fabricated payload. The live wire payload MUST be operator-captured
//      (AC0084_PAYLOAD_FILE/_JSON) and PASS a preflight that mirrors the REAL
//      route+service contract (real selectionSpec validator + template geometry +
//      primary binding). Absent/invalid => HOLD (nonzero exit), never POST.
//   2. NO hand-typed golden authority. specHash/refId/replayHash/outputHash come
//      FROM the live response and are compared to an operator-captured golden
//      (AC0084_GOLDEN_FILE/_JSON). Absent => HOLD.
//   3. NO person inference. The response has no person; adaptLiveResponse carries
//      only the RAW strict bindings (composerSlotId/refSlotId/candidateId/imageUrl)
//      + the outer per-slot url. Person correctness is enforced by a TYPED
//      operator personAuthority per binding (null allowed only for a non-person
//      context slot) whose approvedCandidateId+approvedImageUrl must match the binding.
//   4. FULL authoritative comparison — the A/B determinism + golden checks compare
//      the FULL canonical state (success + outer per-slot url + the RAW ordered
//      strict bindings incl candidateId+imageUrl), never a partial/lossy fingerprint.
//   5. A determinism-only cross-check (two identical POSTs) is NECESSARY but NEVER
//      sufficient — golden authority is enforced on BOTH response A AND response B.
//   6. PURE pre-network golden↔payload consistency (validateGoldenAgainstPayload)
//      catches a contradictory golden BEFORE any POST.
// ============================================================
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// Canonical strict-latch authority (AC-0099 LANE-B). The preflight consumes the SAME
// resolver the real S7 wiring uses so the armed/not-armed decision can never drift, and so
// a mis-set alias (e.g. MEGA_STRICT_RENDERER) surfaces as a named warning instead of silently
// passing. Pure module (no env reads, no IO) — safe to import at top of this scaffold.
import { resolveStrictLatches, STRICT_LATCH_KEYS } from '../src/lib/refSlotContract.js';

// ------------------------------------------------------------
// tiny plain-object / non-blank helpers (FAITHFUL ports of refSlotContract.js:598-605).
// Declared up top so every gate below can use them unambiguously.
// ------------------------------------------------------------
const _srNonblank = (v) => typeof v === 'string' && v.trim().length > 0;
const _srPlain = (v) => {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};
const _str = (v) => (typeof v === 'string' ? v : null);

// ------------------------------------------------------------
// fnv1a32 — FAITHFUL port of refSlotContract.js:784-791 (8 lowercase hex).
// Used to (a) recompute/verify the REAL selectionSpec hashes in preflight and
// (b) let the fixture build a spec whose hashes are the values the producer emits
// (so no hash literal is hand-fabricated). Deterministic; no Date/random.
// ------------------------------------------------------------
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// Stable string hash (FNV-1a 32-bit over an arbitrary string) — convenience for
// logging a one-line render fingerprint. NEVER an authority; the authority is the
// FULL-state deep comparison in sameAuthoritativeState().
export function stableStringHash(str) {
  return fnv1a32(String(str));
}

// The three selectionSpec hashes, reproduced EXACTLY as
//   refSlotContract.js buildSelectionSpec (exact branch, 950-958)
//   == validateStrictRenderActivation recompute (716-725).
// Exported so a fixture spec carries the REAL producer hashes, not literals.
export function computeSelectionSpecHashes(refId, slots) {
  const s = Array.isArray(slots) ? slots : [];
  const identity = s.map((x) => [_str(x?.refSlotId), _str(x?.composerSlotId), _str(x?.primary?.candidateId)]);
  const specHash = fnv1a32(JSON.stringify({ refId: _str(refId), identity }));
  const backupPoolHash = fnv1a32(JSON.stringify(s.map((x) => [_str(x?.refSlotId), (Array.isArray(x?.backups) ? x.backups : []).map((b) => _str(b?.candidateId))])));
  const replayHash = fnv1a32(JSON.stringify({
    refId: _str(refId),
    identity,
    urls: s.map((x) => _str(x?.primary?.imageUrl)),
    backups: s.map((x) => [_str(x?.refSlotId), (Array.isArray(x?.backups) ? x.backups : []).map((b) => [_str(b?.candidateId), _str(b?.imageUrl)])]),
  }));
  return { specHash, backupPoolHash, replayHash };
}

// A real MEGA specHash / replayHash is EXACTLY 8 lowercase hex (fnv1a32 output).
// (The audit flagged the fabricated 'r6l1a7c2' — 'r'/'l' are not hex — as impossible.)
export function specHashIsValid(h) {
  return typeof h === 'string' && /^[0-9a-f]{8}$/.test(h);
}
// outputHash is sha1(jpeg) hex → EXACTLY 40 lowercase hex (megaComposerService.js:1862).
export function outputHashIsValid(h) {
  return typeof h === 'string' && /^[0-9a-f]{40}$/.test(h);
}

// Role derives from the emitted slot id ONLY — the response carries NO shape.
//   /main|hero/ -> hero · id 'circle' (or contains 'circle') -> circle · else support
// (Real ids from dnaToTemplateSpec: hero rect='main', circle='circle', others='{role}_{i}'.)
export function roleOf(slot) {
  const id = String((slot && (slot.slot ?? slot.id ?? slot.composerSlotId)) || '').toLowerCase();
  if (/main|hero/.test(id)) return 'hero';
  if (/circle/.test(id)) return 'circle';
  return 'support';
}

// hero & circle are the person-required roles (a face MUST be an operator-verified
// person). Support/context slots may legitimately be a non-person scene.
export function isPersonRequiredRole(role) {
  return role === 'hero' || role === 'circle';
}

// ------------------------------------------------------------
// Adapt a REAL /api/mega/compose response into the gate's shape.
// CRITICAL (P1-2): the RAW ORDERED strictRender.slots array is preserved EXACTLY —
// same order, same count, full {composerSlotId,refSlotId,candidateId,imageUrl} per
// binding, INCLUDING duplicates. NO Map/projection join that would hide order or
// collapse duplicates.
// CRITICAL (P1-3): the outer manifest.slots[].imageUrl is preserved per slot.
// Does NOT infer correctness or person — correctness is decided later by
// validateAgainstGolden against the operator golden.
//   template       <- out.template                    (= realizedTemplate.id, e.g. 'ref_dna')
//   verified       <- manifest.strictRender.verified  (strict-only; else false)
//   specHash/refId/replayHash <- manifest.strictRender.* (strict-only)
//   outputHash     <- manifest.outputHash             (sha1 of final jpeg)
//   slots[]        <- outer manifest.slots {slot, imageHash<-aHash, imageUrl}
//   strictSlots[]  <- RAW ordered manifest.strictRender.slots (exact)
// Legacy (non-strict) manifests lack strictRender => strictSlots empty + verified
// false + empty specHash, so every authority check fails-closed => HOLD.
// ------------------------------------------------------------
export function adaptLiveResponse(out) {
  const o = out || {};
  const m = o.manifest || {};
  const strict = m.strictRender || null;
  // RAW ordered strict bindings — PRESERVED EXACTLY (order, count, duplicates).
  const strictSlots = (strict && Array.isArray(strict.slots) ? strict.slots : []).map((s) => ({
    composerSlotId: s && s.composerSlotId != null ? String(s.composerSlotId) : '',
    refSlotId: s && s.refSlotId != null ? String(s.refSlotId) : '',
    candidateId: s && s.candidateId != null ? String(s.candidateId) : '',
    imageUrl: s && s.imageUrl != null ? String(s.imageUrl) : '',
  }));
  // outer per-slot list — carries imageUrl (P1-3) + perceptual aHash + slot id.
  const slots = (Array.isArray(m.slots) ? m.slots : []).map((s) => ({
    slot: s && s.slot != null ? String(s.slot) : '',
    imageHash: s && s.aHash != null ? String(s.aHash) : '',
    imageUrl: s && s.imageUrl != null ? String(s.imageUrl) : '',
  }));
  return {
    success: o.success === true,
    template: o.template,
    manifest: {
      templateId: o.template,
      verified: !!(strict && strict.verified === true),
      specHash: strict ? String(strict.specHash || '') : '',
      refId: strict ? String(strict.refId || '') : '',
      replayHash: strict ? String(strict.replayHash || '') : '',
      outputHash: m.outputHash != null ? String(m.outputHash) : '',
      slots,
      strictSlots,
    },
  };
}

// ------------------------------------------------------------
// Structural gates — roles/counts ONLY (identity/person come from the golden).
//   result -> { pass, reasons }
// ------------------------------------------------------------
export function evaluateStructuralGates(adapted) {
  const reasons = [];
  const r = adapted || {};
  if (r.success !== true) reasons.push('not_success');
  const m = r.manifest || null;
  if (!m || typeof m !== 'object') {
    reasons.push('manifest_missing');
    return { pass: false, reasons };
  }
  if (m.verified !== true) reasons.push('strict_not_verified');
  const slots = Array.isArray(m.slots) ? m.slots : [];
  const heroes = slots.filter((s) => roleOf(s) === 'hero');
  const circles = slots.filter((s) => roleOf(s) === 'circle');
  if (heroes.length < 1) reasons.push('hero_missing');
  else if (heroes.length > 1) reasons.push('hero_duplicate');
  if (circles.length < 1) reasons.push('circle_missing');
  else if (circles.length > 1) reasons.push('circle_duplicate'); // symmetric to hero_duplicate — a duplicated circle at the SAME length must HOLD
  return { pass: reasons.length === 0, reasons };
}

// ------------------------------------------------------------
// FULL authoritative canonical state (audit point 4 — NOT lossy). Includes:
//   • success flag                       (P1-3)
//   • every render-authority hash
//   • outer per-slot {slot, imageHash, imageUrl}   (P1-3 outer url)
//   • the RAW ORDERED strict bindings {composerSlotId,refSlotId,candidateId,imageUrl} (P1-2)
// so a determinism drift in ANY of them (incl outer url) is caught A vs B.
// ------------------------------------------------------------
export function canonicalStateOf(adapted) {
  const a = adapted || {};
  const m = a.manifest || {};
  return {
    success: a.success === true,
    templateId: String(m.templateId ?? ''),
    verified: m.verified === true,
    specHash: String(m.specHash ?? ''),
    refId: String(m.refId ?? ''),
    replayHash: String(m.replayHash ?? ''),
    outputHash: String(m.outputHash ?? ''),
    slots: (Array.isArray(m.slots) ? m.slots : []).map((s) => ({
      slot: String(s.slot ?? ''),
      imageHash: String(s.imageHash ?? ''),
      imageUrl: String(s.imageUrl ?? ''),
    })),
    strictSlots: (Array.isArray(m.strictSlots) ? m.strictSlots : []).map((b) => ({
      composerSlotId: String(b.composerSlotId ?? ''),
      refSlotId: String(b.refSlotId ?? ''),
      candidateId: String(b.candidateId ?? ''),
      imageUrl: String(b.imageUrl ?? ''),
    })),
  };
}

// True iff two renders are byte-identical in FULL authoritative state (per audit
// point 4 — NOT a partial fingerprint). Deterministic deep-equality via canonical JSON.
export function sameAuthoritativeState(a, b) {
  return JSON.stringify(canonicalStateOf(a)) === JSON.stringify(canonicalStateOf(b));
}

// ------------------------------------------------------------
// TYPED personAuthority entry (P1-4). An entry is either:
//   • null                       — allowed ONLY for a non-person (support) slot
//   • { status:'operator_verified', subjectKey, displayName,
//       approvedCandidateId, approvedImageUrl }  — required for hero/circle
// The approvedCandidateId + approvedImageUrl MUST match the binding they cover.
//   entry   — the personAuthority value for this slot (null or typed object)
//   binding — { composerSlotId, refSlotId, candidateId, imageUrl } this covers
//   tag     — the composerSlotId (for reason labels)
//   returns — array of reason strings (empty = OK)
// ------------------------------------------------------------
export function validatePersonAuthorityEntry(entry, binding, tag) {
  const reasons = [];
  const id = String(tag ?? (binding && binding.composerSlotId) ?? '');
  const role = roleOf({ slot: (binding && binding.composerSlotId) || id });
  const required = isPersonRequiredRole(role);
  if (entry === null) {
    if (required) reasons.push(`person_authority_required:${id}`); // hero/circle cannot be null
    return reasons; // explicit null is fine for a non-person context slot
  }
  if (!_srPlain(entry)) { reasons.push(`person_authority_not_typed:${id}`); return reasons; }
  if (entry.status !== 'operator_verified') reasons.push(`person_authority_status_invalid:${id}`);
  for (const f of ['subjectKey', 'displayName', 'approvedCandidateId', 'approvedImageUrl']) {
    if (!_srNonblank(entry[f])) reasons.push(`person_authority_field_blank:${id}:${f}`);
  }
  if (binding) {
    if (String(entry.approvedCandidateId) !== String(binding.candidateId)) reasons.push(`person_authority_candidate_mismatch:${id}`);
    if (String(entry.approvedImageUrl) !== String(binding.imageUrl)) reasons.push(`person_authority_image_mismatch:${id}`);
  }
  return reasons;
}

// ------------------------------------------------------------
// GOLDEN integrity — the operator golden must be complete + authoritative BEFORE
// it can judge anything. Shape:
//   golden = {
//     templateId,                 // = realizedTemplate.id the render must reproduce (e.g. 'ref_dna')
//     specHash, refId, replayHash,// real captured authority (8/8 hex + non-blank refId)
//     outputHash,                 // real captured sha1 (40 hex)
//     strictRender: { verified: true },
//     personAuthority: { <composerSlotId>: null | {status,subjectKey,displayName,approvedCandidateId,approvedImageUrl} },
//     bindings: ORDERED [ { composerSlotId, refSlotId, candidateId, imageUrl } ]
//   }
// personAuthority must cover EXACTLY the binding slots (own key present; value typed
// or explicit null), typed for hero/circle, and each typed entry must match its binding.
//   result -> { ok, reasons }
// ------------------------------------------------------------
export function validateGolden(golden) {
  const reasons = [];
  const g = golden || {};
  const bindings = Array.isArray(g.bindings) ? g.bindings : null;
  if (!bindings || bindings.length === 0) {
    reasons.push('golden_bindings_missing');
    return { ok: false, reasons };
  }
  if (typeof g.templateId !== 'string' || !g.templateId.trim()) reasons.push('golden_template_missing');
  if (!specHashIsValid(g.specHash)) reasons.push('golden_spec_hash_invalid');
  if (typeof g.refId !== 'string' || !g.refId.trim()) reasons.push('golden_ref_id_missing');
  if (!specHashIsValid(g.replayHash)) reasons.push('golden_replay_hash_invalid');
  if (!outputHashIsValid(g.outputHash)) reasons.push('golden_output_hash_invalid');
  if (!g.strictRender || g.strictRender.verified !== true) reasons.push('golden_verified_not_true');

  // raw ordered bindings — every field present + non-blank; reject duplicates.
  const seenComposer = new Set();
  const seenRef = new Set();
  const seenCandidate = new Set();
  const seenUrl = new Set();
  const seenWhole = new Set();
  bindings.forEach((b, i) => {
    const at = `bindings[${i}]`;
    if (!b || typeof b !== 'object') { reasons.push(`${at}_not_object`); return; }
    for (const f of ['composerSlotId', 'refSlotId', 'candidateId', 'imageUrl']) {
      if (typeof b[f] !== 'string' || !b[f].trim()) reasons.push(`${at}.${f}_blank`);
    }
    const cs = String(b.composerSlotId);
    const rs = String(b.refSlotId);
    const cand = String(b.candidateId);
    const url = String(b.imageUrl);
    const whole = `${cs}|${rs}|${cand}|${url}`;
    if (seenWhole.has(whole)) reasons.push(`golden_duplicate_binding:${cs}`);
    if (seenComposer.has(cs)) reasons.push(`golden_duplicate_slot:${cs}`);
    if (seenRef.has(rs)) reasons.push(`golden_duplicate_refslot:${cs}`);
    if (seenCandidate.has(cand)) reasons.push(`golden_duplicate_candidate:${cs}`);
    if (seenUrl.has(url)) reasons.push(`golden_duplicate_image:${cs}`);
    seenWhole.add(whole); seenComposer.add(cs); seenRef.add(rs); seenCandidate.add(cand); seenUrl.add(url);
  });

  // personAuthority — TYPED, operator-verified, covering EXACTLY the binding slots.
  const pa = g.personAuthority;
  if (!_srPlain(pa)) {
    reasons.push('person_authority_missing');
  } else {
    const bySlot = new Map(bindings.map((b) => [String(b && b.composerSlotId), b]));
    for (const [id, b] of bySlot) {
      if (!Object.prototype.hasOwnProperty.call(pa, id)) { reasons.push(`person_authority_uncovered:${id}`); continue; }
      for (const r of validatePersonAuthorityEntry(pa[id], b, id)) reasons.push(r);
    }
    for (const k of Object.keys(pa)) {
      if (!bySlot.has(String(k))) reasons.push(`person_authority_extra:${k}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// ------------------------------------------------------------
// PURE pre-network consistency (P2) — validateGoldenAgainstPayload.
// Runs BEFORE any POST. Proves the operator golden is consistent with the
// operator payload authority OFFLINE, so a contradictory golden is caught with no
// network at all: templateId(=realizedTemplate.id) / refId / specHash / replayHash /
// the ORDERED bindings vs selectionSpec.slots[].{composerSlotId,refSlotId,primary}.
//   result -> { ok, reasons }
// ------------------------------------------------------------
export function validateGoldenAgainstPayload(golden, payload) {
  const reasons = [];
  const g = golden || {};
  const p = payload || {};
  const spec = _srPlain(p.selectionSpec) ? p.selectionSpec : {};
  const rt = _srPlain(p.realizedTemplate) ? p.realizedTemplate : {};
  const specSlots = Array.isArray(spec.slots) ? spec.slots : [];

  // golden must itself be authoritative first.
  const gi = validateGolden(g);
  if (!gi.ok) for (const r of gi.reasons) reasons.push(`golden:${r}`);

  if (String(g.templateId ?? '') !== String(rt.id ?? '')) reasons.push('payload_template_mismatch');
  if (String(g.refId ?? '') !== String(spec.refId ?? '')) reasons.push('payload_ref_id_mismatch');
  if (String(g.specHash ?? '') !== String(spec.specHash ?? '')) reasons.push('payload_spec_hash_mismatch');
  if (String(g.replayHash ?? '') !== String(spec.replayHash ?? '')) reasons.push('payload_replay_hash_mismatch');

  const bindings = Array.isArray(g.bindings) ? g.bindings : [];
  if (bindings.length !== specSlots.length) reasons.push('payload_binding_count_mismatch');
  const n = Math.min(bindings.length, specSlots.length);
  for (let i = 0; i < n; i++) {
    const b = bindings[i] || {};
    const s = specSlots[i] || {};
    const prim = _srPlain(s.primary) ? s.primary : {};
    const tag = String(b.composerSlotId ?? i);
    if (String(b.composerSlotId ?? '') !== String(s.composerSlotId ?? '')) reasons.push(`payload_binding_slot_mismatch:${tag}`);
    if (String(b.refSlotId ?? '') !== String(s.refSlotId ?? '')) reasons.push(`payload_binding_refslot_mismatch:${tag}`);
    if (String(b.candidateId ?? '') !== String(prim.candidateId ?? '')) reasons.push(`payload_binding_candidate_mismatch:${tag}`);
    if (String(b.imageUrl ?? '') !== String(prim.imageUrl ?? '')) reasons.push(`payload_binding_image_mismatch:${tag}`);
  }
  return { ok: reasons.length === 0, reasons };
}

// ------------------------------------------------------------
// THE AUTHORITY GATE — validate the live render against the operator golden.
// Enforces (all against the golden, none inferred):
//   • golden is itself valid + authoritative (validateGolden)
//   • the producer verified the strict render (live verified === true) + success
//   • template identity / specHash(real 8-hex) / refId / replayHash / outputHash == golden
//   • RAW ORDERED strict bindings: EXACT count + order + every field vs golden.bindings,
//     and NO duplicate composerSlotId / refSlotId / candidateId / imageUrl in the live array
//   • outer manifest.slots correspond 1:1 to the bindings — no rogue / DUPLICATE /
//     MISSING slot (outer_slot_unexpected / outer_slot_duplicate / outer_slot_missing),
//     never Map-collapsed — and each outer url agrees with its strict binding url
//     (outer_url_drift)
//   • cross-slot candidate AND image DISTINCTNESS (no reused photo/candidate)
//   • every rendered slot is covered by the TYPED operator personAuthority
// result -> { pass, reasons }.
// ------------------------------------------------------------
export function validateAgainstGolden(adapted, golden) {
  const reasons = [];
  const g = golden || {};

  // 0) golden must be complete + authoritative, else HOLD (never a lossy pass).
  const gi = validateGolden(g);
  if (!gi.ok) return { pass: false, reasons: gi.reasons };

  const a = adapted || {};
  const m = a.manifest || {};
  const outerSlots = Array.isArray(m.slots) ? m.slots : [];
  const rawStrict = Array.isArray(m.strictSlots) ? m.strictSlots : [];
  const curated = Array.isArray(g.bindings) ? g.bindings : [];

  // 1) the producer must have succeeded AND verified the strict render.
  if (a.success !== true) reasons.push('not_success');
  if (m.verified !== true) reasons.push('strict_not_verified');

  // 2) identity / render authority (real values FROM the response vs golden).
  if (String(m.templateId) !== String(g.templateId)) reasons.push('template_mismatch');
  if (!specHashIsValid(m.specHash)) reasons.push('spec_hash_invalid');
  else if (String(m.specHash) !== String(g.specHash)) reasons.push('spec_hash_mismatch');
  if (String(m.refId) !== String(g.refId)) reasons.push('ref_id_mismatch');
  if (String(m.replayHash) !== String(g.replayHash)) reasons.push('replay_hash_mismatch');
  if (String(m.outputHash) !== String(g.outputHash)) reasons.push('output_hash_mismatch');

  // 3) RAW ordered strict bindings — exact count vs golden + reject in-array duplicates.
  if (rawStrict.length !== curated.length) reasons.push('binding_count_mismatch');
  const seenComposer = new Set();
  const seenRef = new Set();
  const seenCand0 = new Set();
  const seenUrl0 = new Set();
  rawStrict.forEach((b) => {
    const cs = String(b.composerSlotId);
    if (seenComposer.has(cs)) reasons.push(`live_duplicate_slot:${cs}`);
    if (seenRef.has(String(b.refSlotId))) reasons.push(`live_duplicate_refslot:${cs}`);
    if (seenCand0.has(String(b.candidateId))) reasons.push(`live_duplicate_candidate:${cs}`);
    if (seenUrl0.has(String(b.imageUrl))) reasons.push(`live_duplicate_image:${cs}`);
    seenComposer.add(cs); seenRef.add(String(b.refSlotId)); seenCand0.add(String(b.candidateId)); seenUrl0.add(String(b.imageUrl));
  });

  // 4) outer manifest.slots must be ONE-TO-ONE with the curated bindings — no rogue,
  //    no DUPLICATE, no MISSING slot. (P1 re-audit fix: the old code built an
  //    OVERWRITING Map keyed by slot id, so at the SAME length a duplicated outer slot
  //    silently clobbered its twin and a missing slot went undetected — a false-PASS.)
  //    Iterate IN ORDER with a seenOuter set; reject a repeat with outer_slot_duplicate.
  //    NEVER Map-collapse the identity check. (outerUrlBySlot keeps ONLY the first
  //    occurrence's url — the surviving outer_url_drift check below.)
  if (outerSlots.length !== curated.length) reasons.push('outer_slot_count_mismatch');
  const curatedIds = new Set(curated.map((c) => String(c && c.composerSlotId)));
  const outerUrlBySlot = new Map();
  const seenOuter = new Set();
  for (const s of outerSlots) {
    const sid = String(s.slot);
    if (seenOuter.has(sid)) { reasons.push(`outer_slot_duplicate:${sid}`); continue; }
    seenOuter.add(sid);
    outerUrlBySlot.set(sid, String(s.imageUrl ?? ''));
    if (!curatedIds.has(sid)) reasons.push(`outer_slot_unexpected:${sid}`);
  }
  // AFTER the loop: EVERY curated binding id must appear EXACTLY once in the outer slots.
  for (const c of curated) {
    const cid = String(c && c.composerSlotId);
    if (!seenOuter.has(cid)) reasons.push(`outer_slot_missing:${cid}`);
  }

  // 5) exact ORDERED bindings + full fields + outer-url agreement + person cover + distinctness.
  const pa = _srPlain(g.personAuthority) ? g.personAuthority : {};
  const n = Math.min(rawStrict.length, curated.length);
  const seenCand = new Set();
  const seenUrl = new Set();
  for (let i = 0; i < n; i++) {
    const b = rawStrict[i];
    const exp = curated[i];
    const tag = String(exp.composerSlotId);
    // order drift: the ith RAW strict binding id must equal the ith golden binding.
    if (String(b.composerSlotId) !== String(exp.composerSlotId)) { reasons.push(`binding_slot_mismatch:${tag}`); continue; }
    if (roleOf({ slot: b.composerSlotId }) !== roleOf({ slot: exp.composerSlotId })) reasons.push(`binding_role_mismatch:${tag}`);
    if (String(b.refSlotId) !== String(exp.refSlotId)) reasons.push(`binding_refslot_mismatch:${tag}`);
    if (String(b.candidateId) !== String(exp.candidateId)) reasons.push(`binding_candidate_mismatch:${tag}`);
    if (String(b.imageUrl) !== String(exp.imageUrl)) reasons.push(`binding_image_mismatch:${tag}`);
    // outer per-slot url must agree with the strict binding url (P1-3 outer-url drift).
    if (outerUrlBySlot.has(tag) && outerUrlBySlot.get(tag) !== String(b.imageUrl)) reasons.push(`outer_url_drift:${tag}`);
    // TYPED person authority per binding (P1-4) — against the LIVE binding.
    for (const r of validatePersonAuthorityEntry(pa[tag], b, tag)) reasons.push(r);
    // cross-slot candidate AND image distinctness (no photo reused across slots).
    if (seenCand.has(String(b.candidateId))) reasons.push(`candidate_reused:${tag}`);
    if (seenUrl.has(String(b.imageUrl))) reasons.push(`image_reused:${tag}`);
    seenCand.add(String(b.candidateId));
    seenUrl.add(String(b.imageUrl));
  }
  return { pass: reasons.length === 0, reasons };
}

// ------------------------------------------------------------
// validateSelectionSpecActivation — FAITHFUL port of
// refSlotContract.js validateStrictRenderActivation (607-777). Pure; no IO/env.
// Returns { decision, active, failClosed, reasons, authority? } exactly like the
// real function so the preflight accepts EXACTLY the payloads the real route does.
// ------------------------------------------------------------
export function validateSelectionSpecActivation(input = {}) {
  const hasOwnSpec = input != null && (typeof input === 'object' || typeof input === 'function')
    && Object.prototype.hasOwnProperty.call(input, 'selectionSpec');
  if (!hasOwnSpec) return { decision: 'legacy_absent', active: false, failClosed: false, reasons: [] };
  if (!_srPlain(input)) return { decision: 'reject_invalid', active: false, failClosed: true, reasons: ['input_not_plain_object'] };
  const spec = input.selectionSpec;
  if (!_srPlain(spec)) return { decision: 'reject_invalid', active: false, failClosed: true, reasons: ['spec_not_plain_object'] };

  const reasons = [];
  if (spec.v !== 1) reasons.push('bad_version');
  if (spec.mode !== 'ref_slot_exact') reasons.push('bad_mode');
  if (spec.source !== 'template.slots') reasons.push('bad_source');
  if (!_srNonblank(spec.refId)) reasons.push('missing_ref_id');
  if (spec.authorityStale === true) reasons.push('authority_stale');
  else if (spec.authorityStale !== undefined && spec.authorityStale !== false) reasons.push('authority_stale_invalid');
  if (spec.strictReady !== true) reasons.push('strict_ready_false');

  const slots = Array.isArray(spec.slots) ? spec.slots : null;
  if (!slots || slots.length < 3) {
    reasons.push('too_few_slots');
    return { decision: 'reject_invalid', active: false, failClosed: true, reasons };
  }

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!_srPlain(s)) { reasons.push(`slot_not_object:${i}`); continue; }
    if (s.mappingMode !== 'ref_slot_exact') reasons.push(`slot_mapping_mode:${i}`);
    if (!_srNonblank(s.refSlotId)) reasons.push(`slot_ref_id_blank:${i}`);
    if (!_srNonblank(s.composerSlotId)) reasons.push(`slot_composer_id_blank:${i}`);
    const p = s.primary;
    if (!_srPlain(p) || !_srNonblank(p.candidateId) || !_srNonblank(p.imageUrl)) reasons.push(`primary_invalid:${i}`);
    if (s.shape !== 'rect' && s.shape !== 'circle') reasons.push(`slot_shape_invalid:${i}`);
  }

  const refIds = slots.map((s) => s?.refSlotId).filter(_srNonblank);
  const compIds = slots.map((s) => s?.composerSlotId).filter(_srNonblank);
  const primIds = slots.map((s) => s?.primary?.candidateId).filter(_srNonblank);
  const primUrls = slots.map((s) => s?.primary?.imageUrl).filter(_srNonblank);
  if (new Set(refIds).size !== refIds.length) reasons.push('dup_ref_slot_id');
  if (new Set(compIds).size !== compIds.length) reasons.push('dup_composer_slot_id');
  if (new Set(primIds).size !== primIds.length) reasons.push('dup_primary_candidate');
  if (new Set(primUrls).size !== primUrls.length) reasons.push('dup_primary_url');

  const c = _srPlain(spec.counts) ? spec.counts : {};
  const expectCounts = { total: slots.length, mapped: slots.length, unmapped: 0, missingPrimary: 0, duplicatePrimary: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 };
  for (const k of Object.keys(expectCounts)) if (c[k] !== expectCounts[k]) reasons.push(`counts_mismatch:${k}`);

  const d = spec.diagnostics;
  if (!_srPlain(d)) {
    reasons.push('diagnostics_not_object');
  } else {
    for (const f of ['extraPlannedKeys', 'invalidPrimary', 'aliasPrimaryUrls', 'duplicateBackupsDropped']) {
      if (!Array.isArray(d[f])) reasons.push(`diagnostics_malformed:${f}`);
    }
    if (Array.isArray(d.extraPlannedKeys) && d.extraPlannedKeys.length > 0) reasons.push('diagnostics_blocking:extraPlannedKeys');
    if (Array.isArray(d.invalidPrimary) && d.invalidPrimary.length > 0) reasons.push('diagnostics_blocking:invalidPrimary');
    if (Array.isArray(d.aliasPrimaryUrls) && d.aliasPrimaryUrls.length > 0) reasons.push('diagnostics_blocking:aliasPrimaryUrls');
    if (d.missingRefId === true) reasons.push('diagnostics_blocking:missingRefId');
    else if (d.missingRefId !== undefined && d.missingRefId !== false) reasons.push('diagnostics_malformed:missingRefId');
  }

  const primIdSet = new Set(primIds);
  const primUrlSet = new Set(primUrls);
  const bkIds = new Set();
  const bkUrls = new Set();
  for (let i = 0; i < slots.length; i++) {
    const bks = slots[i]?.backups;
    if (!Array.isArray(bks)) { reasons.push(`backups_not_array:${i}`); continue; }
    for (const b of bks) {
      if (!_srPlain(b) || !_srNonblank(b.candidateId) || !_srNonblank(b.imageUrl)) { reasons.push(`backup_invalid:${i}`); continue; }
      if (primIdSet.has(b.candidateId) || primUrlSet.has(b.imageUrl)) { reasons.push(`backup_collides_primary:${i}`); continue; }
      if (bkIds.has(b.candidateId) || bkUrls.has(b.imageUrl)) { reasons.push(`backup_dup_across_owners:${i}`); continue; }
      bkIds.add(b.candidateId);
      bkUrls.add(b.imageUrl);
    }
  }

  const { specHash: wantSpecHash, backupPoolHash: wantBackupPoolHash, replayHash: wantReplayHash } =
    computeSelectionSpecHashes(spec.refId, slots);
  if (spec.specHash !== wantSpecHash) reasons.push('spec_hash_mismatch');
  if (spec.backupPoolHash !== wantBackupPoolHash) reasons.push('backup_pool_hash_mismatch');
  if (spec.replayHash !== wantReplayHash) reasons.push('replay_hash_mismatch');

  const rt = input.realizedTemplate;
  const rtSlots = _srPlain(rt) && Array.isArray(rt.slots) ? rt.slots : null;
  if (!rtSlots) {
    reasons.push('realized_missing');
  } else {
    const rtIds = rtSlots.map((s) => (s && s.id != null ? String(s.id) : ''));
    if (!rtIds.every(_srNonblank)) reasons.push('realized_ids_invalid');
    else if (new Set(rtIds).size !== rtIds.length) reasons.push('realized_ids_duplicate');
    else {
      const want = new Set(compIds);
      const got = new Set(rtIds);
      const sameAll = want.size === got.size && compIds.length === rtIds.length && [...want].every((id) => got.has(id));
      if (!sameAll) reasons.push('realized_set_mismatch');
      const rtShapeById = new Map(rtSlots.map((r) => [String(r?.id ?? ''), r?.shape === 'circle' ? 'circle' : 'rect']));
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const cid = s?.composerSlotId;
        if (!_srNonblank(cid) || (s?.shape !== 'rect' && s?.shape !== 'circle')) continue;
        const wantShape = rtShapeById.get(cid);
        if (wantShape !== undefined && s.shape !== wantShape) reasons.push(`shape_mismatch:${i}`);
      }
    }
  }

  if (reasons.length) return { decision: 'reject_invalid', active: false, failClosed: true, reasons };

  const authority = JSON.parse(JSON.stringify({
    refId: spec.refId,
    specHash: spec.specHash,
    backupPoolHash: spec.backupPoolHash,
    replayHash: spec.replayHash,
    slots: slots.map((s) => ({
      refSlotId: s.refSlotId,
      composerSlotId: s.composerSlotId,
      shape: s.shape ?? null,
      primary: { candidateId: s.primary.candidateId, imageUrl: s.primary.imageUrl },
      backups: (Array.isArray(s.backups) ? s.backups : []).map((b) => ({ candidateId: b.candidateId, imageUrl: b.imageUrl })),
    })),
  }));
  return { decision: 'strict_ready', active: true, failClosed: false, reasons: [], authority };
}

// ------------------------------------------------------------
// PREFLIGHT — assert the operator-captured wire payload satisfies the FULL strict
// contract the REAL route+service would accept, BEFORE any POST. Mirrors:
//   · route.js body shape (newsTitle + slotPlan + selectionSpec + realizedTemplate)
//   · _strictPrepare template geometry (canvas 1080×1350, integer in-canvas slots)
//   · _strictPrepare primary binding (plan.url == authority primary.imageUrl,
//     row.refSlotId == authority refSlotId)
//   · validateStrictRenderActivation on { selectionSpec, realizedTemplate }
// A stub ({refId,version} spec, {id}-only template, example.invalid urls) MUST fail.
// result -> { ok, reasons }.
// ------------------------------------------------------------
const PLACEHOLDER_HOSTS = new Set([
  '', 'example.invalid', 'example.com', 'example.org', 'example.net',
  'localhost', '127.0.0.1', '::1',
]);

export function assertStrictPayloadContract(payload, env = (typeof process !== 'undefined' ? process.env : {})) {
  const reasons = [];
  const p = payload || {};

  // full news content required (project rule: cover tests use full news body, no stub).
  if (typeof p.newsTitle !== 'string' || p.newsTitle.trim().length < 10) reasons.push('newsTitle_missing_or_short');

  // slotPlan rows (P1-1): a real url is required on ALL rows. A PRIMARY authority row
  //   carries a non-blank refSlotId; a PRODUCTION BACKUP row carries backupForRefSlotId
  //   instead (valid WITHOUT being a primary — megaAdapters.js:3193-3194). A row that
  //   declares NEITHER cannot be placed => role_unresolved. (composerSlotId/candidateId
  //   are the selectionSpec's, NOT the plan's.) Coverage (one primary row per authority
  //   slot) is enforced below by the primary-binding step, mirroring _strictPrepare.
  const slotPlan = Array.isArray(p.slotPlan) ? p.slotPlan : null;
  if (!slotPlan || slotPlan.length === 0) reasons.push('slotPlan_missing');
  else {
    slotPlan.forEach((s, i) => {
      const at = `slotPlan[${i}]`;
      if (!s || typeof s !== 'object') { reasons.push(`${at}_not_object`); return; }
      let host = null;
      try { host = new URL(String(s.url)).hostname.toLowerCase(); } catch { /* invalid url */ }
      if (host == null) reasons.push(`${at}.url_invalid`);
      else if (PLACEHOLDER_HOSTS.has(host)) reasons.push(`${at}.url_placeholder`);
      const hasRef = typeof s.refSlotId === 'string' && s.refSlotId.trim().length > 0;
      const hasBackupFor = typeof s.backupForRefSlotId === 'string' && s.backupForRefSlotId.trim().length > 0;
      if (!hasRef && !hasBackupFor) reasons.push(`${at}.role_unresolved`); // neither a primary nor a backup row
    });
  }

  // selectionSpec + realizedTemplate — the REAL strict authority (runs the actual validator).
  const activation = validateSelectionSpecActivation({ selectionSpec: p.selectionSpec, realizedTemplate: p.realizedTemplate });
  if (activation.decision !== 'strict_ready') {
    reasons.push('selectionSpec_not_strict_ready');
    for (const r of activation.reasons) reasons.push(`spec:${r}`);
  }

  // realizedTemplate geometry — _strictPrepare STRICT_TEMPLATE_INVALID checks (canvas
  // fixed 1080×1350; every slot integer, positive, inside the canvas; unique ids).
  const rt = p.realizedTemplate;
  if (!_srPlain(rt)) reasons.push('realizedTemplate_missing');
  else {
    const W = rt.canvasW, H = rt.canvasH;
    if (!(W === 1080 && H === 1350)) reasons.push('realizedTemplate.canvas_invalid');
    const tSlots = Array.isArray(rt.slots) ? rt.slots : [];
    if (!tSlots.length) reasons.push('realizedTemplate.slots_empty');
    const ids = new Set();
    const _numOk = (v) => typeof v === 'number' && Number.isFinite(v);
    tSlots.forEach((s, i) => {
      const o = s || {};
      const id = String(o.id ?? '');
      if (!id.trim()) reasons.push(`realizedTemplate.slot_id_blank:${i}`);
      else if (ids.has(id)) reasons.push(`realizedTemplate.slot_id_duplicate:${id}`);
      ids.add(id);
      const { x, y, w, h } = o;
      if (![x, y, w, h].every(_numOk)) { reasons.push(`realizedTemplate.slot_geometry_not_finite:${id || i}`); return; }
      if (![x, y, w, h].every(Number.isInteger)) reasons.push(`realizedTemplate.slot_geometry_not_integer:${id || i}`);
      if (!(w > 0 && h > 0)) reasons.push(`realizedTemplate.slot_size_not_positive:${id || i}`);
      if (x < 0 || y < 0 || (typeof W === 'number' && x + w > W) || (typeof H === 'number' && y + h > H)) reasons.push(`realizedTemplate.slot_out_of_canvas:${id || i}`);
      if (o.shape != null && o.shape !== 'circle' && o.shape !== 'rect') reasons.push(`realizedTemplate.slot_shape_unknown:${id || i}`);
    });
  }

  // primary binding — every authority slot's primary.imageUrl must match EXACTLY ONE
  // plan row whose refSlotId equals the authority refSlotId (STRICT_PRIMARY_UNAVAILABLE).
  if (activation.decision === 'strict_ready' && Array.isArray(slotPlan)) {
    for (const a of activation.authority.slots) {
      const matches = slotPlan.filter((row) => String(row?.url || '') === a.primary.imageUrl);
      if (matches.length === 0) { reasons.push(`primary_missing:${a.composerSlotId}`); continue; }
      if (matches.length > 1) { reasons.push(`primary_duplicate_in_plan:${a.composerSlotId}`); continue; }
      const mRef = matches[0].refSlotId == null ? '' : String(matches[0].refSlotId).trim();
      if (!mRef || mRef !== a.refSlotId) reasons.push(`primary_ref_mismatch:${a.composerSlotId}`);
    }
  }

  // strict pipeline must be armed, else the manifest lacks strictRender/specHash identity.
  // Delegate the arm decision to the canonical resolver (single source of truth) — armedRenderer
  // is MEGA_STRICT_RENDER === '1' EXACTLY, identical to the historical inline check, so the
  // 'MEGA_STRICT_RENDER_not_armed' message/behavior is preserved byte-for-byte.
  const latches = resolveStrictLatches(env);
  if (!latches.armedRenderer) reasons.push('MEGA_STRICT_RENDER_not_armed');

  // Strict-like aliases (e.g. the typo'd MEGA_STRICT_RENDERER) never arm — surface them as a
  // NAMED WARNING so a mis-set latch is loud. Warnings do NOT flip ok; a not-armed env still HOLDs.
  const warnings = [];
  for (const k of latches.unknownStrictLikeKeys) warnings.push(`strict_like_alias_ignored:${k}`);

  return { ok: reasons.length === 0, reasons, warnings, unknownStrictLikeKeys: latches.unknownStrictLikeKeys };
}

// ------------------------------------------------------------
// Operator input loading (JSON file or inline JSON env). Absent => HoldError.
// ------------------------------------------------------------
export class HoldError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HoldError';
    this.isHold = true;
  }
}

function loadJsonSource(fileEnv, jsonEnv, label) {
  const env = typeof process !== 'undefined' ? process.env : {};
  const file = env[fileEnv];
  const inline = env[jsonEnv];
  if (file) {
    let raw;
    try { raw = readFileSync(file, 'utf8'); }
    catch (e) { throw new HoldError(`${label}: cannot read ${fileEnv}=${file}: ${e.message}`); }
    try { return JSON.parse(raw); }
    catch (e) { throw new HoldError(`${label}: ${fileEnv} is not valid JSON: ${e.message}`); }
  }
  if (inline) {
    try { return JSON.parse(inline); }
    catch (e) { throw new HoldError(`${label}: ${jsonEnv} is not valid JSON: ${e.message}`); }
  }
  return null;
}

export function loadOperatorPayload() {
  const p = loadJsonSource('AC0084_PAYLOAD_FILE', 'AC0084_PAYLOAD_JSON', 'operator payload');
  if (!p) {
    throw new HoldError(
      'HOLD: no operator-captured payload. Set AC0084_PAYLOAD_FILE (path) or AC0084_PAYLOAD_JSON ' +
      'to a producer-captured FULL /api/mega/compose wire payload for AC-0084 ' +
      '(newsTitle + slotPlan[url + refSlotId|backupForRefSlotId] + a real SelectionSpec v1 + realizedTemplate). ' +
      'Refusing to POST fabricated / example.invalid data.'
    );
  }
  return p;
}

export function loadOperatorGolden() {
  const g = loadJsonSource('AC0084_GOLDEN_FILE', 'AC0084_GOLDEN_JSON', 'operator golden');
  if (!g) {
    throw new HoldError(
      'HOLD: no operator golden. Set AC0084_GOLDEN_FILE (path) or AC0084_GOLDEN_JSON with the ' +
      'curated { templateId, specHash, refId, replayHash, outputHash, strictRender:{verified:true}, ' +
      'personAuthority, bindings[] } captured from an APPROVED live render (specHash/replayHash are ' +
      '8 lowercase hex; outputHash is 40 hex; bindings give the exact ORDERED composerSlotId→ ' +
      'candidateId+imageUrl; personAuthority is TYPED per slot — null only for a non-person slot). ' +
      'A determinism-only cross-check is NOT a pass.'
    );
  }
  return g;
}

// ------------------------------------------------------------
// Live POST plumbing (used ONLY inside main()).
// ------------------------------------------------------------
const ENDPOINT = (typeof process !== 'undefined' && process.env.AC0084_ENDPOINT) || 'http://localhost:3900/api/mega/compose';

async function postCompose(payload) {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  return { status: resp.status, json };
}

// ------------------------------------------------------------
// LIVE run — HOLDs (no POST) unless operator payload + golden are present, the
// preflight strict contract passes, AND the golden is consistent with the payload
// (PURE, pre-network). PASS requires golden authority on BOTH response A AND B;
// determinism (full-state A==B) is a supporting necessary check, never sufficient.
// ------------------------------------------------------------
export async function main() {
  // 1) operator payload — absent => HOLD, no POST.
  const payload = loadOperatorPayload();

  // 2) preflight strict contract (mirrors the real route+service) — invalid => HOLD, no POST.
  const pf = assertStrictPayloadContract(payload);
  if (!pf.ok) throw new HoldError(`HOLD: payload failed strict preflight contract: ${pf.reasons.join(', ')}`);

  // 3) operator golden — absent/invalid => HOLD, no POST.
  const golden = loadOperatorGolden();
  const gi = validateGolden(golden);
  if (!gi.ok) throw new HoldError(`HOLD: operator golden is not authoritative: ${gi.reasons.join(', ')}`);

  // 4) PURE pre-network golden↔payload consistency (P2) — contradictory golden => HOLD, no POST.
  const gp = validateGoldenAgainstPayload(golden, payload);
  if (!gp.ok) throw new HoldError(`HOLD: golden contradicts the operator payload (pre-network): ${gp.reasons.join(', ')}`);

  console.log(`[ac0084-canary] preflight + golden↔payload OK · POST ${ENDPOINT} x2 (determinism cross-check)`);
  const a = await postCompose(payload);
  const b = await postCompose(payload);

  const adaptedA = adaptLiveResponse(a.json);
  const adaptedB = adaptLiveResponse(b.json);

  // 5) BOTH structural AND golden authority on BOTH responses (P1-3) — either fails => HOLD.
  for (const [label, adapted] of [['A', adaptedA], ['B', adaptedB]]) {
    const structural = evaluateStructuralGates(adapted);
    if (!structural.pass) throw new HoldError(`HOLD: structural gates failed on response ${label}: ${structural.reasons.join(', ')}`);
    const curated = validateAgainstGolden(adapted, golden);
    if (!curated.pass) throw new HoldError(`HOLD: golden authority validation failed on response ${label}: ${curated.reasons.join(', ')}`);
  }

  // 6) determinism cross-check — FULL authoritative state (NOT a lossy fingerprint).
  //    NECESSARY but NOT sufficient (golden already enforced on A and B above).
  if (!sameAuthoritativeState(adaptedA, adaptedB)) {
    throw new HoldError('HOLD: non-deterministic render across identical POSTs (full authoritative state drifted)');
  }

  const fp = stableStringHash(JSON.stringify(canonicalStateOf(adaptedA)));
  console.log(`[ac0084-canary] specHash=${adaptedA.manifest.specHash} refId=${adaptedA.manifest.refId} replayHash=${adaptedA.manifest.replayHash} outputHash=${adaptedA.manifest.outputHash}`);
  console.log(`[ac0084-canary] full-state fingerprint: ${fp}`);
  console.log('[ac0084-canary] ✅ PASS — golden matched on A+B, bindings exact + distinct, deterministic (full state).');
}

// ------------------------------------------------------------
// TRIGGER — live fires ONLY on explicit `run` argv AND direct entry.
// An env var ALONE must NEVER autorun. Exported pure so the fixture test can prove it.
// ------------------------------------------------------------
export function shouldRunLive(argv, importMetaUrl) {
  if (!Array.isArray(argv)) return false;
  if (argv[2] !== 'run') return false; // must pass the explicit `run` subcommand
  let entryHref;
  try { entryHref = pathToFileURL(String(argv[1] || '')).href; } catch { return false; }
  return importMetaUrl === entryHref; // direct entry only (not imported)
}

if (shouldRunLive(typeof process !== 'undefined' ? process.argv : [], import.meta.url)) {
  main().catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    // HoldError messages already carry a "HOLD:" prefix; only tag non-hold failures.
    console.error(`[ac0084-canary] ❌ ${err && err.isHold ? msg : `ERROR: ${msg}`}`);
    process.exitCode = err && err.isHold ? 2 : 1;
  });
}
// else: inert — import, `node --check`, `node file` without "run", or env-only. No POST, no server.
