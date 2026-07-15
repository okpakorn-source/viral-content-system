// ============================================================
// tests/candidate-crop-readiness.test.mjs
// ------------------------------------------------------------
// Verifies the INDEPENDENT_READINESS_V1 producer AND the Codex-audit hardening:
//   • (P0-1) exact universe-proof schema → measurementReady / feed:null; no empty pool → COMPLETE
//   • (P0-2) NO ownKeys enumeration of an untrusted / Proxy array (trap NEVER invoked)
//   • (P1-1) truncated must be LITERAL false
//   • (P1-2/P1-POS) POSITIONAL crop honesty: real centre-gravity cover-fit crop window,
//     subject box mapped at its ACTUAL position (rect containment on position + inscribed-
//     circle 4-corner mask; centered SAFE / corner NEVER-SAFE / tangent-boundary /
//     off-center / crop-shifted-window / non-square-circle regressions; NO best-case
//     centering anywhere; missing/invalid position ⇒ UNEVALUATED)
//   • (P1-3) subjectBox present-but-invalid ≠ absent (no faceBox fallback); invalid box/elig → UNEVALUATED
//   • (P1-4) trusted pre-clustered bucket (provenance+version); raw-only → uniqueness UNMEASURED
//   • (P1-5) universe completeness binds scope + counts
//   • (P2-1) slotId canonical NON-EMPTY string (numeric 1 ≠ string '1')
//   • (P2-2) raw ids / slotIds never leak into DURABLE output
// plus the preserved contracts: geometryId parity, measuredFrom==='full' only, upscale
// math, highRes coarse gate, token privacy, determinism, detachment, deep-freeze, caps,
// and the ephemeral feed PLUGGING INTO the seeded E-pass buildSearchQualityDescriptor.
// Pure, deterministic, offline, node:test + node:assert/strict.
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateCropReadiness,
  deriveGeometryId,
  CELL_VERDICT,
  REASON,
  PRODUCER,
  RENDERER_PARITY,
  LIMITS,
  UNIVERSE_SCOPE,
  PRECLUSTER,
} from '../src/lib/candidateCropReadiness.js';

import {
  buildSearchQualityDescriptor,
  deriveGeometryId as eDeriveGeometryId,
} from '../src/lib/searchQualityMeasurement.js';

// ---------- fixtures (grounded geometry inside the 1080×1350 canvas) ----------

const HERO_SLOT = { slotId: 'main', role: 'hero', shape: 'rect', x: 0, y: 0, w: 648, h: 1080 };
const CIRCLE_SLOT = { slotId: 'circ', role: 'circle', shape: 'circle', x: 700, y: 100, w: 300, h: 300 };
const SUPPORT_SLOT = { slotId: 'ev', role: 'support', shape: 'rect', x: 700, y: 450, w: 300, h: 400 };

// (P1-4) trusted pre-clustered near-dup bucket descriptor.
function cluster(bucketId) {
  return { bucketId, provenance: PRECLUSTER.PROVENANCE, version: PRECLUSTER.VERSION };
}

// A candidate that is SAFE for the hero slot (downscale, contained, short side ≥ 700).
function heroSafeCand(identity = 'A', bucket = 'pa') {
  return {
    fullWidth: 1200, fullHeight: 1600, measuredFrom: 'full',
    subjectBox: { x1: 0.3, y1: 0.1, x2: 0.6, y2: 0.7 },
    identity, pHashCluster: cluster(bucket), highRes: true,
    eligibility: { main: true },
  };
}
function circleSafeCand(identity = 'B', bucket = 'pb') {
  return {
    fullWidth: 800, fullHeight: 800, measuredFrom: 'full',
    subjectBox: { x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 },
    identity, pHashCluster: cluster(bucket), highRes: true,
    eligibility: { circ: true },
  };
}
function supportSafeCand(identity = 'C', bucket = 'pc') {
  return {
    fullWidth: 900, fullHeight: 1200, measuredFrom: 'full',
    subjectBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.8 },
    identity, pHashCluster: cluster(bucket), highRes: true,
    eligibility: { ev: true },
  };
}

// Count the OBSERVED candidate universe exactly as the producer does: Σ over the
// template-demanded roles of the present candidate-array lengths (absent/empty = 0).
function observedCountOf(req) {
  const demanded = new Set((req.slots || []).map((s) => s && s.role));
  let n = 0;
  for (const role of demanded) {
    const pool = req.roles && req.roles[role] && req.roles[role].candidates;
    if (Array.isArray(pool)) n += pool.length;
  }
  return n;
}
// Inject a VALID, count-bound universe proof.
function proofFor(req) {
  const n = observedCountOf(req);
  return { scope: UNIVERSE_SCOPE, complete: true, truncated: false, expectedCount: n, observedCount: n };
}
function withUniverse(req) {
  return { ...req, universe: proofFor(req) };
}

function completeRequest() {
  const req = {
    slots: [HERO_SLOT, CIRCLE_SLOT, SUPPORT_SLOT],
    roles: {
      hero: { candidates: [heroSafeCand()] },
      circle: { candidates: [circleSafeCand()] },
      support: { candidates: [supportSafeCand()] },
    },
  };
  req.universe = proofFor(req);
  return req;
}

// ---------- markers ----------

test('producer identity + honesty markers', () => {
  const r = buildCandidateCropReadiness(completeRequest());
  assert.equal(r.producer, PRODUCER);
  assert.equal(PRODUCER, 'INDEPENDENT_READINESS_V1');
  assert.equal(RENDERER_PARITY, false);
  assert.equal(r.rendererParity, false); // never claims renderer parity
  assert.equal(r.ephemeral, true);       // explicitly ephemeral
  assert.equal(r.version, 1);
  assert.equal(r.measurementReady, true); // proven universe → ready
});

// ---------- deriveGeometryId parity with the seeded consumer ----------

