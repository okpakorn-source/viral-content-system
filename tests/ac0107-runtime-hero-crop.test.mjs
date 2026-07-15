// ============================================================
// 🧪 AC-0107 RUNTIME-BOUND HERO CROP PROOF — real strict V2 consumer/executor seam
// ------------------------------------------------------------
// The pre-carrier eligibility gate (megaAdapters _runRefHeroV2) filters candidates from STORED evidence and is only a
// NECESSARY filter — it cannot see the Final-Cropper / watermark-dodge / fresh-detector geometry of the ACTUAL render.
// The AUTHORITATIVE ≤1.2× proof lives in composeAndVerify: after Eye/FinalCrop, it reads the executor's MEASURED upscale
// for the CANONICAL hero slot (heroComposerSlotId) from the final cropTrace and fails TYPED (STRICT_V2_HERO_CROP_UNSAFE)
// before any manifest/persist/archive when the real hero crop > 1.2 — or cannot be measured.
//
// This harness proves the CONSUMER seam + the gate DECISION through the GENUINE carrier: a REAL four-foundation V2
// carrier (real s6_slots → real s7_cover wire), fed to the REAL composeAndVerify, with a stub executor whose measured
// hero upscaleRaw is INJECTED so the gate's decision is exercised on a KNOWN value. The injected number stands in for
// "whatever the render measured" — it does NOT prove the renderer's FinalCrop/dodge/decoded-dim geometry. That real
// crop math (and that it produces exactly this trace shape) is proven separately by tests/ac0107-executor-geometry.test.mjs,
// which runs the REAL executeCover; the two halves meet at the shared trace schema (own primitive slot + own finite
// positive upscaleRaw) pinned in both. No sharp/LLM/net.
//   1) hero rendered ≤1.2  ⇒ success (must not over-reject the healthy case)
//   2) hero rendered >1.2  ⇒ STRICT_V2_HERO_CROP_UNSAFE, success=false, no manifest/base64 (⇒ no persist/archive)
//   3) hero upscale unmeasurable / hostile trace shape ⇒ fail-closed same typed error (exactly-one own primitive raw)
//   4) the slot the proof binds to == the EXACT signed canonical hero composerSlotId (never a regex /main/)
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;

