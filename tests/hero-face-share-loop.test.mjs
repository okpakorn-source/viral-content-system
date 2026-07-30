// MEGA_FACE_SHARE_LOOP — calibrated geometry-first, single-render tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const SHARP_STUB = MOD(`
export default function sharp(){
  const meta = globalThis.__FACE_SHARE_SHARP_META || { width: 1200, height: 1600 };
  const chain = {
    metadata: async () => ({ width: meta.width, height: meta.height }),
    stats: async () => ({ channels: [{ mean: 128 }, { mean: 128 }, { mean: 128 }] }),
    extract(region){
      if (globalThis.__FACE_SHARE_THROW_ONCE) {
        globalThis.__FACE_SHARE_THROW_ONCE = false;
        throw new Error('face-share-render-failed-once');
      }
      (globalThis.__FACE_SHARE_EXTRACTS ||= []).push({ ...region });
      return chain;
    },
    resize(){ return chain; }, png(){ return chain; }, jpeg(){ return chain; },
    linear(){ return chain; }, modulate(){ return chain; }, sharpen(){ return chain; }, blur(){ return chain; },
    composite(){ return chain; }, greyscale(){ return chain; }, raw(){ return chain; }, extend(){ return chain; },
    flatten(){ return chain; }, toColourspace(){ return chain; }, removeAlpha(){ return chain; },
    toBuffer: async () => Buffer.alloc(2048, 7),
  };
  return chain;
}`);
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`));

const {
  zoomHeroRegionForFaceShare,
  runHeroFaceShareLoop,
  HERO_CROP,
  HERO_STRETCH_MAX,
} = await import('../src/lib/heroCropGeometry.js');
const {
  executeCover,
  _heroShareTargetPct,
  _heroShareRounds,
  _faceShareLoopOn,
  _heroUpscaleMaxEffExec,
} = await import('../src/lib/services/coverExecutorService.js');

const SLOT_W = 660;
const SLOT_H = 900;
const SLOT_ASPECT = SLOT_W / SLOT_H;
const BASE_REGION = Object.freeze({ left: 0, top: 0, width: 1320, height: 1800 });
const BASE_FACE = Object.freeze({ x1: 0.40, y1: 0.20, x2: 0.60, y2: 0.40 });

async function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function mockLoop({ region = BASE_REGION, regions = [], maxRetries = 2 }) {
  const events = [];
  return {
    events,
    promise: runHeroFaceShareLoop({
      region: { ...region },
      faceBox: { ...BASE_FACE },
      imgW: 1320,
      imgH: 1800,
      slotAspect: SLOT_ASPECT,
      slotH: SLOT_H,
      floorFrac: 0.30,
      targetFrac: 0.36,
      maxFaceHFrac: HERO_CROP.maxFaceHFrac,
      maxRetries,
      render: async (region, attempt) => {
        events.push(`render:${attempt}:${region.height}`);
        return { attempt, region: { ...region } };
      },
      refineRegion: async (region, { attempt, stretchCap }) => {
        events.push(`refine:${attempt}:${region.height}`);
        assert.equal(stretchCap, HERO_STRETCH_MAX, 'coordinator must expose only the hard 1.2 cap');
        const next = regions[attempt - 1];
        return next
          ? { changed: true, region: { ...next }, reason: 'mock-refined' }
          : { changed: false, region, reason: 'mock-cap' };
      },
    }),
  };
}

test('geometry finishes before one final render, whose buffer is reused by the executor', async () => {
  const r1 = { left: 330, top: 491, width: 600, height: 818 };
  const mock = mockLoop({ regions: [r1] });
  const result = await mock.promise;
  assert.deepEqual(mock.events, [
    'refine:1:1800',
    'render:1:818',
  ]);
  assert.equal(result.retries, 1);
  assert.equal(result.renderCount, 1);
  assert.equal(result.reachedTarget, true);
  assert.equal(result.limited, false);
  assert.equal(result.faceSharePct, 44);
  assert.equal(result.rendered.attempt, 1);
  assert.deepEqual(result.region, r1);
});

