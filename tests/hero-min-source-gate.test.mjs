import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import test from 'node:test';

import {
  HERO_MIN_SOURCE_MAX_UPSCALE,
  selectHeroSourceCandidate,
} from '../src/lib/heroCropGeometry.js';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(){ throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const NEXT_STUB = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, status: (init && init.status) || 200 }) };');
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(NEXT_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`));

process.env.S6_REAL_SIZE_GATE = '0';
process.env.S6_STORY_FIT = '0';
process.env.MEGA_QUARANTINE = '0';
process.env.POOL_CLEAN_GATE = '0';
process.env.MEGA_S6_MIN_CLEAN = '0';
process.env.MEGA_HERO_PROMINENCE = '0';
process.env.MEGA_SECOND_EYE = '0';
process.env.MEGA_SOLVER_DIAGNOSTICS_V2 = '0';
delete process.env.MEGA_SEMANTIC_SELECTION;
delete process.env.MEGA_SELECTION_SPEC;
delete process.env.MEGA_REF_HERO_V2;
const { s6_slots } = await import('../src/lib/megaAdapters.js');
const { normalizeHeroMinSourceWarning } = await import('../src/lib/services/megaComposerService.js');

test('soft preference boundary matches the existing 1.35x crop pre-filter cap', () => {
  assert.equal(HERO_MIN_SOURCE_MAX_UPSCALE, 1.35);
});

test('preserves quality order among candidates that fit the soft source limit', () => {
  const candidates = [
    { id: 'tiny', estimatedUpscale: 3.67 },
    { id: 'preferred-quality', estimatedUpscale: 1.32 },
    { id: 'larger-but-lower-quality', estimatedUpscale: 1.2 },
  ];
  const result = selectHeroSourceCandidate(candidates);
  assert.equal(result.candidate.id, 'preferred-quality');
  assert.equal(result.reason, 'within-threshold');
  assert.equal(result.allBelowThreshold, false);
  assert.equal(result.measuredCount, 3);
});

test('all-small fallback chooses the largest usable source and warns through the result', () => {
  const result = selectHeroSourceCandidate([
    { id: 'ac-0232-class', estimatedUpscale: 3.67 },
    { id: 'middle', estimatedUpscale: 2.1 },
    { id: 'largest-usable', estimatedUpscale: 1.82 },
  ]);
  assert.equal(result.candidate.id, 'largest-usable');
  assert.equal(result.selectedUpscale, 1.82);
  assert.equal(result.reason, 'all-below-threshold');
  assert.equal(result.allBelowThreshold, true);
});

test('unmeasured candidates cannot beat a measured fit but do not hard-fail an unknown-only pool', () => {
  const mixed = selectHeroSourceCandidate([
    { id: 'unknown', estimatedUpscale: null },
    { id: 'measured', estimatedUpscale: 1.5 },
  ]);
  assert.equal(mixed.candidate.id, 'measured');
  assert.equal(mixed.measuredCount, 1);

  const unknownOnly = selectHeroSourceCandidate([
    { id: 'unknown-a' },
    { id: 'unknown-b', estimatedUpscale: Number.NaN },
  ]);
  assert.equal(unknownOnly.candidate, null);
  assert.equal(unknownOnly.reason, 'unmeasured');
  assert.equal(unknownOnly.measuredCount, 0);
});

test('selector is pure and does not mutate caller order or rows', () => {
  const candidates = Object.freeze([
    Object.freeze({ id: 'a', estimatedUpscale: 2.4 }),
    Object.freeze({ id: 'b', estimatedUpscale: 1.9 }),
  ]);
  assert.doesNotThrow(() => selectHeroSourceCandidate(candidates));
  assert.deepEqual(candidates.map((row) => row.id), ['a', 'b']);
});

test('S6 wires the default-on kill switch, soft selector, warning, and S7 carrier', async () => {
  const source = await readFile(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.MEGA_HERO_MIN_SOURCE !== '0'/);
  assert.match(source, /_selectHeroSourceCandidate\(_options, _heroMinSourceMax\)/);
  assert.match(source, /hero_source_all_small:/);
  assert.match(source, /hero_source_unmeasured:/);
  assert.match(source, /heroMinSource: _heroMinSourcePatch/);
  assert.match(source, /_heroMinSourceWarning: slots\[primary\]\._heroMinSourceWarning/);
});

test('composer accepts only bounded hero-source warnings and normalizes the ratio', () => {
  assert.equal(
    normalizeHeroMinSourceWarning('hero_source_all_small:LARGEST-1:1.943'),
    'hero_source_all_small:LARGEST-1:1.94',
  );
  assert.equal(
    normalizeHeroMinSourceWarning('hero_source_small_after_second_eye:REPLACED-2:2.1'),
    'hero_source_small_after_second_eye:REPLACED-2:2.10',
  );
  assert.equal(
    normalizeHeroMinSourceWarning('hero_source_unmeasured:UNKNOWN-3'),
    'hero_source_unmeasured:UNKNOWN-3',
  );
  assert.equal(normalizeHeroMinSourceWarning('arbitrary_qc_flag'), null);
  assert.equal(normalizeHeroMinSourceWarning('hero_source_all_small:bad:id:3.0'), null);
  assert.equal(normalizeHeroMinSourceWarning('hero_source_all_small:OK:101'), null);
});

test('composer strict/legacy paths and compose-test route carry the warning into qcFlags', async () => {
  const composer = await readFile(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');
  const route = await readFile(new URL('../src/app/api/mega/compose-test/route.js', import.meta.url), 'utf8');
  assert.match(composer, /heroMinSourceWarning: normalizeHeroMinSourceWarning\(m\._heroMinSourceWarning\)/);
  assert.match(composer, /_strictHeroSourceWarning[\s\S]*qcFlags\.push\(_strictHeroSourceWarning\)/);
  assert.match(composer, /_heroSourceWarning[\s\S]*qcFlags\.push\(_heroSourceWarning\)/);
  assert.match(route, /_heroMinSourceWarning: slots\[primary\]\._heroMinSourceWarning/);
});

const DNA = {
  layoutType: 'hero-source-fixture',
  template: {
    slots: [
      { role: 'hero', pos: 'ซ้ายเต็มสูง', xPct: 0, yPct: 0, wPct: 50, hPct: 100 },
      { role: 'context', pos: 'บนขวา', xPct: 50, yPct: 0, wPct: 50, hPct: 50 },
      { role: 'action', pos: 'ล่างขวา', xPct: 50, yPct: 50, wPct: 50, hPct: 50 },
    ],
  },
};
const mkImage = (id, faceSize, quality = 8, { realWidth = 1200, realHeight = 1600 } = {}) => ({
  id,
  imageUrl: `https://cdn.test/${id}.jpg`,
  realWidth,
  realHeight,
  triage: {
    relevant: true,
    clean: true,
    faceCount: faceSize ? 1 : 0,
    person: faceSize ? 'Hero Person' : null,
    persons: faceSize ? ['Hero Person'] : [],
    category: faceSize ? 'face-emotional' : 'context',
    newsScene: true,
    quality,
    ...(faceSize ? {
      faceBox: {
        x1: 0.5 - faceSize / 2,
        y1: 0.4,
        x2: 0.5 + faceSize / 2,
        y2: 0.4 + faceSize,
      },
    } : {}),
  },
});
const mkJob = () => ({
  dossier: {
    images: { caseId: 'AC0232-SOURCE-GATE' },
    compass: {
      angle: 'fixture',
      primaryEmotion: 'warm',
      secondaryEmotions: [],
      mainCharacters: [{ name: 'Hero Person', role: 'hero' }],
      visualDreamShots: [],
      doNotUse: [],
    },
    desk: { title: 'fixture' },
    refMatch: { dna: DNA, styleName: 'fixture', typeMatched: true, imagePath: '/fixture.jpg' },
  },
});
const filler = (n) => mkImage(`F${n}`, null, 5);
const runS6 = async ({ hero, alternative, job = mkJob(), capture = null }) => {
  const pool = [hero, alternative, filler(1), filler(2), filler(3), filler(4)];
  const answer = {
    hero: { id: hero.id, reason: 'brain fixture', backups: [] },
    reaction: { id: 'F1' },
    action: { id: 'F2' },
    context: { id: 'F3' },
    circle: { id: 'F4' },
  };
  return s6_slots(job, {
    origin: 'http://mock',
    _deps: {
      slotDirectorBrain: async (args) => {
        if (capture) capture.brainArgs = args;
        return { slots: answer, note: 'fixture' };
      },
      fetchJson: async (url) => {
        if (String(url).includes('/api/images/')) return { success: true, images: pool };
        throw new Error(`unexpected fetch: ${url}`);
      },
    },
  });
};