// sharp shim (behavioural, not native): metadata + raw for trimVividBorder/aHash. No real pixels decoded.
const SHARP_STUB = MOD(`
export default function sharp(buf){
  globalThis.__SHARP_CALLS = (globalThis.__SHARP_CALLS||0)+1;
  let sized = 0, extracted = false;
  const chain = {
    metadata: async () => ({ width: 1000, height: 1250 }),
    greyscale(){ return chain; }, resize(w){ sized = w; return chain; }, raw(){ return chain; },
    jpeg(){ return chain; }, extract(){ extracted = true; return chain; }, toColourspace(){ return chain; }, removeAlpha(){ return chain; },
    toBuffer: async () => {
      if (extracted) return Buffer.from(Array.from({ length: 4321 }, (_, i) => (i * 11 + 3) % 251));
      if (sized === 100) { const out = Buffer.alloc(30000); for (let i = 0; i < 30000; i++) out[i] = buf[(i * 13) % buf.length]; return out; }
      return Buffer.from(Array.from({ length: 64 }, (_, i) => buf[(i * 97) % buf.length]));
    },
  };
  return chain;
}`);
// executeCover stub: emits a cropTrace whose per-slot exact raw upscale is controllable (models the REAL executor's
// measured final-region upscale — see the SEPARATE real-executor geometry tests below for the actual crop math). The
// gate reads the EXACT own primitive \`upscaleRaw\`; \`upscale\` is the rounded advisory copy the real executor also emits.
// __UP_BY_SLOT[slot] overrides; __EXEC_UPSCALE is the default; __EXEC_NO_UPSCALE omits upscaleRaw (unmeasurable render);
// __TRACE_OVERRIDE(assignments) returns the ENTIRE traceSink verbatim (for P1-2 hostile/duplicate/accessor shapes).
const EXEC_STUB = MOD(`
export async function executeCover({ assignments, traceSink }){
  globalThis.__EXEC_CALLS = (globalThis.__EXEC_CALLS||0)+1;
  if (Array.isArray(traceSink)) {
    traceSink.length = 0;
    if (typeof globalThis.__TRACE_OVERRIDE === 'function') { traceSink.push(...globalThis.__TRACE_OVERRIDE(assignments)); }
    else {
      traceSink.push(...assignments.map((a) => {
        const e = { slot: a.slotId, branch: 'stub' };
        if (globalThis.__EXEC_NO_UPSCALE !== true) {
          const byslot = globalThis.__UP_BY_SLOT || {};
          const v = (a.slotId in byslot) ? byslot[a.slotId] : (globalThis.__EXEC_UPSCALE ?? 1.0);
          e.upscaleRaw = v;
          if (typeof v === 'number' && Number.isFinite(v)) e.upscale = +v.toFixed(2);
        }
        return e;
      }));
    }
  }
  return Buffer.alloc(9000, 7);
}
export const V3_TEMPLATES = {};`);
const FD_STUB = MOD(`
export async function batchDetectFaces(items){
  globalThis.__FD_CALLS = (globalThis.__FD_CALLS||0)+1;
  const m = new Map();
  items.forEach((it) => m.set(it.id, { imageWidth:1000, imageHeight:1250, hasFaces:true, faces:[{x:400,y:300,width:200,height:250}] }));
  return m;
}
export async function detectFaces(){ throw new Error('DETECTFACES_FORBIDDEN'); }`);
const OPENAI_BOMB = MOD(`export async function callAI(){ throw new Error('LLM_FORBIDDEN'); }`);
const DIRECTOR_BOMB = MOD(`export async function finalCrop(){ throw new Error('FINALCROP_FORBIDDEN'); }`);
const NEXT_STUB = MOD(`export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(NEXT_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/coverExecutorService') return { url: ${JSON.stringify(EXEC_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/faceDetector') return { url: ${JSON.stringify(FD_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(OPENAI_BOMB)}, shortCircuit: true };
  if (specifier === '@/lib/services/coverDirectorService') return { url: ${JSON.stringify(DIRECTOR_BOMB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { s6_slots, s7_cover, _dnaHashFor } = await import('../src/lib/megaAdapters.js');
const { composeAndVerify } = await import('../src/lib/services/megaComposerService.js');

// ── Date.now fixing (byte determinism) + env scoping ──
const REAL_NOW = Date.now;
const FIXED_TS = 1770000000000;
const withFixedNow = async (fn) => { Date.now = () => FIXED_TS; try { return await fn(); } finally { Date.now = REAL_NOW; } };
const withEnvMap = async (map, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(map)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const cloneJson = (v) => JSON.parse(JSON.stringify(v));

// ── real DNA from the tracked library (same record ac0084/ac0099 already prove valid) ──
const refs = JSON.parse(readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
const REF_REC = refs.find((r) => r.id === 'REF-mrbqalpo-h1r1');
assert.ok(REF_REC?.dna, 'fixture: ref DNA REF-mrbqalpo-h1r1 must exist');
const FIXTURE_DNA = REF_REC.dna;
const FIXTURE_REF_ID = REF_REC.id;
const FIXTURE_DNA_HASH = _dnaHashFor(FIXTURE_DNA);
const V2_ENV = { MEGA_REF_HERO_V2: '1', MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
const RH_EV = { identityConfidence: 0.9, faceShare: 0.15, headroom: 0.15, visibleBodyRegion: 'half_body', occlusion: 0.05, edgeCut: 0.02, cleanliness: 0.9 };
const RH_RD = { searched: true, triaged: true, clean: true, highResolution: true, cropSafe: true, identityVerified: true };
const RH_SC = { semanticScore: 700, qualityScore: 700, slotFitScore: 700 };
const SAFE_FB = { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 };  // big centred face ⇒ crop-safe for the real hero slot
const UNSAFE_FB = { x1: 0.46, y1: 0.46, x2: 0.54, y2: 0.54 }; // tiny face ⇒ hero crop >1.2× (no crop-safe hero)
const v2Img = (id, { person = null, sceneKey, faceBox = SAFE_FB } = {}) => ({
  id, imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '', source: 'SynthNews Desk', sourceLink: `https://source.test/${id}`,
  width: 900, height: 1200, realWidth: 900, realHeight: 1200,
  triage: { relevant: true, clean: true, faceCount: 1, person, persons: person ? [person] : [], category: 'face-emotional', emotion: 'warm', note: `${id} ${sceneKey}`, newsScene: true, quality: 8, realShortSide: 900, sharpness: 80, faceBox, ...RH_EV, ...RH_RD, ...RH_SC, sceneKey },
});
const V2_POOL = () => [
  v2Img('V-L1', { person: 'Lisa', sceneKey: 'sceneL' }), v2Img('V-N1', { person: 'Nene', sceneKey: 'sceneN' }),
  v2Img('V-C1', { person: 'Ctx1', sceneKey: 'sceneC1' }), v2Img('V-C2', { person: 'Ctx2', sceneKey: 'sceneC2' }), v2Img('V-C3', { person: 'Ctx3', sceneKey: 'sceneC3' }),
];
const V2_CHARS = [{ name: 'Lisa', role: 'hero' }, { name: 'Nene', role: 'reaction' }, { name: 'Ctx1', role: 'context' }, { name: 'Ctx2', role: 'context' }, { name: 'Ctx3', role: 'context' }];
const V2_PICKS = { hero: { id: 'V-L1', reason: 'x', backups: [] }, context: { id: 'V-C1', reason: 'x', backups: [] }, action: { id: 'V-C2', reason: 'x', backups: [] }, moment: { id: 'V-C3', reason: 'x', backups: [] }, reaction: { id: 'V-N1', reason: 'x', backups: [] } };
const mkRefMatch = () => ({ dna: FIXTURE_DNA, styleName: 'v2-fixture', typeMatched: true, imagePath: '/ref-covers/v2-fixture.jpg', refId: FIXTURE_REF_ID, dnaHash: FIXTURE_DNA_HASH, refBoundAt: new Date(FIXED_TS).toISOString() });
const mkS6Deps = () => ({
  slotDirectorBrain: async () => ({ slots: V2_PICKS, note: 'v2-fixture' }),
  artBriefBrain: async () => { throw new Error('artBrief must be pre-set'); },
  fetchJson: async (url) => { if (String(url).includes('/api/images/')) return { success: true, images: V2_POOL() }; throw new Error('unexpected fetch ' + url); },
});

