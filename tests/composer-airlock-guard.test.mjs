// ============================================================
// composer-airlock-guard.test.mjs — เกราะภาพพิษชั้น composer
// ------------------------------------------------------------
// พิสูจน์ทั้ง source wiring และ integration แบบ offline:
// - ปิด MEGA_IMG_AIRLOCK=0 → strict ใช้ fetchOne เดิมและไม่เรียก batch
// - เปิด → fetch URL ละครั้ง, batch ครั้งเดียว, ผลกลับสลับลำดับก็ map ด้วย String(index) ถูกใบ
// - child crash จริงผ่าน _workerPath → strict fail-closed / legacy ข้ามใบพิษและยังประกอบต่อได้
// - batch throw → ห้าม fallback ไป refetch raw bytes
// ============================================================
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const COMPOSER_URL = new URL('../src/lib/services/megaComposerService.js', import.meta.url);
const REAL_AIRLOCK_URL = new URL('../src/lib/imgAirlock.js', import.meta.url).href;
const CRASH_WORKER_PATH = fileURLToPath(new URL('./fixtures/img-airlock-crash-worker.mjs', import.meta.url));
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const source = readFileSync(COMPOSER_URL, 'utf8');
const _mod = (body) => `data:text/javascript,${encodeURIComponent(body)}`;
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `ไม่พบ source marker เริ่ม: ${startMarker}`);
  assert.ok(end > start, `ไม่พบ source marker จบ: ${endMarker}`);
  return source.slice(start, end);
}

// Stub เฉพาะ import ของ composer: ภายในยังเรียก runAirlockBatch จริง พร้อม crash-worker จริง
// แต่ worker fixture คืน dummy bytes สำหรับใบดี จึงคืน raw fixture เดิมแทน clean bytes เพื่อให้ sharp
// ของ composer เดินต่อได้; จุดที่พิสูจน์ตรงนี้คือ isolation/crash/result mapping ไม่ใช่ codec (codec มีเทสแยก)
const AIRLOCK_STUB = _mod(`
import { runAirlockBatch as realRunAirlockBatch } from ${JSON.stringify(REAL_AIRLOCK_URL)};

export function airlockOn() {
  return process.env.MEGA_IMG_AIRLOCK !== '0';
}

export async function runAirlockBatch(items) {
  globalThis.__composerAirlockBatches.push(items.map((it) => ({ id: String(it.id), size: it.buf.length })));
  if (globalThis.__composerAirlockThrow) throw new Error('SIMULATED_BATCH_FAILURE');

  const poisonId = globalThis.__composerAirlockPoisonId;
  const originalByWireId = new Map();
  const wireItems = items.map((it) => {
    const originalId = String(it.id);
    const wireId = poisonId != null && originalId === String(poisonId)
      ? 'POISON-' + originalId
      : 'SAFE-' + originalId;
    originalByWireId.set(wireId, { id: originalId, buf: it.buf });
    return { id: wireId, buf: it.buf };
  });
  const wireResults = await realRunAirlockBatch(wireItems, {
    _workerPath: ${JSON.stringify(CRASH_WORKER_PATH)},
    timeoutMs: 5000,
  });
  // จงใจ reverse เพื่อจับ implementation ที่ผูกผลด้วยลำดับตอบแทน id
  return wireResults.map((r) => {
    const original = originalByWireId.get(String(r.id));
    if (!original) return { id: 'UNKNOWN', ok: false, error: 'test_mapping_missing' };
    return r.ok
      ? { ...r, id: original.id, buf: original.buf }
      : { ...r, id: original.id };
  }).reverse();
}
`);