test('share at the 0.30 floor does not retry; target is an aim only after floor failure', async () => {
  const atFloor = { left: 220, top: 300, width: 880, height: 1200 };
  const mock = mockLoop({ region: atFloor, regions: [{ left: 330, top: 491, width: 600, height: 818 }] });
  const result = await mock.promise;
  assert.deepEqual(mock.events, ['render:0:1200']);
  assert.equal(result.retries, 0);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'above-floor');
  assert.equal(result.limited, false);
});

test('a below-floor hero can refine exactly twice and stops as soon as target 0.36 is computed', async () => {
  const r1 = { left: 110, top: 150, width: 1100, height: 1500 };
  const r2 = { left: 330, top: 500, width: 587, height: 800 };
  const mock = mockLoop({ regions: [r1, r2] });
  const result = await mock.promise;
  assert.equal(result.retries, 2);
  assert.equal(result.renderCount, 1);
  assert.equal(result.reachedTarget, true);
  assert.equal(result.reason, 'target-reached');
  assert.deepEqual(mock.events.map((event) => event.split(':')[0]), [
    'refine', 'refine', 'render',
  ]);
});

test('still below target after two retries stops and reports face_share_limited evidence', async () => {
  const r1 = { left: 110, top: 150, width: 1100, height: 1500 };
  const r2 = { left: 220, top: 350, width: 807, height: 1100 };
  const result = await mockLoop({ regions: [r1, r2], maxRetries: 9 }).promise;
  assert.equal(result.retries, 2, 'public max is clamped to two retries');
  assert.equal(result.renderCount, 1);
  assert.equal(result.reachedTarget, false);
  assert.equal(result.limited, true);
  assert.equal(result.reason, 'max-retries');
});

test('geometry/stretch cap stops before an unsafe re-render and marks the result limited', async () => {
  const unsafe = { left: 385, top: 325, width: 549, height: 749 }; // 660/549 and 900/749 both exceed 1.2
  const mock = mockLoop({ regions: [unsafe] });
  const result = await mock.promise;
  assert.equal(result.retries, 0);
  assert.equal(result.renderCount, 1);
  assert.equal(result.reason, 'stretch-cap');
  assert.equal(result.limited, true);
  assert.deepEqual(mock.events.map((event) => event.split(':')[0]), ['refine', 'render']);
});

test('current head padding reaches target 0.36 but reports pad-ceiling for an override above its geometric limit', async () => {
  const common = {
    region: { ...BASE_REGION },
    faceBox: { ...BASE_FACE },
    imgW: 1320,
    imgH: 1800,
    slotAspect: SLOT_ASPECT,
    slotH: SLOT_H,
    floorFrac: 0.30,
    maxFaceHFrac: HERO_CROP.maxFaceHFrac,
    render: async (region, attempt) => ({ region, attempt }),
  };
  const reachable = await runHeroFaceShareLoop({ ...common, targetFrac: 0.36 });
  assert.equal(reachable.reachedTarget, true);
  assert.equal(reachable.limited, false);
  assert.equal(reachable.reason, 'target-reached');

  const abovePadCeiling = await runHeroFaceShareLoop({ ...common, targetFrac: 0.44 });
  assert.equal(abovePadCeiling.reachedTarget, false);
  assert.equal(abovePadCeiling.limited, true);
  assert.equal(abovePadCeiling.reason, 'pad-ceiling');
  assert.equal(abovePadCeiling.retries, 1, 'รู้เพดานแล้วต้องไม่วน refine ซ้ำ');
});