test('real S6 run reselects an AC-0232-class ~3.64x hero, while kill-switch 0 restores the old pick', async () => {
  const oldSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  try {
    const tiny = mkImage('TINY-3_64X', 0.08, 10);
    const fitting = mkImage('FIT-1_25X', 0.20, 8, { realWidth: 1500, realHeight: 2000 });
    delete process.env.MEGA_HERO_MIN_SOURCE;
    const on = await runS6({ hero: tiny, alternative: fitting });
    assert.equal(on.status, 'done');
    assert.equal(on.dossierPatch.pickImages.slots.hero.id, fitting.id);
    assert.equal(on.dossierPatch.pickImages.heroMinSource.action, 'reselect:pool');
    assert.ok(on.dossierPatch.pickImages.heroMinSource.selectedUpscale <= 1.35);

    process.env.MEGA_HERO_MIN_SOURCE = '0';
    const off = await runS6({ hero: tiny, alternative: fitting });
    assert.equal(off.status, 'done');
    assert.equal(off.dossierPatch.pickImages.slots.hero.id, tiny.id);
    assert.equal('heroMinSource' in off.dossierPatch.pickImages, false);
    assert.equal('_heroMinSourceWarning' in off.dossierPatch.pickImages.slots.hero, false);
  } finally {
    if (oldSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSwitch;
  }
});

test('1.35x preference treats an over-cap but better sparse-pool source as all-small, not within-threshold', async () => {
  const oldSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  try {
    delete process.env.MEGA_HERO_MIN_SOURCE;
    const tightFace = mkImage('COARSE-SAFE-BUT-3_64X', 0.08, 10);
    // Whole-source cover-fit is 1.50x (> the shared 1.35 preference/crop cap). It may still
    // be the least-bad sparse-pool fallback, but must be classified all-small and warned.
    const closerFit = mkImage('FACE-AWARE-1_50X', 0.50, 8, { realWidth: 400, realHeight: 900 });
    const result = await runS6({ hero: tightFace, alternative: closerFit });
    const pickImages = result.dossierPatch.pickImages;
    assert.equal(result.status, 'done');
    assert.equal(pickImages.slots.hero.id, closerFit.id);
    assert.ok(pickImages.heroMinSource.selectedUpscale > 1.35);
    assert.equal(pickImages.heroMinSource.allSmall, true);
    assert.equal(pickImages.heroMinSource.action, 'reselect:pool');
  } finally {
    if (oldSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSwitch;
  }
});

test('real S6 all-small pool selects the lowest-upscale source and carries a clear warning', async () => {
  const oldSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  try {
    delete process.env.MEGA_HERO_MIN_SOURCE;
    // Both source files also fail the older whole-source crop guard (>1.35x), reproducing the
    // important sparse-pool interaction rather than only making the face crop tight.
    const worst = mkImage('WORST-3_64X', 0.08, 10, { realWidth: 350, realHeight: 700 });
    const largest = mkImage('LARGEST-SMALL', 0.15, 8, { realWidth: 450, realHeight: 750 });
    const result = await runS6({ hero: worst, alternative: largest });
    const pickImages = result.dossierPatch.pickImages;
    assert.equal(result.status, 'done');
    assert.equal(pickImages.slots.hero.id, largest.id);
    assert.equal(pickImages.cropGuard.violation, true, 'older hard guard must have found no safe source');
    assert.equal(pickImages.heroMinSource.measuredCandidates, 2);
    assert.equal(pickImages.heroMinSource.allSmall, true);
    assert.equal(
      pickImages.slots.hero._heroMinSourceWarning,
      `hero_source_all_small:LARGEST-SMALL:${pickImages.heroMinSource.selectedUpscale.toFixed(2)}`,
    );
  } finally {
    if (oldSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSwitch;
  }
});

test('probe F1: an unmeasured current hero is retained over a measured ~3.7x alternative', async () => {
  const oldSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  try {
    delete process.env.MEGA_HERO_MIN_SOURCE;
    const current = mkImage('NODIMS-BEST', 0.22, 10, { realWidth: null, realHeight: null });
    current.triage.realShortSide = 1200;
    const measuredWorse = mkImage('MEASURED-WORSE', 0.08, 8);
    const result = await runS6({ hero: current, alternative: measuredWorse });
    const pickImages = result.dossierPatch.pickImages;
    assert.equal(result.status, 'done');
    assert.equal(pickImages.slots.hero.id, current.id);
    assert.equal(pickImages.heroMinSource.action, 'legacy-retained');
    assert.equal(pickImages.heroMinSource.selectedUpscale, null);
    assert.equal(
      pickImages.slots.hero._heroMinSourceWarning,
      `hero_source_unmeasured:${current.id}`,
    );
  } finally {
    if (oldSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSwitch;
  }
});

test('probe F1 absolute: policy narrowing cannot swap an unmeasured current hero', async () => {
  const oldSourceSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  const oldCleanFloor = process.env.MEGA_S6_MIN_CLEAN;
  try {
    delete process.env.MEGA_HERO_MIN_SOURCE;
    process.env.MEGA_S6_MIN_CLEAN = '0';
    const current = mkImage('UNMEASURED-CURRENT', 0.22, 10);
    current.triage.clean = false;
    current.triage.watermark = true;
    current.triage.hasText = true;
    const measuredWorse = mkImage('MEASURED-CLEAN', 0.08, 8);
    const result = await runS6({ hero: current, alternative: measuredWorse });
    const pickImages = result.dossierPatch.pickImages;
    assert.equal(result.status, 'done');
    assert.equal(pickImages.slots.hero.id, current.id);
    assert.equal(pickImages.heroMinSource.action, 'legacy-retained');
    assert.equal(
      pickImages.slots.hero._heroMinSourceWarning,
      `hero_source_unmeasured:${current.id}`,
    );
  } finally {
    if (oldSourceSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSourceSwitch;
    if (oldCleanFloor === undefined) delete process.env.MEGA_S6_MIN_CLEAN;
    else process.env.MEGA_S6_MIN_CLEAN = oldCleanFloor;
  }
});

test('probe F2: watermark/hasText face geometry is unmeasured and cannot win via cover-fit fallback', async () => {
  const oldSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  try {
    delete process.env.MEGA_HERO_MIN_SOURCE;
    const cleanCurrent = mkImage('CLEAN-CURRENT', 0.20, 8);
    const risky = mkImage('WATERMARK-TEXT', 0.50, 10);
    risky.triage.clean = undefined;
    risky.triage.watermark = true;
    risky.triage.hasText = true;
    const result = await runS6({ hero: cleanCurrent, alternative: risky });
    const pickImages = result.dossierPatch.pickImages;
    assert.equal(result.status, 'done');
    assert.equal(pickImages.slots.hero.id, cleanCurrent.id);
    assert.equal(pickImages.heroMinSource.measuredCandidates, 1);
    assert.equal(pickImages.heroMinSource.selectedId, cleanCurrent.id);
  } finally {
    if (oldSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSwitch;
  }
});

test('probe F3: a job without ref DNA emits no hero_source warning or heroMinSource patch', async () => {
  const oldSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  try {
    delete process.env.MEGA_HERO_MIN_SOURCE;
    const noRefJob = mkJob();
    delete noRefJob.dossier.refMatch;
    const hero = mkImage('NO-REF-HERO', 0.30, 10, { realWidth: 2000, realHeight: 2600 });
    const alternative = mkImage('NO-REF-ALT', 0.25, 8);
    const result = await runS6({ hero, alternative, job: noRefJob });
    const pickImages = result.dossierPatch.pickImages;
    assert.equal(result.status, 'done');
    assert.equal('heroMinSource' in pickImages, false);
    for (const slot of Object.values(pickImages.slots)) {
      assert.equal('_heroMinSourceWarning' in slot, false);
    }
  } finally {
    if (oldSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSwitch;
  }
});

test('F5: default-on source gate does not add private geometry fields to LLM imagesMeta', async () => {
  const oldSwitch = process.env.MEGA_HERO_MIN_SOURCE;
  try {
    delete process.env.MEGA_HERO_MIN_SOURCE;
    const capture = {};
    const hero = mkImage('META-TINY', 0.08, 10);
    const alternative = mkImage('META-FIT', 0.25, 8);
    await runS6({ hero, alternative, capture });
    assert.ok(Array.isArray(capture.brainArgs?.imagesMeta));
    for (const row of capture.brainArgs.imagesMeta) {
      assert.equal('heroSourceUpscale' in row, false);
      assert.equal('heroSourceBasis' in row, false);
      assert.equal('heroMinSourceAvoid' in row, false);
    }
  } finally {
    if (oldSwitch === undefined) delete process.env.MEGA_HERO_MIN_SOURCE;
    else process.env.MEGA_HERO_MIN_SOURCE = oldSwitch;
  }
});