const FACE_DETECTOR_STUB = _mod(`
import { createHash } from 'node:crypto';
export async function batchDetectFaces(items) {
  globalThis.__composerFaceBatches.push(items.map((it) =>
    createHash('sha1').update(it.buffer).digest('hex')
  ));
  return new Map();
}
`);

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/imgAirlock') {
    return { url: ${JSON.stringify(AIRLOCK_STUB)}, shortCircuit: true };
  }
  if (specifier === '@/lib/services/faceDetector') {
    return { url: ${JSON.stringify(FACE_DETECTOR_STUB)}, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const mapped = new URL(
      specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'),
      ${JSON.stringify(SRC_ROOT)}
    ).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const ENV_KEYS = [
  'MEGA_IMG_AIRLOCK',
  'MEGA_STRICT_RENDER',
  'MEGA_COVER_TESTER',
  'MEGA_CIRCLE_LABEL',
  'MEGA_SCENE_DEDUP',
];
const envBefore = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const fetchBefore = globalThis.fetch;

process.env.MEGA_COVER_TESTER = '0';
process.env.MEGA_CIRCLE_LABEL = '0';
process.env.MEGA_SCENE_DEDUP = '0';

const fixtureBuffers = await Promise.all([0, 1, 2, 3, 4].map((i) => sharp({
  create: {
    width: 800,
    height: 1000,
    channels: 3,
    noise: { type: 'gaussian', mean: 95 + i * 35, sigma: 28 },
  },
}).jpeg({ quality: 90 }).toBuffer()));
for (const buf of fixtureBuffers) assert.ok(buf.length > 5000, `fixture ต้อง >5000 bytes (ได้ ${buf.length})`);

const urls = fixtureBuffers.map((_, i) => `https://composer-airlock.test/${i}.jpg`);
const strictUrls = urls.slice(0, 4);
const imageByUrl = new Map(urls.map((url, i) => [url, fixtureBuffers[i]]));
const fetchCounts = new Map();
globalThis.fetch = async (input) => {
  const url = String(input);
  fetchCounts.set(url, (fetchCounts.get(url) || 0) + 1);
  const buf = imageByUrl.get(url);
  if (!buf) throw new Error(`NETWORK_FORBIDDEN_OR_UNKNOWN_FIXTURE:${url}`);
  return {
    ok: true,
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : null },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

after(() => {
  globalThis.fetch = fetchBefore;
  for (const [key, value] of envBefore) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete globalThis.__composerAirlockBatches;
  delete globalThis.__composerAirlockPoisonId;
  delete globalThis.__composerAirlockThrow;
  delete globalThis.__composerFaceBatches;
});

const { composeAndVerify } = await import(COMPOSER_URL.href);

function resetHarness({ poisonId = null, throwBatch = false } = {}) {
  fetchCounts.clear();
  globalThis.__composerAirlockBatches = [];
  globalThis.__composerAirlockPoisonId = poisonId;
  globalThis.__composerAirlockThrow = throwBatch;
  globalThis.__composerFaceBatches = [];
}

function assertFetchedOnceEach(expectedUrls = urls) {
  assert.equal(fetchCounts.size, expectedUrls.length, 'ต้อง fetch ครบ URL fixture ที่ path นี้ใช้');
  for (const url of expectedUrls) assert.equal(fetchCounts.get(url), 1, `${url} ต้อง fetch ครั้งเดียว`);
}

function legacyArgs() {
  return {
    newsTitle: 'composer airlock guard',
    refDNA: null,
    refImagePath: null,
    stableOrder: true,
    slotPlan: urls.map((url, i) => ({
      url,
      thumbnailUrl: '',
      isHero: i === 0,
      person: null,
      clean: true,
      newsScene: true,
      faces: 0,
      slot: null,
    })),
  };
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (`0000000${h.toString(16)}`).slice(-8);
}

function strictArgs() {
  const refId = 'TESTREF-composer-airlock';
  const meta = [
    { refSlotId: 'r_main', composerSlotId: 'main', shape: 'rect' },
    { refSlotId: 'r_top', composerSlotId: 'right_top', shape: 'rect' },
    { refSlotId: 'r_bottom', composerSlotId: 'right_bottom', shape: 'rect' },
    { refSlotId: 'r_circle', composerSlotId: 'circle', shape: 'circle' },
  ];
  const specSlots = meta.map((s, i) => ({
    mappingMode: 'ref_slot_exact',
    refSlotId: s.refSlotId,
    composerSlotId: s.composerSlotId,
    shape: s.shape,
    primary: { candidateId: `cand_${i}`, imageUrl: strictUrls[i] },
    backups: [],
  }));
  const identity = specSlots.map((s) => [s.refSlotId, s.composerSlotId, s.primary.candidateId]);
  const specHash = fnv1a32(JSON.stringify({ refId, identity }));
  const backupPoolHash = fnv1a32(JSON.stringify(specSlots.map((s) => [s.refSlotId, []])));
  const replayHash = fnv1a32(JSON.stringify({
    refId,
    identity,
    urls: specSlots.map((s) => s.primary.imageUrl),
    backups: specSlots.map((s) => [s.refSlotId, []]),
  }));
  const selectionSpec = {
    v: 1,
    mode: 'ref_slot_exact',
    source: 'template.slots',
    refId,
    strictReady: true,
    slots: specSlots,
    specHash,
    backupPoolHash,
    replayHash,
    counts: {
      total: 4,
      mapped: 4,
      unmapped: 0,
      missingPrimary: 0,
      duplicatePrimary: 0,
      duplicatePrimaryUrl: 0,
      semanticFallback: 0,
    },
    diagnostics: {
      extraPlannedKeys: [],
      invalidPrimary: [],
      aliasPrimaryUrls: [],
      duplicateBackupsDropped: [],
    },
  };
  const realizedTemplate = {
    id: 'strict_composer_airlock_tpl',
    canvasW: 1080,
    canvasH: 1350,
    slots: [
      { id: 'main', x: 0, y: 0, w: 616, h: 1350 },
      { id: 'right_top', x: 616, y: 0, w: 464, h: 540 },
      { id: 'right_bottom', x: 616, y: 540, w: 464, h: 810 },
      { id: 'circle', x: 34, y: 940, w: 380, h: 380, shape: 'circle' },
    ],
  };
  const slotPlan = specSlots.map((s) => ({
    url: s.primary.imageUrl,
    refSlotId: s.refSlotId,
    thumbnailUrl: '',
    person: null,
    clean: true,
    newsScene: true,
    faces: 0,
  }));
  return { newsTitle: 'strict composer airlock guard', selectionSpec, realizedTemplate, slotPlan };
}

await test('composer airlock guard: source + switch + mapping + crash containment', async (t) => {
  await t.test('source wiring: import, shared fail-closed mapper, strict+legacy switch gates และ String(index) ตรงกัน', () => {
    assert.match(source, /import \{ runAirlockBatch, airlockOn \} from '@\/lib\/imgAirlock';/);

    const helper = section('async function cleanComposerBatchById(', '// ---------- ✂️ สูตรครอป');
    assert.match(helper, /await runAirlockBatch\(rawItems, \{\}\)/, 'ต้องส่งทั้ง batch ครั้งเดียว');
    assert.match(helper, /new Map\(cleaned\.map\(\(r\) => \[String\(r\.id\), r\]\)\)/, 'ผลต้อง map ด้วย string id');
    assert.match(helper, /catch \(e\)[\s\S]*return new Map\(\)/, 'batch throw ต้อง fail-closed เป็น Map ว่าง');

    const strict = section('async function composeCoreStrict(', 'function _strictDriftCheck(');
    assert.match(strict, /if \(airlockOn\(\)\)/, 'strict ต้อง switch-gated');
    assert.match(strict, /rawItems\.push\(\{ id: String\(i\), buf: raw \}\)/, 'strict prefetch id ต้องใช้ bind index');
    assert.match(strict, /cleanComposerBatchById\(rawItems, 'strict'\)/);
    assert.match(strict, /cleanByIndex\.get\(String\(i\)\)/, 'strict lookup ต้องใช้ index เดียวกัน');
    assert.match(strict, /else \{\s*buf = await fetchOne\(b\.imageUrl\)/, 'สวิตช์ปิดต้องเหลือ strict fetchOne path เดิม');

    const legacy = section('async function composeCore({', 'async function refCompareEye(');
    assert.match(legacy, /if \(airlockOn\(\)\)/, 'legacy/V1 ต้องมีเกราะด้วย');
    assert.match(legacy, /rawItems\.push\(\{ id: String\(i\), buf: raw \}\)/, 'legacy prefetch id ต้องใช้ slotPlan index');
    assert.match(legacy, /cleanComposerBatchById\(rawItems, 'legacy'\)/);
    assert.match(legacy, /cleanByIndex\.get\(String\(_i\)\)/, 'legacy lookup ต้องใช้ index เดียวกัน');
    assert.match(legacy, /else \{\s*buf = await fetchOne\(p\.url\)/, 'สวิตช์ปิดต้องเหลือ legacy fetchOne path เดิม');
  });

  await t.test('MEGA_IMG_AIRLOCK=0: strict ใช้ fetchOne เดิม URL ละครั้ง และไม่เรียก runAirlockBatch', async () => {
    process.env.MEGA_IMG_AIRLOCK = '0';
    process.env.MEGA_STRICT_RENDER = '1';
    resetHarness();
    const out = await composeAndVerify(strictArgs());
    assert.equal(out.success, true, `strict switch-off ต้องสำเร็จ: ${out.error || '-'}`);
    assert.equal(globalThis.__composerAirlockBatches.length, 0, 'ปิดสวิตช์ต้องไม่เรียก batch');
    assertFetchedOnceEach(strictUrls);
  });

  await t.test('เปิด strict: prefetch ครั้งเดียว + batch เดียว + ผล reverse ยังส่ง clean buffer ถูก index', async () => {
    process.env.MEGA_IMG_AIRLOCK = '1';
    process.env.MEGA_STRICT_RENDER = '1';
    resetHarness();
    const out = await composeAndVerify(strictArgs());
    assert.equal(out.success, true, `strict airlock-on ต้องสำเร็จ: ${out.error || '-'}`);
    assert.equal(globalThis.__composerAirlockBatches.length, 1, 'ต้อง batch ครั้งเดียว');
    assert.deepEqual(globalThis.__composerAirlockBatches[0].map((x) => x.id), ['0', '1', '2', '3']);
    assertFetchedOnceEach(strictUrls);
    assert.deepEqual(
      globalThis.__composerFaceBatches[0],
      fixtureBuffers.slice(0, 4).map(sha1),
      'แม้ airlock ตอบ reverse ลำดับ buffer ที่ถึง sharp/face path ต้องยังตรง bind index ทุกใบ',
    );
  });

  await t.test('strict poison: crash-worker ตายจริง → primary_poison + STRICT_PRIMARY_UNAVAILABLE ไม่ crash parent', async () => {
    process.env.MEGA_IMG_AIRLOCK = '1';
    process.env.MEGA_STRICT_RENDER = '1';
    resetHarness({ poisonId: '1' });
    const out = await composeAndVerify(strictArgs());
    assert.equal(out.success, false);
    assert.equal(out.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
    assert.ok(out.reasons?.includes('primary_poison:right_top'), JSON.stringify(out.reasons));
    assert.equal(globalThis.__composerAirlockBatches.length, 1);
    assert.equal(globalThis.__composerFaceBatches.length, 0, 'strict ต้องหยุดก่อน sharp/face path เมื่อ primary มีพิษ');
    assertFetchedOnceEach(strictUrls);
  });

  await t.test('strict batch throw: fail-closed ห้าม refetch raw หรือ fallback เข้า parent', async () => {
    process.env.MEGA_IMG_AIRLOCK = '1';
    process.env.MEGA_STRICT_RENDER = '1';
    resetHarness({ throwBatch: true });
    const out = await composeAndVerify(strictArgs());
    assert.equal(out.success, false);
    assert.equal(out.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
    assert.equal(globalThis.__composerAirlockBatches.length, 1);
    assert.equal(globalThis.__composerFaceBatches.length, 0);
    assertFetchedOnceEach(strictUrls); // ถ้า fallback raw แบบเดิมจะกลายเป็น 2 ครั้ง/URL และ compose ผ่าน
  });

  await t.test('legacy/V1 reachable: crash-worker ตัดใบพิษ แล้ว compose ต่อด้วย 4 ใบสะอาดโดยไม่ fetch ซ้ำ', async () => {
    process.env.MEGA_IMG_AIRLOCK = '1';
    delete process.env.MEGA_STRICT_RENDER;
    resetHarness({ poisonId: '1' });
    const out = await composeAndVerify(legacyArgs());
    assert.equal(out.success, true, `legacy ต้องข้ามพิษแล้ว compose ต่อได้: ${out.error || '-'}`);
    assert.equal(globalThis.__composerAirlockBatches.length, 1);
    assertFetchedOnceEach();
    assert.deepEqual(
      globalThis.__composerFaceBatches[0],
      [fixtureBuffers[0], fixtureBuffers[2], fixtureBuffers[3], fixtureBuffers[4]].map(sha1),
      'legacy stableOrder ต้องส่งเฉพาะใบดีและคง index order เดิม',
    );
    assert.ok(out.crops.every((crop) => crop.url !== urls[1]), 'ภาพพิษห้ามปรากฏในช่องที่เรนเดอร์');
  });
});