test('default geometry keeps approximate head+shoulders and never exceeds HERO_STRETCH_MAX=1.2', async () => {
  const imgW = 2400;
  const imgH = 3000;
  const faceBox = { x1: 0.46, y1: 0.26, x2: 0.54, y2: 0.34 };
  const region = { left: 100, top: 0, width: 2200, height: 3000 };
  const rawFaceH = (faceBox.y2 - faceBox.y1) * imgH;
  const result = await runHeroFaceShareLoop({
    region,
    faceBox,
    imgW,
    imgH,
    slotAspect: SLOT_ASPECT,
    slotH: SLOT_H,
    floorFrac: 0.30,
    targetFrac: 0.36,
    maxFaceHFrac: HERO_CROP.maxFaceHFrac,
    render: async (r, attempt) => ({ r, attempt }),
  });
  const upscale = Math.max(SLOT_W / result.region.width, SLOT_H / result.region.height);
  assert.ok(upscale <= HERO_STRETCH_MAX + 1e-9, `upscale=${upscale}`);
  assert.equal(result.limited, true, 'small source face reaches the 1.2 cap before target');
  assert.ok(result.region.height >= rawFaceH * (1 + 0.42 + 0.60) - 1, 'vertical head+shoulder padding remains inside');
  assert.ok(result.region.width >= (faceBox.x2 - faceBox.x1) * imgW * (1 + 2 * 0.35) - 1, 'horizontal shoulder padding remains inside');
});

test('unmeasured geometry renders once; render failures remain real failures for executeCover to fail-open', async () => {
  const unmeasured = await runHeroFaceShareLoop({
    region: { ...BASE_REGION },
    render: async () => Buffer.from('rendered'),
  });
  assert.equal(unmeasured.reason, 'unmeasured');
  assert.equal(unmeasured.renderCount, 1);
  assert.equal(unmeasured.limited, false);

  await assert.rejects(
    runHeroFaceShareLoop({
      region: { ...BASE_REGION },
      render: async () => { throw new Error('render-failed'); },
    }),
    /render-failed/,
  );
});

test('invalid coordinator contracts fail explicitly rather than fabricating a pass', async () => {
  await assert.rejects(runHeroFaceShareLoop({ region: { ...BASE_REGION } }), TypeError);
  await assert.rejects(runHeroFaceShareLoop({
    region: { ...BASE_REGION },
    floorFrac: 0.50,
    targetFrac: 0.40,
    render: async () => Buffer.alloc(1),
  }), RangeError);
});

test('zoom helper optional parameters preserve its legacy defaults byte-for-byte', () => {
  const common = {
    region: { ...BASE_REGION },
    faceBox: { ...BASE_FACE },
    imgW: 1320,
    imgH: 1800,
    slotAspect: SLOT_ASPECT,
    slotH: SLOT_H,
    bandMinFrac: 0.36,
    maxFaceHFrac: HERO_CROP.maxFaceHFrac,
  };
  assert.deepEqual(
    zoomHeroRegionForFaceShare(common),
    zoomHeroRegionForFaceShare({ ...common, stretchCap: HERO_STRETCH_MAX, headFitClamp: false }),
  );
});

test("kill-switch is default ON and only the exact value '0' restores the legacy path", async () => {
  for (const value of [undefined, '1', 'true', '', 'off']) {
    // Environment mutations are intentionally serialized to prevent test leakage.
    // eslint-disable-next-line no-await-in-loop
    await withEnv({ MEGA_FACE_SHARE_LOOP: value }, () => {
      assert.equal(_faceShareLoopOn(), true, `value=${JSON.stringify(value)}`);
    });
  }
  await withEnv({ MEGA_FACE_SHARE_LOOP: '0' }, () => assert.equal(_faceShareLoopOn(), false));
});