test('deriveGeometryId is byte-identical to the seeded E-pass module', () => {
  const cases = [
    ['main', 'hero', 'rect', 0, 0, 648, 1080],
    ['circ', 'circle', 'circle', 700, 100, 300, 300],
    ['ev', 'support', 'rect', 700, 450, 300, 400],
    [42, 'support', 'rect', 1, 2, 3, 4],           // numeric slotId (derive fn stringifies)
    ['a|b|c', 'hero', 'rect', 5, 6, 7, 8],         // slotId with delimiter chars
  ];
  for (const c of cases) {
    assert.equal(deriveGeometryId(...c), eDeriveGeometryId(...c));
  }
});

// ---------- happy path: SAFE cells + round-trip into E (COMPLETE) ----------

test('all-SAFE request → feed drives E to a COMPLETE, matched descriptor', () => {
  const r = buildCandidateCropReadiness(completeRequest());
  assert.equal(r.ok, true);
  assert.equal(r.measurementReady, true);
  assert.equal(r.universeComplete, true);
  assert.notEqual(r.feed, null);
  assert.equal(r.summary.cells.safe, 3);
  assert.equal(r.summary.cells.unsafe, 0);
  assert.equal(r.summary.cells.unevaluated, 0);
  assert.equal(r.feed.roles.hero.candidates[0].slotCrops[0].cropSafe, true);

  const d = buildSearchQualityDescriptor(r.feed);
  assert.equal(d.measurementComplete, true);
  assert.equal(d.templateMatch, true);
  assert.deepEqual(d.incomplete, []);
  assert.equal(d.roles.hero.cropSafeDistinct, 1);
});

// ---------- crop verdicts ----------

test('hero subject not containable → cell UNSAFE (measured, not fabricated safe)', () => {
  const req = completeRequest();
  req.roles.hero.candidates = [{
    ...heroSafeCand(),
    subjectBox: { x1: 0.05, y1: 0.1, x2: 0.95, y2: 0.7 }, // width 0.9 > visW 0.8
  }];
  const r = buildCandidateCropReadiness(req);
  assert.equal(r.summary.perRole.hero.unsafe, 1);
  assert.equal(r.summary.perRole.hero.safe, 0);
  assert.equal(r.feed.roles.hero.candidates[0].slotCrops[0].cropSafe, false);

  const d = buildSearchQualityDescriptor(r.feed);
  assert.equal(d.roles.hero.cropEvaluated, true);
  assert.equal(d.roles.hero.cropSafeDistinct, 0);
});

test('circle slot verdict uses square (aspect 1) crop geometry; centered subject → SAFE', () => {
  const req = withUniverse({ slots: [CIRCLE_SLOT], roles: { circle: { candidates: [circleSafeCand()] } } });
  const r = buildCandidateCropReadiness(req);
  assert.equal(r.summary.perRole.circle.safe, 1); // centered 0.6×0.6 subject inside the circle
  const row = r.feed.roles.circle.candidates[0].slotCrops[0];
  assert.equal(row.cropSafe, true);
  assert.equal(row.geometryId, deriveGeometryId('circ', 'circle', 'circle', 700, 100, 300, 300));

  // A wide subject spilling far outside the (centered) square crop window → its mapped
  // corners land far outside the inscribed circle → UNSAFE.
  const req2 = withUniverse({
    slots: [CIRCLE_SLOT],
    roles: { circle: { candidates: [{ ...circleSafeCand(), fullWidth: 1600, fullHeight: 400, subjectBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 } }] } },
  });
  const r2 = buildCandidateCropReadiness(req2);
  assert.equal(r2.feed.roles.circle.candidates[0].slotCrops[0].cropSafe, false);
});

test('(P1-2) circle mask rejects a corner-reaching subject the rect window would allow', () => {
  const wideBox = { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.95 }; // 0.9 × 0.9, square source
  const src = {
    fullWidth: 800, fullHeight: 800, measuredFrom: 'full', highRes: true,
    identity: 'q', pHashCluster: cluster('pq'),
  };

  // SQUARE circle slot → the inscribed-circle mask rejects it (corners outside the circle).
  const rCirc = buildCandidateCropReadiness(withUniverse({
    slots: [{ slotId: 'c', role: 'circle', shape: 'circle', x: 700, y: 100, w: 300, h: 300 }],
    roles: { circle: { candidates: [{ ...src, subjectBox: wideBox, eligibility: { c: true } }] } },
  }));
  assert.equal(rCirc.summary.perRole.circle.unsafe, 1);
  assert.equal(rCirc.feed.roles.circle.candidates[0].slotCrops[0].cropSafe, false);

  // The SAME subject on a same-size RECT slot → the rect window allows it → SAFE.
  // (Proves the circle mask is doing work BEYOND the rectangular containment test.)
  const rRect = buildCandidateCropReadiness(withUniverse({
    slots: [{ slotId: 'r', role: 'support', shape: 'rect', x: 700, y: 100, w: 300, h: 300 }],
    roles: { support: { candidates: [{ ...src, subjectBox: wideBox, eligibility: { r: true } }] } },
  }));
  assert.equal(rRect.summary.perRole.support.safe, 1);
});

test('(P1-2) non-square circle slot → cell UNEVALUATED (mask unmeasurable)', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [{ slotId: 'nc', role: 'circle', shape: 'circle', x: 700, y: 100, w: 300, h: 200 }], // w !== h
    roles: { circle: { candidates: [{ ...circleSafeCand(), eligibility: { nc: true } }] } },
  }));
  assert.equal(r.summary.perRole.circle.unevaluated, 1);
  assert.equal(r.summary.perRole.circle.safe, 0);
  const row = r.feed.roles.circle.candidates[0].slotCrops[0];
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'cropSafe'), false);
});

// ---------- (P1-POS) positional crop honesty (Codex re-audit P1) ----------
// The subject box is judged at its ACTUAL mapped position inside the REAL centre-gravity
// cover-fit crop window — never best-case centered, never a sliding window.