// ── Batch 4B quarantine: producer HOLD จนกว่ามี readiness producer จริง — เคาะ Option B 15 ก.ค. 69 ──
//   ท่อ V2 ON เดินสาย real four-foundation producer แล้ว fail-closed เป็น typed HOLD ก่อนถึง S7/composer:
//   identity/crop verifier ยังไม่มีในระบบ (Batch 4A/4B audit ⇒ _rhCastCandidate hardcode cropSafe/identityVerified=false,
//   _rhHeroCandidate คืน null) ⇒ ไม่มี carrier ให้ composeAndVerify. เดิมไฟล์นี้สร้าง carrier จริง (s6 status 'done',
//   refHeroV2.ok===true) แล้วพิสูจน์ crop gate ≤1.2× ที่ consumer — ดีไซน์เก่าก่อนกักกัน. ตอนนี้ผล ON ที่ถูกต้องคือ
//   waiting + typed HOLD (crop gate เป็น unreachable จนกว่ามี readiness producer จริง). converge สไตล์ batch3/batch4:
//   (ก) ON ⇒ waiting + REF_HERO_V2_INSUFFICIENT_CAST_ASSETS ก่อน brain · (ข) OFF ⇒ ไม่มี refHeroV2 key (additive-only).
const { buildCandidateFactsV1 } = await import('../src/lib/candidateFactAuthority.js');
const { buildImagesRouteResponse } = await import('../src/lib/imageStore.js');
const RT_CASE = 'AC0107-RT';
const RT_OFF = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' }; // semantic ON but ref-hero-v2 OFF
const rtFacts = () => buildCandidateFactsV1({
  verdicts: { relevant: true, clean: true, newsScene: true },
  resolution: { decodedBuffer: true, provenance: 'full', width: 1000, height: 1400 },
  faceBox: { x: 0.30, y: 0.12, w: 0.40, h: 0.48 },
});
// snapshot rows carrying genuine validated candidateFacts (the real image-store authority the V2 producer consumes)
const rtRows = () => V2_CHARS.map(({ name }, i) => {
  const id = ['V-L1', 'V-N1', 'V-C1', 'V-C2', 'V-C3'][i];
  return {
    id, caseId: RT_CASE, platform: 'google', imageUrl: `https://cdn.test/${id}.jpg`, thumbnailUrl: '',
    source: 'SynthNews Desk', sourceLink: `https://source.test/${id}`,
    width: 900, height: 1200, realWidth: 900, realHeight: 1200,
    triage: { relevant: true, clean: true, newsScene: true, person: name, persons: [name], faceCount: 1, faceBox: { x1: 0.30, y1: 0.12, x2: 0.70, y2: 0.60 }, candidateFacts: rtFacts() },
  };
});
const rtShadow = (ids) => ({ version: 2, totalCandidates: ids.length, emittedCandidates: ids.length, truncatedCandidates: 0, capped: false, candidates: ids.map((candidateId, index) => ({ candidateId, provider: 'google', queryIndex: 0, providerRank: index + 1 })) });
const rtAuthResponse = async (rows) => {
  const snapshot = { scope: 'case_image_store_snapshot_v1', caseId: RT_CASE, complete: true, truncated: false, count: rows.length, rows };
  const response = await buildImagesRouteResponse(RT_CASE, '1', { readImagesSnapshot: async (cid) => { if (cid !== RT_CASE) throw new Error('unexpected case'); return snapshot; } });
  if (response.status !== 200 || response.body?.success !== true) throw new Error('AC0107 authority fixture failed');
  return response;
};
const rtHoldJob = (rows) => ({ id: 'AC0107-RT-JOB', dossier: {
  images: { caseId: RT_CASE, searchStats: [{ platform: 'google', found: rows.length, added: rows.length, searchShadowV2: rtShadow(rows.map((r) => r.id)) }] },
  compass: { angle: 'มุมทดสอบ runtime-hero-crop', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: V2_CHARS, visualDreamShots: [], doNotUse: [] },
  desk: { title: 'ข่าวทดสอบ runtime hero crop' }, refMatch: mkRefMatch(), artBrief: { storyNote: 'เรื่องทดสอบ', orders: [] },
} });
// ON path: real four-foundation producer via the in-process image-store authority ⇒ typed HOLD before the brain.
const rtOnHold = async (rows = rtRows()) => {
  const response = await rtAuthResponse(rows);
  const captures = { brainArgs: [] };
  const s6 = await withEnvMap(V2_ENV, () => withFixedNow(() => s6_slots(rtHoldJob(rows), { origin: 'http://mock', _deps: {
    readImagesAuthority: async (cid) => { if (cid !== RT_CASE) throw new Error('unexpected authority case'); return response; },
    slotDirectorBrain: async (a) => { captures.brainArgs.push(a); throw new Error('brain must not run on a typed V2 HOLD'); },
  } })));
  return { s6, captures };
};

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n  ')}`); } };