test('env defaults are floor=0.30/target=0.36; valid overrides work, warnings are once/process, retries stay bounded', async () => {
  const cleanEnv = {
    MEGA_HERO_SHARE_FLOOR: undefined,
    MEGA_FACE_SHARE_FLOOR: undefined,
    MEGA_HERO_SHARE_TARGET: undefined,
    MEGA_FACE_SHARE_TARGET: undefined,
    MEGA_HERO_SHARE_ROUNDS: undefined,
  };
  await withEnv(cleanEnv, () => {
    assert.deepEqual(_heroShareTargetPct(), [30, 36]);
    assert.equal(_heroShareRounds(), 2);
  });
  await withEnv({
    ...cleanEnv,
    MEGA_HERO_SHARE_FLOOR: '0.32',
    MEGA_HERO_SHARE_TARGET: '0.48',
    MEGA_HERO_SHARE_ROUNDS: '1',
  }, () => {
    assert.deepEqual(_heroShareTargetPct(), [32, 48]);
    assert.equal(_heroShareRounds(), 1);
  });
  await withEnv({
    ...cleanEnv,
    MEGA_FACE_SHARE_FLOOR: '0.31',
    MEGA_FACE_SHARE_TARGET: '0.45',
    MEGA_HERO_SHARE_ROUNDS: '3',
  }, () => {
    assert.deepEqual(_heroShareTargetPct(), [31, 45]);
    assert.equal(_heroShareRounds(), 2, 'legacy env value 3 is capped at two');
  });
  await withEnv({
    ...cleanEnv,
    MEGA_HERO_SHARE_FLOOR: 'bad',
    MEGA_HERO_SHARE_TARGET: '2',
  }, () => {
    const oldWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      assert.deepEqual(_heroShareTargetPct(), [30, 36]);
      assert.deepEqual(_heroShareTargetPct(), [30, 36], 'เรียกซ้ำยังคืน fallback เดิม');
    } finally {
      console.warn = oldWarn;
    }
    assert.equal(warnings.length, 1, 'invalid env ต้องเตือนครั้งเดียวต่อโปรเซส');
  });
  await withEnv({
    ...cleanEnv,
    MEGA_HERO_SHARE_FLOOR: '0.95',
    MEGA_HERO_SHARE_TARGET: '0.97',
  }, () => {
    const oldWarn = console.warn;
    console.warn = () => {};
    try {
      assert.deepEqual(_heroShareTargetPct(), [90, 97], 'floor is capped at 0.90');
    } finally {
      console.warn = oldWarn;
    }
  });
  await withEnv({
    ...cleanEnv,
    MEGA_HERO_SHARE_FLOOR: '0.80',
    MEGA_HERO_SHARE_TARGET: '0.20',
  }, () => {
    const oldWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const [floor, target] = _heroShareTargetPct();
      assert.deepEqual([floor, target], [30, 36], 'inverted pair falls back to calibrated defaults');
      assert.ok(floor < target, 'helper must never expose floor >= target');
    } finally {
      console.warn = oldWarn;
    }
    assert.equal(warnings.length, 0, 'process นี้เตือนไปแล้ว จึงห้าม log ท่วมซ้ำ');
  });
});