// Square-source (800×800) circle candidate with an arbitrary subject box position:
// square source × square slot ⇒ the crop window is the WHOLE source (mapping = identity).
function circleCandAt(box) {
  return {
    fullWidth: 800, fullHeight: 800, measuredFrom: 'full',
    subjectBox: box, identity: 'p', pHashCluster: cluster('pp'),
    highRes: true, eligibility: { circ: true },
  };
}
function circleReqWith(cand) {
  return withUniverse({ slots: [CIRCLE_SLOT], roles: { circle: { candidates: [cand] } } });
}

test('(P1-POS) circle: centered {0.4..0.6} box → SAFE; top-left {0,0,0.2,0.2} box → NEVER SAFE', () => {
  // REQUIRED behavior 1: a centered box {0.4,0.4,0.6,0.6} is SAFE.
  const rC = buildCandidateCropReadiness(circleReqWith(circleCandAt({ x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 })));
  assert.equal(rC.summary.perRole.circle.safe, 1);
  assert.equal(rC.feed.roles.circle.candidates[0].slotCrops[0].cropSafe, true);

  // REQUIRED behavior 2: a top-left box {0,0,0.2,0.2} must NEVER be SAFE — its actual
  // corners sit far outside the inscribed circle even though its extents are tiny
  // (the old best-case-centering estimate would have called this SAFE).
  const rTL = buildCandidateCropReadiness(circleReqWith(circleCandAt({ x1: 0, y1: 0, x2: 0.2, y2: 0.2 })));
  assert.equal(rTL.summary.perRole.circle.safe, 0, 'a top-left corner box must NEVER be SAFE');
  const row = rTL.feed.roles.circle.candidates[0].slotCrops[0];
  assert.notEqual(row.cropSafe, true);
  assert.equal(rTL.summary.perRole.circle.unsafe, 1); // this impl measures it: UNSAFE
});

test('(P1-POS) circle tangent/boundary boxes: corners exactly ON the circle pass; beyond fails', () => {
  // Largest centered square inscribed in the mask: half-side r, corners at distance
  // exactly 0.5 from the center (2r² = 0.25) → boundary-inclusive SAFE.
  const r = Math.sqrt(0.125);
  const rOn = buildCandidateCropReadiness(circleReqWith(circleCandAt({ x1: 0.5 - r, y1: 0.5 - r, x2: 0.5 + r, y2: 0.5 + r })));
  assert.equal(rOn.summary.perRole.circle.safe, 1);
  // Nudge one corner past the boundary → UNSAFE.
  const rOut = buildCandidateCropReadiness(circleReqWith(circleCandAt({ x1: 0.5 - r, y1: 0.5 - r, x2: 0.5 + r + 0.001, y2: 0.5 + r })));
  assert.equal(rOut.summary.perRole.circle.unsafe, 1);

  // OFF-CENTER tangent: a quadrant box anchored at the center whose FAR corner lies
  // exactly on the circle (√2·q = 0.5) → SAFE; one step further → UNSAFE.
  const q = 0.5 / Math.SQRT2;
  const rQ = buildCandidateCropReadiness(circleReqWith(circleCandAt({ x1: 0.5, y1: 0.5, x2: 0.5 + q, y2: 0.5 + q })));
  assert.equal(rQ.summary.perRole.circle.safe, 1);
  const rQOut = buildCandidateCropReadiness(circleReqWith(circleCandAt({ x1: 0.5, y1: 0.5, x2: 0.5 + q + 0.001, y2: 0.5 + q + 0.001 })));
  assert.equal(rQOut.summary.perRole.circle.unsafe, 1);
});

test('(P1-POS) circle off-center small box: small extents no longer imply SAFE (position decides)', () => {
  // 0.15×0.15 box tucked toward the top-right: under the removed best-case-centering
  // formula (sw²+sh² ≤ 1) this was trivially SAFE; its ACTUAL corner (0.9, 0.1) is at
  // distance² 0.32 > 0.25 from the center → outside the mask → UNSAFE.
  const r = buildCandidateCropReadiness(circleReqWith(circleCandAt({ x1: 0.75, y1: 0.1, x2: 0.9, y2: 0.25 })));
  assert.equal(r.summary.perRole.circle.safe, 0);
  assert.equal(r.summary.perRole.circle.unsafe, 1);
});

test('(P1-POS) crop-shifted window (source aspect ≠ slot aspect): mapping is real, not sliding', () => {
  // Wide 1600×800 source into the square circle slot → only the CENTERED half survives:
  // window x∈[0.25, 0.75], full height; x is magnified ×2 by the mapping.
  const wide = (box) => circleReqWith({
    fullWidth: 1600, fullHeight: 800, measuredFrom: 'full',
    subjectBox: box, identity: 'w', pHashCluster: cluster('pw'),
    highRes: true, eligibility: { circ: true },
  });
  // Source-centered box {0.45..0.55}×{0.4..0.6} maps to {0.4..0.6}² → SAFE.
  const rC = buildCandidateCropReadiness(wide({ x1: 0.45, y1: 0.4, x2: 0.55, y2: 0.6 }));
  assert.equal(rC.summary.perRole.circle.safe, 1);
  // Small box near the source's LEFT edge — entirely OUTSIDE the surviving window
  // (a sliding window would have reached it) → UNSAFE.
  const rL = buildCandidateCropReadiness(wide({ x1: 0.05, y1: 0.4, x2: 0.2, y2: 0.6 }));
  assert.equal(rL.summary.perRole.circle.unsafe, 1);
  // Box INSIDE the window whose corners are inside the circle in RAW source coords
  // (corner (0.32,0.1): 0.1924 < 0.25) — but the crop shift + ×2 horizontal
  // magnification pushes its mapped corner (0.14,0.1) to 0.2896 > 0.25 → UNSAFE.
  const rM = buildCandidateCropReadiness(wide({ x1: 0.32, y1: 0.1, x2: 0.45, y2: 0.3 }));
  assert.equal(rM.summary.perRole.circle.unsafe, 1);
});