await test('0) flag OFF ⇒ no refHeroV2 key (additive-only; the V2 producer adds nothing when unset)', async () => {
  const s6 = await withEnvMap(RT_OFF, () => withFixedNow(() => s6_slots(rtHoldJob(rtRows()), { origin: 'http://mock', _deps: mkS6Deps() })));
  assert.strictEqual(s6.status, 'done', 'OFF: semantic-only pipeline completes unchanged');
  assert.ok(!('refHeroV2' in s6.dossierPatch.pickImages), 'OFF: pickImages has no refHeroV2 key');
});

await test('1) flag ON ⇒ real four-foundation producer fail-closes to a typed HOLD before the brain (Batch 4B quarantine)', async () => {
  const { s6, captures } = await rtOnHold();
  assert.strictEqual(s6.status, 'waiting', 'ON: producer fail-closes (no crop/identity verifier ⇒ cast HOLD)');
  assert.deepStrictEqual(s6.dossierPatch?.pickImages?.refHeroV2, { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
  assert.strictEqual(captures.brainArgs.length, 0, 'brain NOT called on a typed HOLD (pre-brain sentinel)');
});

await test('2) the typed HOLD is deterministic under input reordering (no positional/order dependence)', async () => {
  const a = (await rtOnHold(rtRows())).s6.dossierPatch?.pickImages?.refHeroV2;
  const b = (await rtOnHold(rtRows().reverse())).s6.dossierPatch?.pickImages?.refHeroV2;
  assert.deepStrictEqual(a, b, 'row order cannot alter the typed hold');
  assert.deepStrictEqual(a, { v: 1, ok: false, hold: 'REF_HERO_V2_INSUFFICIENT_CAST_ASSETS' });
});

console.log(`\n# ac0107-runtime-hero-crop: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