async function runExecutor(loopValue, {
  meta = { width: 1200, height: 1600 },
  slot = { id: 'main', x: 0, y: 0, w: 660, h: 900, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' },
  faceBox = { x1: 0.35, y1: 0.20, x2: 0.65, y2: 0.50, count: 1, imgW: 1200, imgH: 1600 },
  crop = null,
} = {}) {
  return withEnv({
    MEGA_FACE_SHARE_LOOP: loopValue,
    MEGA_SECOND_EYE: '0',
  }, async () => {
    globalThis.__FACE_SHARE_SHARP_META = meta;
    globalThis.__FACE_SHARE_EXTRACTS = [];
    const traceSink = [];
    const output = await executeCover({
      assignments: [{ slotId: 'main', imageIndex: 0, crop }],
      imageBuffers: [{ buffer: Buffer.alloc(9001, 3) }],
      templateSpec: {
        id: 'face-share-parity',
        canvasW: slot.w,
        canvasH: slot.h,
        feather: 0,
        slots: [slot],
      },
      faceBoxes: [faceBox],
      traceSink,
    });
    const trace = traceSink.find((entry) => entry.slot === 'main');
    const extracts = globalThis.__FACE_SHARE_EXTRACTS.map((entry) => ({ ...entry }));
    delete globalThis.__FACE_SHARE_SHARP_META;
    delete globalThis.__FACE_SHARE_EXTRACTS;
    return { output, trace, extracts };
  });
}

test("executor parity: MEGA_FACE_SHARE_LOOP='0' performs the legacy single render with no loop trace", async () => {
  const legacy = await runExecutor('0');
  assert.ok(Buffer.isBuffer(legacy.output));
  assert.equal(legacy.extracts.length, 1, 'legacy path renders hero once');
  assert.equal(legacy.trace.faceShareLoop, undefined);
  assert.equal(legacy.trace.faceShareLimited, undefined);
  assert.ok(!legacy.trace.branch.includes('shareloop'));

  const enabledNoRetry = await runExecutor(undefined);
  assert.equal(enabledNoRetry.extracts.length, 1, 'above-floor enabled path reuses its first real render');
  assert.deepEqual(enabledNoRetry.trace.region, legacy.trace.region, 'no-retry feature path leaves legacy crop geometry unchanged');
  assert.equal(enabledNoRetry.trace.upscaleRaw, legacy.trace.upscaleRaw);
  assert.equal(enabledNoRetry.trace.faceShareLoop.retries, 0);
});

test('final-crop hero is trusted: low share is flagged but the crop is never changed or re-rendered', async () => {
  const crop = { x: 0, y: 0, w: 1, h: 1, _final: true };
  const faceBox = { x1: 0.35, y1: 0.20, x2: 0.65, y2: 0.45, count: 1, imgW: 1200, imgH: 1600 };
  const enabled = await runExecutor(undefined, { crop, faceBox });
  assert.equal(enabled.trace.branch, 'final-cropper');
  assert.equal(enabled.extracts.length, 1, 'Final-Cropper contract permits exactly one legacy render');
  assert.equal(enabled.trace.faceShareLoop.retries, 0);
  assert.equal(enabled.trace.faceShareLoop.reason, 'final-crop-locked');
  assert.match(enabled.trace.faceShareLimited, /^hero:[\d.]+:final-crop-locked$/);
  assert.ok(!enabled.trace.branch.includes('shareloop'));

  const legacy = await runExecutor('0', { crop, faceBox });
  assert.equal(legacy.extracts.length, 1);
  assert.equal(legacy.trace.faceShareLoop, undefined);
  assert.equal(legacy.trace.faceShareLimited, undefined);
  assert.equal(legacy.trace.branch, 'final-cropper');
});

test('normal renderer keeps its effective cap; the share loop never tightens an already >1.2 crop and emits limited evidence', async () => {
  const largest = { x1: 0.42, y1: 0.30, x2: 0.58, y2: 0.40 };
  const second = { x1: 0.02, y1: 0.05, x2: 0.10, y2: 0.13 };
  const result = await runExecutor(undefined, {
    meta: { width: 1200, height: 2727 },
    slot: { id: 'main', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: null, borderWidth: 0, shape: 'rect' },
    faceBox: {
      ...largest,
      count: 2,
      allFaces: [largest, second],
      imgW: 1200,
      imgH: 2727,
    },
  });
  assert.ok(result.trace.upscaleRaw > HERO_STRETCH_MAX + 1e-9, 'face-share must not drag the normal renderer down to 1.2');
  assert.ok(result.trace.upscaleRaw <= _heroUpscaleMaxEffExec() + 1e-9);
  assert.ok(result.trace.faceShareLoop.pct < result.trace.faceShareLoop.target);
  assert.match(result.trace.faceShareLimited, /^hero:[\d.]+:stretch-cap$/);

  const composerSource = await readFile(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');
  assert.match(
    composerSource,
    /face_share_limited:\$\{tt\.faceShareLimited\}/,
    'composer must translate executor evidence without duplicating the hero/slot prefix',
  );
  assert.doesNotMatch(composerSource, /face_share_limited:\$\{tt\.slot\}:\$\{tt\.faceShareLimited\}/);
});

test('executeCover fail-opens to one legacy render and leaves a warning flag when the loop render throws', async () => {
  globalThis.__FACE_SHARE_THROW_ONCE = true;
  const result = await runExecutor(undefined, {
    faceBox: { x1: 0.42, y1: 0.20, x2: 0.58, y2: 0.34, count: 1, imgW: 1200, imgH: 1600 },
  });
  delete globalThis.__FACE_SHARE_THROW_ONCE;
  assert.ok(Buffer.isBuffer(result.output));
  assert.equal(result.extracts.length, 1, 'failed loop render is discarded; fallback performs one successful legacy render');
  assert.equal(result.trace.faceShareLoop, undefined);
  assert.equal(result.trace.faceShareLoopWarn, 'legacy-fallback');
});