test('(P1-POS) rect: box partially outside the REAL crop window → UNSAFE (no sliding)', () => {
  // Wide 1600×800 source into the 300×400 support slot (aspect 0.75): the surviving
  // window is x∈[0.3125, 0.6875] (centered), full height.
  const wideSupport = (box) => withUniverse({
    slots: [SUPPORT_SLOT],
    roles: { support: { candidates: [{
      fullWidth: 1600, fullHeight: 800, measuredFrom: 'full',
      subjectBox: box, identity: 'r', pHashCluster: cluster('pr'),
      highRes: true, eligibility: { ev: true },
    }] } },
  });
  // Extents 0.3×0.8 WOULD fit the window extents (0.375×1) — the removed extents-only
  // check called this SAFE — but at its ACTUAL position it sticks out on the left.
  const rOut = buildCandidateCropReadiness(wideSupport({ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.9 }));
  assert.equal(rOut.summary.perRole.support.unsafe, 1);
  assert.equal(rOut.feed.roles.support.candidates[0].slotCrops[0].cropSafe, false);
  // The SAME extents positioned inside the window → SAFE.
  const rIn = buildCandidateCropReadiness(wideSupport({ x1: 0.35, y1: 0.1, x2: 0.65, y2: 0.9 }));
  assert.equal(rIn.summary.perRole.support.safe, 1);
  // Boundary: a box EXACTLY filling the window maps to [0,1]² → boundary-inclusive SAFE.
  const rEdge = buildCandidateCropReadiness(wideSupport({ x1: 0.3125, y1: 0, x2: 0.6875, y2: 1 }));
  assert.equal(rEdge.summary.perRole.support.safe, 1);
  // Nudged past the window's left edge → UNSAFE.
  const rPast = buildCandidateCropReadiness(wideSupport({ x1: 0.31, y1: 0, x2: 0.6875, y2: 1 }));
  assert.equal(rPast.summary.perRole.support.unsafe, 1);
});

test('(P1-POS) missing coordinate → position invalid → UNEVALUATED (position never guessed)', () => {
  const cand = {
    fullWidth: 900, fullHeight: 1200, measuredFrom: 'full',
    subjectBox: { x1: 0.2, y1: 0.1, x2: 0.7 }, // y2 missing → position unknown
    faceBox: { x1: 0.3, y1: 0.3, x2: 0.5, y2: 0.5 }, // present-but-invalid subject: must NOT be used
    identity: 's', pHashCluster: cluster('ps'), highRes: true, eligibility: { ev: true },
  };
  const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
  assert.equal(r.summary.perRole.support.unevaluated, 1);
  assert.equal(r.summary.perRole.support.safe, 0);
});

test('low-res candidate (upscale beyond threshold) → cell UNSAFE', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [SUPPORT_SLOT],
    roles: { support: { candidates: [{
      fullWidth: 100, fullHeight: 100, measuredFrom: 'full', // up = max(300/100,400/100) = 4 > 1.6
      subjectBox: { x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.5 },
      identity: 'z', pHashCluster: cluster('pz'), highRes: true, eligibility: { ev: true },
    }] } },
  }));
  assert.equal(r.summary.perRole.support.unsafe, 1);
  assert.equal(r.feed.roles.support.candidates[0].slotCrops[0].cropSafe, false);
});

test('hero below the 700px short-side floor → cell UNSAFE', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [{ slotId: 'main', role: 'hero', shape: 'rect', x: 0, y: 0, w: 300, h: 300 }],
    roles: { hero: { candidates: [{
      fullWidth: 500, fullHeight: 500, measuredFrom: 'full', // up = 0.6 ≤ 1.2 but short side 500 < 700
      subjectBox: { x1: 0.3, y1: 0.3, x2: 0.6, y2: 0.6 },
      identity: 'h', pHashCluster: cluster('ph'), highRes: true, eligibility: { main: true },
    }] } },
  }));
  assert.equal(r.summary.perRole.hero.unsafe, 1);
});

// ---------- geometry identity (stale token fail-closed) ----------

test('stale/tampered geometryId claim → TEMPLATE_GEOMETRY_INVALID (fail-closed)', () => {
  const req = completeRequest();
  req.slots = [{ ...HERO_SLOT, geometryId: 'gid1|stale|wrong' }, CIRCLE_SLOT, SUPPORT_SLOT];
  const r = buildCandidateCropReadiness(req);
  assert.equal(r.ok, false);
  assert.equal(r.reason, REASON.TEMPLATE_GEOMETRY_INVALID);
  assert.equal(r.feed, null);
  assert.equal(r.measurementReady, false);
});

test('a correctly-claimed geometryId is accepted', () => {
  const req = completeRequest();
  const gid = deriveGeometryId('main', 'hero', 'rect', 0, 0, 648, 1080);
  req.slots = [{ ...HERO_SLOT, geometryId: gid }, CIRCLE_SLOT, SUPPORT_SLOT];
  const r = buildCandidateCropReadiness(req);
  assert.equal(r.ok, true);
});

// ---------- box + eligibility (P1-3) ----------

test('missing subject/face boxes → cell UNEVALUATED → E reads CROP_NOT_EVALUATED', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [SUPPORT_SLOT],
    roles: { support: { candidates: [{
      fullWidth: 900, fullHeight: 1200, measuredFrom: 'full',
      identity: 's', pHashCluster: cluster('ps'), highRes: true, eligibility: { ev: true },
      // no subjectBox / faceBox
    }] } },
  }));
  assert.equal(r.summary.perRole.support.unevaluated, 1);
  const row = r.feed.roles.support.candidates[0].slotCrops[0];
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'cropSafe'), false); // no boolean verdict

  const d = buildSearchQualityDescriptor(r.feed);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes('CROP_NOT_EVALUATED'));
});

test('thumbnail provenance (untrusted dims) → cell UNEVALUATED', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [SUPPORT_SLOT],
    roles: { support: { candidates: [{
      fullWidth: 900, fullHeight: 1200, measuredFrom: 'thumb', // dims not trusted
      subjectBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.8 },
      identity: 't', pHashCluster: cluster('pt'), highRes: true, eligibility: { ev: true },
    }] } },
  }));
  assert.equal(r.summary.perRole.support.unevaluated, 1);
});

test('(P1-3) present-but-null subjectBox does NOT fall back to faceBox → UNEVALUATED', () => {
  const cand = {
    fullWidth: 900, fullHeight: 1200, measuredFrom: 'full',
    subjectBox: null,                                 // PRESENT but invalid
    faceBox: { x1: 0.3, y1: 0.3, x2: 0.5, y2: 0.5 },  // valid — must NOT be used
    identity: 's', pHashCluster: cluster('ps'), highRes: true, eligibility: { ev: true },
  };
  const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
  assert.equal(r.ok, true); // NOT a structural reject
  assert.equal(r.summary.perRole.support.unevaluated, 1);
  assert.equal(r.summary.perRole.support.safe, 0);
});

test('(P1-3) present-but-invalid subjectBox (bad coords) does NOT fall back → UNEVALUATED', () => {
  const cand = {
    fullWidth: 900, fullHeight: 1200, measuredFrom: 'full',
    subjectBox: { x1: 0.8, y1: 0.1, x2: 0.2, y2: 0.7 }, // x2 < x1 → invalid
    faceBox: { x1: 0.3, y1: 0.3, x2: 0.5, y2: 0.5 },    // valid — must NOT be used
    identity: 's', pHashCluster: cluster('ps'), highRes: true, eligibility: { ev: true },
  };
  const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
  assert.equal(r.summary.perRole.support.unevaluated, 1);
});

test('(P1-3) ABSENT subjectBox DOES fall back to a valid faceBox → SAFE', () => {
  const cand = {
    fullWidth: 900, fullHeight: 1200, measuredFrom: 'full',
    // no subjectBox at all → faceBox fallback allowed
    faceBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.8 }, // valid → used
    identity: 's', pHashCluster: cluster('ps'), highRes: true, eligibility: { ev: true },
  };
  const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
  assert.equal(r.summary.perRole.support.safe, 1);
});

test('(P1-3) present-but-invalid eligibility (null/array/number) → UNEVALUATED (not structural)', () => {
  for (const badElig of [null, [], 5, 'x']) {
    const cand = { ...supportSafeCand(), eligibility: badElig };
    const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
    assert.equal(r.ok, true, `elig ${JSON.stringify(badElig)} must not be structural`);
    assert.equal(r.summary.perRole.support.unevaluated, 1);
  }
});

test('per-slot eligibility false → UNSAFE; missing → UNEVALUATED', () => {
  const ineligible = { ...supportSafeCand(), eligibility: { ev: false } };
  const r1 = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [ineligible] } } }));
  assert.equal(r1.summary.perRole.support.unsafe, 1);

  const unknown = { ...supportSafeCand(), eligibility: {} }; // no key for 'ev'
  const r2 = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [unknown] } } }));
  assert.equal(r2.summary.perRole.support.unevaluated, 1);
});

// ---------- pre-clustered near-dup bucket (P1-4) ----------

test('(P1-4) valid pre-clustered bucket → near-dup token emitted + equality preserved', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [SUPPORT_SLOT],
    roles: { support: { candidates: [
      supportSafeCand('a', 'b1'),
      supportSafeCand('a', 'b1'), // same bucket → same token
      supportSafeCand('a', 'b2'), // different bucket → different token
    ] } },
  }));
  const c = r.feed.roles.support.candidates;
  assert.match(c[0].pHash, /^ph:\d+$/);
  assert.equal(c[0].pHash, c[1].pHash);
  assert.notEqual(c[0].pHash, c[2].pHash);
});

test('(P1-4) raw pHash without a pre-cluster → uniqueness UNMEASURED → E UNIQUENESS_NOT_EVALUATED', () => {
  const cand = supportSafeCand('u', 'pu');
  delete cand.pHashCluster;
  cand.pHash = 'RAW_HASH_MUST_NOT_BE_A_BUCKET'; // raw only — never used
  const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
  assert.equal(r.summary.perRole.support.safe, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(r.feed.roles.support.candidates[0], 'pHash'), false);

  const d = buildSearchQualityDescriptor(r.feed);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes('UNIQUENESS_NOT_EVALUATED'));
});

test('(P1-4) mis-provenanced / mis-versioned / malformed cluster → UNMEASURED (never trusted)', () => {
  const bad = [
    { bucketId: 'x', provenance: 'other_v1', version: 1 },      // wrong provenance
    { bucketId: 'x', provenance: 'precluster_v1', version: 2 }, // wrong version
    { bucketId: 'x', provenance: 'precluster_v1' },             // no version
    { bucketId: 'x', version: 1 },                              // no provenance
    { bucketId: '', provenance: 'precluster_v1', version: 1 },  // empty bucketId
    { provenance: 'precluster_v1', version: 1 },                // no bucketId
    null,                                                       // present-but-invalid
  ];
  for (const badCluster of bad) {
    const cand = { ...supportSafeCand('m', 'ignored'), pHashCluster: badCluster };
    const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
    assert.equal(r.ok, true, `cluster ${JSON.stringify(badCluster)} must not be structural`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(r.feed.roles.support.candidates[0], 'pHash'), false,
      `cluster ${JSON.stringify(badCluster)} must NOT yield a near-dup token`,
    );
  }
});

// ---------- universe proof (P0-1 / P1-1 / P1-5) ----------

test('(P0-1/P1-1/P1-5) universe-proof matrix: only the exact schema is measurement-ready', () => {
  const base = () => ({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [supportSafeCand()] } } }); // observed = 1
  const good = { scope: UNIVERSE_SCOPE, complete: true, truncated: false, expectedCount: 1, observedCount: 1 };

  const rGood = buildCandidateCropReadiness({ ...base(), universe: good });
  assert.equal(rGood.ok, true);
  assert.equal(rGood.measurementReady, true);
  assert.notEqual(rGood.feed, null);

  const bad = [
    undefined,                                                             // missing proof
    {},                                                                    // empty
    { ...good, scope: 's6_sorted' },                                       // s6_sorted-incomplete
    { ...good, scope: 'FULL_VETTED_V1' },                                  // case-different scope
    { complete: true, truncated: false, expectedCount: 1, observedCount: 1 }, // no scope
    { ...good, complete: 1 },                                              // complete not literal true
    { ...good, complete: 'true' },                                         // complete string
    { ...good, truncated: true },                                          // truncated
    { ...good, truncated: 0 },                                            // (P1-1) falsy but NOT literal false
    { ...good, truncated: undefined },                                     // (P1-1) undefined
    { scope: UNIVERSE_SCOPE, complete: true, expectedCount: 1, observedCount: 1 }, // truncated absent
    { ...good, expectedCount: 2 },                                         // expected != observed
    { ...good, expectedCount: 5, observedCount: 5 },                       // exp==obs but != actual pool (1)
    { ...good, observedCount: 0, expectedCount: 0 },                       // count-mismatch vs actual pool (1)
  ];
  for (const u of bad) {
    const r = buildCandidateCropReadiness({ ...base(), universe: u });
    assert.equal(r.ok, false, `should reject: ${JSON.stringify(u)}`);
    assert.equal(r.reason, REASON.UNIVERSE_NOT_PROVEN, `reason for: ${JSON.stringify(u)}`);
    assert.equal(r.measurementReady, false);
    assert.equal(r.feed, null); // E is NEVER called on an unproven universe
  }
});

test('(P0-1) empty demanded pool never lets E report COMPLETE', () => {
  const r = buildCandidateCropReadiness({
    slots: [SUPPORT_SLOT],
    roles: { support: { candidates: [] } }, // demanded but EMPTY
    universe: { scope: UNIVERSE_SCOPE, complete: true, truncated: false, expectedCount: 0, observedCount: 0 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.measurementReady, true);
  // the empty role is OMITTED from the feed → E reads ROLE_TELEMETRY_MISSING (never COMPLETE).
  assert.equal(Object.prototype.hasOwnProperty.call(r.feed.roles, 'support'), false);
  const d = buildSearchQualityDescriptor(r.feed);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes('ROLE_TELEMETRY_MISSING'));
});

// ---------- (P0-2) NO ownKeys enumeration of an untrusted / Proxy array ----------

test('(P0-2) hostile Proxy candidates array: ownKeys trap is NEVER invoked', () => {
  let ownKeysCalls = 0;
  const target = [heroSafeCand()];
  const hostile = new Proxy(target, {
    ownKeys(t) { ownKeysCalls++; throw new Error('ownKeys trap must never run'); },
  });
  const r = buildCandidateCropReadiness({
    slots: [HERO_SLOT],
    roles: { hero: { candidates: hostile } },
    universe: { scope: UNIVERSE_SCOPE, complete: true, truncated: false, expectedCount: 1, observedCount: 1 },
  });
  assert.equal(ownKeysCalls, 0, 'ownKeys trap was invoked on an untrusted array');
  assert.equal(r.ok, true);
  assert.equal(r.summary.perRole.hero.safe, 1); // dense-index reads still processed the element
});

test('(P0-2) hostile Proxy slots array: ownKeys trap is NEVER invoked', () => {
  let ownKeysCalls = 0;
  const hostile = new Proxy([HERO_SLOT], {
    ownKeys() { ownKeysCalls++; throw new Error('ownKeys trap must never run'); },
  });
  const r = buildCandidateCropReadiness({
    slots: hostile,
    roles: { hero: { candidates: [heroSafeCand()] } },
    universe: { scope: UNIVERSE_SCOPE, complete: true, truncated: false, expectedCount: 1, observedCount: 1 },
  });
  assert.equal(ownKeysCalls, 0);
  assert.equal(r.ok, true);
});

// ---------- cross-role distinctness ----------

test('same identity across hero+circle → E reads GLOBAL_DISTINCT_INFEASIBLE', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [HERO_SLOT, CIRCLE_SLOT], // demand: 2 distinct panels
    roles: {
      hero: { candidates: [heroSafeCand('X', 'px')] },
      circle: { candidates: [circleSafeCand('X', 'px')] }, // SAME identity + bucket → one distinct image
    },
  }));
  assert.equal(r.summary.cells.safe, 2);
  assert.equal(r.feed.roles.hero.candidates[0].identity, r.feed.roles.circle.candidates[0].identity);
  assert.equal(r.feed.roles.hero.candidates[0].pHash, r.feed.roles.circle.candidates[0].pHash);

  const d = buildSearchQualityDescriptor(r.feed);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes('GLOBAL_DISTINCT_INFEASIBLE'));
});

test('demanded role with no candidate pool → E reads ROLE_TELEMETRY_MISSING', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [HERO_SLOT, CIRCLE_SLOT],
    roles: { hero: { candidates: [heroSafeCand()] } }, // circle pool absent
  }));
  assert.equal(Object.prototype.hasOwnProperty.call(r.feed.roles, 'circle'), false);
  const d = buildSearchQualityDescriptor(r.feed);
  assert.equal(d.measurementComplete, false);
  assert.ok(d.incomplete.includes('ROLE_TELEMETRY_MISSING'));
});

// ---------- determinism / freeze / detachment ----------

test('deterministic: identical request → identical result (byte-for-byte JSON)', () => {
  const a = buildCandidateCropReadiness(completeRequest());
  const b = buildCandidateCropReadiness(completeRequest());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('result is deeply frozen (mutation throws in strict mode)', () => {
  const r = buildCandidateCropReadiness(completeRequest());
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.summary));
  assert.ok(Object.isFrozen(r.summary.perRole.hero));
  assert.ok(Object.isFrozen(r.feed));
  assert.ok(Object.isFrozen(r.feed.templateAuthority.slots));
  assert.ok(Object.isFrozen(r.feed.roles.hero.candidates[0]));
  assert.ok(Object.isFrozen(r.feed.roles.hero.candidates[0].slotCrops[0]));
  assert.throws(() => { r.ok = false; }, TypeError);
  assert.throws(() => { r.feed.roles.hero.candidates[0].slotCrops[0].cropSafe = false; }, TypeError);
});

test('result is detached: mutating the input afterwards does not change it', () => {
  const req = completeRequest();
  const r = buildCandidateCropReadiness(req);
  const snapshot = JSON.stringify(r);
  req.slots[0].x = 5;
  req.roles.hero.candidates[0].subjectBox.x1 = 0.99;
  req.roles.hero.candidates[0].identity = 'MUTATED';
  req.roles.hero.candidates.push(circleSafeCand());
  assert.equal(JSON.stringify(r), snapshot);
});

// ---------- privacy / no-leak (P2-2) ----------

test('no-leak: raw identity / raw pHash / PII never appear in the output', () => {
  const cand = {
    fullWidth: 900, fullHeight: 1200, measuredFrom: 'full',
    subjectBox: { x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.8 },
    identity: 'PERSON_SECRET_NAME',
    pHashCluster: { bucketId: 'BUCKET_SECRET', provenance: 'precluster_v1', version: 1 },
    highRes: true, eligibility: { ev: true },
    // untrusted extras the producer must never read/echo:
    pHash: 'RAW_PHASH_SECRET',       // raw pHash is NOT read anymore
    url: 'http://secret.example/img.jpg', name: 'SecretName',
    base64: 'QUJDREVGRw==', filePath: '/private/secret/path.png',
  };
  const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
  const blob = JSON.stringify(r);
  for (const secret of [
    'PERSON_SECRET_NAME', 'BUCKET_SECRET', 'RAW_PHASH_SECRET', 'http://secret.example/img.jpg',
    'SecretName', 'QUJDREVGRw==', '/private/secret/path.png',
  ]) {
    assert.equal(blob.includes(secret), false, `leaked: ${secret}`);
  }
  assert.match(r.feed.roles.support.candidates[0].identity, /^id:\d+$/);
  assert.match(r.feed.roles.support.candidates[0].pHash, /^ph:\d+$/);
});

test('no-serialization-leak: durable summary carries counts only (no tokens / no matrix)', () => {
  const r = buildCandidateCropReadiness(completeRequest());
  const summaryBlob = JSON.stringify(r.summary);
  assert.equal(summaryBlob.includes('gid1'), false);     // no geometryId
  assert.equal(summaryBlob.includes('main'), false);     // no slotId
  assert.equal(summaryBlob.includes('id:'), false);      // no identity token
  assert.equal(summaryBlob.includes('ph:'), false);      // no pHash token
  assert.equal(summaryBlob.includes('cropSafe'), false); // no per-candidate matrix
});

test('(P2-2) raw candidate ids / slotIds never leak into DURABLE output', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [{ slotId: 'SLOT_RAW_ID', role: 'support', shape: 'rect', x: 700, y: 450, w: 300, h: 400 }],
    roles: { support: { candidates: [{
      ...supportSafeCand('CAND_RAW_IDENTITY', 'BUCKET_RAW_ID'),
      eligibility: { SLOT_RAW_ID: true },
    }] } },
  }));
  // Durable projection = the result WITHOUT the ephemeral feed.
  const durable = JSON.stringify({ ...r, feed: undefined });
  for (const raw of ['SLOT_RAW_ID', 'CAND_RAW_IDENTITY', 'BUCKET_RAW_ID']) {
    assert.equal(durable.includes(raw), false, `leaked into durable output: ${raw}`);
  }
  // In the ephemeral feed, candidate identity + bucket are TOKENIZED (raw absent);
  // slotId legitimately appears (E needs it) but only inside the ephemeral feed.
  const feedBlob = JSON.stringify(r.feed);
  assert.equal(feedBlob.includes('CAND_RAW_IDENTITY'), false);
  assert.equal(feedBlob.includes('BUCKET_RAW_ID'), false);
  assert.match(r.feed.roles.support.candidates[0].identity, /^id:\d+$/);
  assert.match(r.feed.roles.support.candidates[0].pHash, /^ph:\d+$/);
});

test('opaque tokens stable + preserve equality (identity + pre-cluster bucket)', () => {
  const r = buildCandidateCropReadiness(withUniverse({
    slots: [SUPPORT_SLOT],
    roles: { support: { candidates: [
      supportSafeCand('same', 'p1'),
      supportSafeCand('same', 'p2'),  // same identity, different bucket
      supportSafeCand('other', 'p1'), // different identity, same bucket as #0
    ] } },
  }));
  const c = r.feed.roles.support.candidates;
  assert.equal(c[0].identity, c[1].identity);    // same raw identity → same token
  assert.notEqual(c[0].identity, c[2].identity); // different raw identity → different token
  assert.equal(c[0].pHash, c[2].pHash);          // same raw bucket → same token
  assert.notEqual(c[0].pHash, c[1].pHash);       // different raw bucket → different token
});

// ---------- hard bounds (rejected fail-closed, BEFORE the universe proof) ----------

test('too many slots (> MAX_REALIZED_SLOTS) → BOUNDS_EXCEEDED', () => {
  const slots = [];
  for (let i = 0; i < LIMITS.MAX_REALIZED_SLOTS + 1; i++) {
    slots.push({ slotId: `s${i}`, role: 'support', shape: 'rect', x: 0, y: 0, w: 10, h: 10 });
  }
  const r = buildCandidateCropReadiness({ universe: { complete: true }, slots, roles: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REASON.BOUNDS_EXCEEDED);
  assert.equal(r.feed, null);
});

test('too many candidates per role (> MAX_CANDIDATES_PER_ROLE) → BOUNDS_EXCEEDED', () => {
  const candidates = Array.from({ length: LIMITS.MAX_CANDIDATES_PER_ROLE + 1 }, () => ({}));
  const r = buildCandidateCropReadiness({
    universe: { complete: true }, slots: [SUPPORT_SLOT], roles: { support: { candidates } },
  });
  assert.equal(r.reason, REASON.BOUNDS_EXCEEDED);
});

test('crop cells over-product (candidates × role slots > MAX_CROP_CELLS) → BOUNDS_EXCEEDED', () => {
  const slots = [
    { slotId: 'a', role: 'support', shape: 'rect', x: 0, y: 0, w: 10, h: 10 },
    { slotId: 'b', role: 'support', shape: 'rect', x: 20, y: 0, w: 10, h: 10 },
    { slotId: 'c', role: 'support', shape: 'rect', x: 40, y: 0, w: 10, h: 10 },
  ];
  const candidates = Array.from({ length: 1400 }, () => ({})); // 1400 × 3 = 4200 > 4000
  const r = buildCandidateCropReadiness({ universe: { complete: true }, slots, roles: { support: { candidates } } });
  assert.equal(r.reason, REASON.BOUNDS_EXCEEDED);
});

test('global match-edge over-product (candidates × total slots > MAX_MATCH_EDGES) → BOUNDS_EXCEEDED', () => {
  const slots = [HERO_SLOT];
  for (let i = 0; i < 9; i++) slots.push({ slotId: `sp${i}`, role: 'support', shape: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const r = buildCandidateCropReadiness({
    universe: { complete: true }, slots,
    roles: {
      hero: { candidates: Array.from({ length: 2000 }, () => ({})) },
      support: { candidates: Array.from({ length: 20 }, () => ({})) },
    },
  });
  assert.equal(r.reason, REASON.BOUNDS_EXCEEDED);
});

// ---------- template-not-measured / geometry-invalid ----------

test('absent slots → TEMPLATE_NOT_MEASURED; empty slots → TEMPLATE_GEOMETRY_INVALID', () => {
  const r1 = buildCandidateCropReadiness({ universe: { complete: true }, roles: {} });
  assert.equal(r1.reason, REASON.TEMPLATE_NOT_MEASURED);
  const r2 = buildCandidateCropReadiness({ universe: { complete: true }, slots: [], roles: {} });
  assert.equal(r2.reason, REASON.TEMPLATE_GEOMETRY_INVALID);
});

test('slot box outside the 1080×1350 canvas → TEMPLATE_GEOMETRY_INVALID', () => {
  const r = buildCandidateCropReadiness({
    universe: { complete: true },
    slots: [{ slotId: 'x', role: 'support', shape: 'rect', x: 900, y: 0, w: 300, h: 10 }], // 900+300 > 1080
    roles: {},
  });
  assert.equal(r.reason, REASON.TEMPLATE_GEOMETRY_INVALID);
});

test('shape not matching the role canonical shape → TEMPLATE_GEOMETRY_INVALID', () => {
  const r = buildCandidateCropReadiness({
    universe: { complete: true },
    slots: [{ slotId: 'main', role: 'hero', shape: 'circle', x: 0, y: 0, w: 100, h: 100 }], // hero must be rect
    roles: {},
  });
  assert.equal(r.reason, REASON.TEMPLATE_GEOMETRY_INVALID);
});

test('duplicate slotId → TEMPLATE_GEOMETRY_INVALID', () => {
  const r = buildCandidateCropReadiness({
    universe: { complete: true },
    slots: [
      { slotId: 'dup', role: 'support', shape: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { slotId: 'dup', role: 'support', shape: 'rect', x: 20, y: 0, w: 10, h: 10 },
    ],
    roles: {},
  });
  assert.equal(r.reason, REASON.TEMPLATE_GEOMETRY_INVALID);
});

test('(P2-1) numeric slotId rejected; string slotId is type-exact (1 ≠ "1")', () => {
  // A numeric slotId is not a canonical string → geometry invalid (no coercion collision).
  const rNum = buildCandidateCropReadiness({
    universe: { complete: true },
    slots: [{ slotId: 1, role: 'support', shape: 'rect', x: 0, y: 0, w: 10, h: 10 }],
    roles: {},
  });
  assert.equal(rNum.reason, REASON.TEMPLATE_GEOMETRY_INVALID);

  // The string slotId '1' is accepted and drives a real verdict; eligibility keyed by '1'.
  const cand = { ...supportSafeCand(), eligibility: { 1: true } }; // object key coerces to '1'
  const rStr = buildCandidateCropReadiness(withUniverse({
    slots: [{ slotId: '1', role: 'support', shape: 'rect', x: 700, y: 450, w: 300, h: 400 }],
    roles: { support: { candidates: [cand] } },
  }));
  assert.equal(rStr.ok, true);
  assert.equal(rStr.summary.perRole.support.safe, 1);
});

// ---------- structural / hostile input (never throws) ----------

test('non-object / array / primitive inputs → STRUCTURAL (no throw)', () => {
  for (const bad of [null, undefined, 42, 'x', true, [], [HERO_SLOT]]) {
    const r = buildCandidateCropReadiness(bad);
    assert.equal(r.ok, false);
    assert.equal(r.reason, REASON.STRUCTURAL);
    assert.equal(r.feed, null);
  }
});

test('accessor property on the universe field → STRUCTURAL', () => {
  const req = completeRequest();
  const hostile = {};
  Object.defineProperty(hostile, 'complete', { get() { return true; }, enumerable: true, configurable: true });
  req.universe = hostile;
  const r = buildCandidateCropReadiness(req);
  assert.equal(r.reason, REASON.STRUCTURAL);
});

test('throwing getOwnPropertyDescriptor trap → STRUCTURAL (no throw escapes)', () => {
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('trap'); } });
  const r = buildCandidateCropReadiness(hostile);
  assert.equal(r.ok, false);
  assert.equal(r.reason, REASON.STRUCTURAL);
});

test('exotic-prototype input → STRUCTURAL', () => {
  const exotic = Object.create({ slots: [HERO_SLOT] }); // non-Object.prototype proto
  const r = buildCandidateCropReadiness(exotic);
  assert.equal(r.reason, REASON.STRUCTURAL);
});

test('accessor on a candidate field → STRUCTURAL', () => {
  const cand = supportSafeCand();
  Object.defineProperty(cand, 'fullWidth', { get() { return 900; }, enumerable: true, configurable: true });
  const r = buildCandidateCropReadiness(withUniverse({ slots: [SUPPORT_SLOT], roles: { support: { candidates: [cand] } } }));
  assert.equal(r.reason, REASON.STRUCTURAL);
});
