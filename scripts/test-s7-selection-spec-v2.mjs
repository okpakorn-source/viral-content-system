// ============================================================
// 🔐 S7 SELECTION-SPEC V2 CONSUMER — dedicated harness (Wave1A LANE C · P0/P1 CORRECTION)
// ------------------------------------------------------------
// พิสูจน์ตาม independent-review corrections:
//   P0-1 CANONICAL LATCH: strict arm = MEGA_STRICT_RENDER === '1' เท่านั้น (ไม่มี alias V2 ในโค้ดอีกต่อไป)
//        · เลือก V1/V2 จาก carrier ผ่าน validateStrictRenderActivationVersioned (selectionSpec.v)
//   P0-2 NO DOWNGRADE: carrier แนบมาแต่ latch OFF/'0'/ไม่ exact ⇒ typed HOLD (STRICT_RENDER_LATCH_OFF)
//        · latch ON + carrier partial/tampered ⇒ typed HOLD (STRICT_V2_CONTRACT_HOLD) ก่อน IO
//   P1: render plan มาจาก canonical bindings ล้วน · mandatory candidateId/personId/sourceAssetId/refSlotId/
//        composerSlotId (missing/dup ⇒ HOLD) · slotPlan ที่ขัด identity ⇒ HOLD · hero crop ผ่าน hero.heroSlotId
//        (ไม่ใช่ regex /main|hero/) · border rule true⇒'#FFFFFF' false⇒null · personId/sourceAssetId ใน drift+manifest
//   ผู้ตัดสินเดียว = validateStrictRenderActivationVersioned (canonical, ของ refSlotContract) — ไม่ reimplement schema
// fixtures สร้างจาก REAL pure APIs (buildSelectionAuthorityV1/buildSelectionSpecV2/buildSelectionSpec/…) + node:crypto
// OFFLINE 100%: sharp/fetch/faceDetector/executeCover/crypto/coverDirectorService = stub นับ call
// ============================================================
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;

// sharp fake มีพฤติกรรม (พิสูจน์ no-real-sharp): metadata + raw 8x8 จากเนื้อ buffer จริง + นับทุก call
const SHARP_STUB = MOD(`
export default function sharp(buf){
  globalThis.__SHARP_CALLS = (globalThis.__SHARP_CALLS||0)+1;
  const meta = (globalThis.__SHARP_META && globalThis.__SHARP_META[buf.length]) || { width: 1000, height: 1250 };
  let sized = 0, extracted = false;
  const chain = {
    metadata: async () => meta,
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
const CRYPTO_STUB = MOD(`
import real from 'node:crypto';
export default new Proxy(real, { get(t, k){ if (k === 'createHash') return (...a) => real.createHash(...a); return t[k]; } });`);
const OPENAI_STUB = MOD(`export async function callAI(){ const r = globalThis.__EYE_RESPONSE; if (!r) throw new Error('LLM_FORBIDDEN'); return r; }`);
const FD_STUB = MOD(`
export async function batchDetectFaces(items){
  globalThis.__FD_CALLS = (globalThis.__FD_CALLS||0)+1;
  const m = new Map();
  const NORMAL = { imageWidth:1000, imageHeight:1250, hasFaces:true, faces:[{x:400,y:300,width:200,height:250}] };
  items.forEach((it) => m.set(it.id, NORMAL));
  return m;
}
export async function detectFaces(){ throw new Error('DETECTFACES_FORBIDDEN'); }`);
const EXEC_STUB = MOD(`
export async function executeCover({ assignments, imageBuffers, templateSpec, traceSink }){
  globalThis.__EXEC_CALLS = (globalThis.__EXEC_CALLS||0)+1;
  globalThis.__EXEC_SNAP = assignments.map((a)=>({ slot:a.slotId, idx:a.imageIndex, bytes: imageBuffers[a.imageIndex]?.buffer?.length || 0, crop: a.crop ? JSON.parse(JSON.stringify(a.crop)) : null }));
  globalThis.__EXEC_TEMPLATE = (templateSpec.slots||[]).map((s)=>({ id:s.id, border:(s.border===undefined?null:s.border), borderWidth:(s.borderWidth===undefined?null:s.borderWidth), shape:(s.shape||null), w:s.w, h:s.h }));
  if (globalThis.__EXEC_MODE === 'drift' && assignments[1]) assignments[1].imageIndex = 0; // จำลอง render layer สลับ source
  if (Array.isArray(traceSink)) { traceSink.length = 0; traceSink.push(...assignments.map((a)=>({ slot:a.slotId, branch:'stub' }))); }
  return Buffer.alloc(9000, 7);
}
export const V3_TEMPLATES = {};`);
const DIRECTOR_BOMB = MOD(`export async function finalCrop(){ throw new Error('FINALCROP_FORBIDDEN'); }`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') return { url: ${JSON.stringify(SHARP_STUB)}, shortCircuit: true };
  if (specifier === 'crypto') return { url: ${JSON.stringify(CRYPTO_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/ai/openai') return { url: ${JSON.stringify(OPENAI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/faceDetector') return { url: ${JSON.stringify(FD_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/coverExecutorService') return { url: ${JSON.stringify(EXEC_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/services/coverDirectorService') return { url: ${JSON.stringify(DIRECTOR_BOMB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { composeAndVerify, _strictActivate, _runEyeFixTransaction, measureTechRules } = await import('../src/lib/services/megaComposerService.js');
const { buildSelectionAuthorityV1, buildSelectionSpecV2, buildSelectionSpec, buildRefSlotContract } = await import('../src/lib/refSlotContract.js');
const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');

const SVC_SRC = readFileSync(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');

// ── fetch = stub นับ call: คืน buffer varied ต่อ URL ที่รู้จัก · URL แปลก = ระเบิด (จับ fetch เกิน/ผิด)
const FETCH_OK = (url) => {
  const key = String(url);
  globalThis.__FETCH_CALLS = (globalThis.__FETCH_CALLS || 0) + 1;
  const size = SIZES[key];
  if (size == null) throw new Error('NETWORK_FORBIDDEN:' + key);
  return Promise.resolve({ ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => VARIED(size, 7) });
};
globalThis.fetch = FETCH_OK;
delete process.env.MEGA_STRICT_RENDER;
delete process.env.MEGA_COVER_TESTER;
delete process.env.MEGA_EYE_REQC;

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };
// canonical latch เดียว = MEGA_STRICT_RENDER (ไม่มี alias V2 ในโค้ดอีกต่อไป)
const withStrict = async (fn) => { process.env.MEGA_STRICT_RENDER = '1'; try { return await fn(); } finally { delete process.env.MEGA_STRICT_RENDER; } };
const ioDelta = () => ({ fetch: globalThis.__FETCH_CALLS || 0, sharp: globalThis.__SHARP_CALLS || 0, fd: globalThis.__FD_CALLS || 0, exec: globalThis.__EXEC_CALLS || 0 });
const assertNoIO = (before) => {
  const now = ioDelta();
  assert.equal(now.fetch, before.fetch, 'ห้ามพยายามยิง network');
  assert.equal(now.sharp, before.sharp, 'ห้ามแตะ sharp');
  assert.equal(now.fd, before.fd, 'ห้ามแตะ face detector');
  assert.equal(now.exec, before.exec, 'ห้ามแตะ render');
};
// mirror production: the shared seam takes RAW args ONLY (+ explicit latch). slotPlan is captured by the seam from
//   args; there is NO caller-supplied snapshot path. latchArmed:true exercises carrier validation (latch-on).
const activate = (args) => _strictActivate({ args, latchArmed: true });

// ══ fixture builders: REAL pure APIs (ไม่ reimplement schema) ══
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const HEX64 = (seed) => sha256('h64:' + seed);
const HEX8 = (seed) => sha256('h8:' + seed).slice(0, 8);
const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === 'object' ? Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).reduce((o, k) => { o[k] = sortDeep(v[k]); return o; }, {}) : v);
const authHash = (preimage) => sha256(JSON.stringify(sortDeep(preimage)));
const VARIED = (size, seed) => { const b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = (i * 7 + seed) % 251; return b; };
const URLH = 'http://t.local/h.jpg', URLC = 'http://t.local/c.jpg', URLM = 'http://t.local/m.jpg';
const SIZES = { [URLH]: 7001, [URLC]: 7002, [URLM]: 7003 };
const IDS = { storyAuthorityHash: HEX64('story'), castManifestHash: HEX64('cast'), assignmentHash: HEX64('assign'), heroContractHash: HEX8('herocontract') };
const HERO = { heroContractHash: IDS.heroContractHash, refSlotId: 'hero', personId: 'person_a', candidateId: 'cand_h', sourceAssetId: 'asset_h' };
const SLOTS = [
  { refSlotId: 'hero', order: 1, role: 'hero', shape: 'rect', personId: 'person_a', candidateId: 'cand_h', sourceAssetId: 'asset_h' },
  { refSlotId: 'context', order: 2, role: 'context', shape: 'rect', personId: 'person_b', candidateId: 'cand_c', sourceAssetId: 'asset_c' },
  { refSlotId: 'moment', order: 3, role: 'moment', shape: 'circle', personId: 'person_a', candidateId: 'cand_m', sourceAssetId: 'asset_m' },
];
const REALIZED = {
  templateId: 'tmpl_v2', canvasW: 1080, canvasH: 1350, feather: 8,
  slots: [
    { id: 'main', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' },
    { id: 'ctx', x: 594, y: 0, w: 486, h: 1350, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' },
    { id: 'circ', x: 40, y: 900, w: 360, h: 360, zIndex: 3, border: true, borderWidth: 8, shape: 'circle' },
  ],
};
const RENDER_BINDINGS = [
  { refSlotId: 'hero', composerSlotId: 'main', candidateId: 'cand_h', sourceAssetId: 'asset_h', imageUrl: URLH },
  { refSlotId: 'context', composerSlotId: 'ctx', candidateId: 'cand_c', sourceAssetId: 'asset_c', imageUrl: URLC },
  { refSlotId: 'moment', composerSlotId: 'circ', candidateId: 'cand_m', sourceAssetId: 'asset_m', imageUrl: URLM },
];

// build a fresh, valid carrier (shape identical to megaAdapters producer output)
function buildCarrier({ slots = SLOTS, hero = HERO, bindings = RENDER_BINDINGS, realized = REALIZED, refId = 'REF-V2-TEST' } = {}) {
  const expectedSelectionAuthorityHash = authHash({
    v: 1, storyAuthorityHash: IDS.storyAuthorityHash, castManifestHash: IDS.castManifestHash, assignmentHash: IDS.assignmentHash, hero, slots,
  });
  const authBuilt = buildSelectionAuthorityV1({
    storyAuthorityHash: IDS.storyAuthorityHash, castManifestHash: IDS.castManifestHash, assignmentHash: IDS.assignmentHash,
    hero, slots,
    expectedSelectionAuthorityHash, expectedStoryAuthorityHash: IDS.storyAuthorityHash, expectedCastManifestHash: IDS.castManifestHash,
    expectedAssignmentHash: IDS.assignmentHash, expectedHeroContractHash: hero.heroContractHash,
  });
  assert.equal(authBuilt.ok, true, `fixture authority ต้อง ok (reasons: ${JSON.stringify(authBuilt.reasons)})`);
  const envelope = authBuilt.selectionAuthority;
  const specB = buildSelectionSpecV2({ selectionAuthority: envelope, expectedSelectionAuthorityHash, renderBindings: bindings, realizedTemplate: realized, refId });
  assert.equal(specB.ok, true, `fixture spec ต้อง ok (reasons: ${JSON.stringify(specB.reasons)})`);
  const builtSpec = specB.selectionSpec;
  return {
    ok: true, selectionAuthority: envelope, expectedSelectionAuthorityHash, renderBindings: bindings,
    selectionSpec: builtSpec, expectedSpecHash: builtSpec.specHash, expectedReplayHash: builtSpec.replayHash, realizedTemplate: realized,
  };
}
const clone = (o) => structuredClone(o);
// plan ที่ identity ตรง authority (เสริม metadata) — ห้ามเป็น substitution
const mkPlan = () => [
  { url: URLH, slot: 'hero', isHero: true, person: 'person_a', refSlotId: 'hero', candidateId: 'cand_h', sourceAssetId: 'asset_h', faces: 1 },
  { url: URLC, slot: 'context', person: 'person_b', refSlotId: 'context', candidateId: 'cand_c', sourceAssetId: 'asset_c', faces: 1 },
  { url: URLM, slot: 'moment', person: 'person_a', refSlotId: 'moment', candidateId: 'cand_m', sourceAssetId: 'asset_m', faces: 1 },
];
const mkArgs = (over = {}) => ({ newsTitle: 's7-v2', slotPlan: mkPlan(), refDNA: null, refImagePath: null, stableOrder: true, refHeroV2: buildCarrier(), ...over });

// ── V1 fixture (พิสูจน์ version dispatch จาก carrier — v===1 → V1 consumer) ──
const DNA_V1 = { template: { slots: [
  { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
  { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
  { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
] } };
const P1 = (cid, url) => ({ candidateId: cid, imageUrl: url, backups: [] });
const mkV1Spec = () => buildSelectionSpec({
  contract: buildRefSlotContract({ refDNA: DNA_V1 }), realizedTemplate: dnaToTemplateSpec(DNA_V1),
  plannedByRefSlot: { hero: P1('H', URLH), context: P1('C', URLC), moment: P1('M', URLM) }, refId: 'REF-V1-DISPATCH',
});
const mkV1Args = (over = {}) => ({
  newsTitle: 'v1', refDNA: null, refImagePath: null, stableOrder: true,
  slotPlan: [
    { url: URLH, slot: 'hero', isHero: true, person: 'A', refSlotId: 'hero' },
    { url: URLC, slot: 'context', person: 'B', refSlotId: 'context' },
    { url: URLM, slot: 'moment', person: 'A', refSlotId: 'moment' },
  ],
  selectionSpec: mkV1Spec(), realizedTemplate: dnaToTemplateSpec(DNA_V1), ...over,
});

const CARRIER0 = buildCarrier();
assert.ok(CARRIER0.selectionSpec.strictReady === true && CARRIER0.selectionSpec.v === 2, 'sanity: carrier canonical spec v2 strictReady');
assert.equal(mkV1Spec().v, 1, 'sanity: V1 fixture spec v===1');

// ══════════════════════════════════ TESTS ══════════════════════════════════

await test('1) _strictActivate valid V2 carrier ⇒ ctx EXACT LOCKS + border rule + heroComposerSlotId (pure, ZERO IO)', async () => {
  const before = ioDelta();
  const res = activate({ refHeroV2: buildCarrier(), slotPlan: mkPlan() });
  assert.ok(!res.error, `ต้องไม่ HOLD (ได้ ${res.errorType}: ${JSON.stringify(res.reasons)})`);
  const ctx = res.ctx;
  assert.equal(ctx.v2, true);
  assert.equal(ctx.authority.refId, 'REF-V2-TEST');
  assert.equal(ctx.authority.specHash, CARRIER0.expectedSpecHash);
  assert.equal(ctx.authority.replayHash, CARRIER0.expectedReplayHash);
  // hero mapped ผ่าน hero.heroSlotId ('hero') → composerSlotId ('main')
  assert.equal(ctx.heroComposerSlotId, 'main');
  // snapshot exact locks
  assert.deepEqual(ctx.snapshot.map((s) => s.composerSlotId), ['main', 'ctx', 'circ']);
  assert.deepEqual(ctx.snapshot.map((s) => s.refSlotId), ['hero', 'context', 'moment']);
  assert.deepEqual(ctx.snapshot.map((s) => s.candidateId), ['cand_h', 'cand_c', 'cand_m']);
  assert.deepEqual(ctx.snapshot.map((s) => s.sourceAssetId), ['asset_h', 'asset_c', 'asset_m']);
  assert.deepEqual(ctx.snapshot.map((s) => s.personId), ['person_a', 'person_b', 'person_a']);
  assert.deepEqual(ctx.snapshot.map((s) => s.imageUrl), [URLH, URLC, URLM]);
  assert.deepEqual(ctx.snapshot.map((s) => s.shape), ['rect', 'rect', 'circle']);
  assert.deepEqual(ctx.snapshot.map((s) => s.imageIndex), [0, 1, 2]);
  // border rule: circle border=true ⇒ '#FFFFFF' · rects border=false ⇒ null
  assert.deepEqual(ctx.snapshot.map((s) => s.borderColor), [null, null, '#FFFFFF']);
  assert.deepEqual(ctx.spec.slots.map((s) => s.border), [null, null, '#FFFFFF']);
  assert.deepEqual(ctx.spec.slots.map((s) => s.borderWidth), [0, 0, 8]);
  assert.deepEqual(ctx.bind.map((b) => b.sourceAssetId), ['asset_h', 'asset_c', 'asset_m']);
  assert.deepEqual(ctx.bind.map((b) => b.meta.isHero), [true, false, false]);
  assertNoIO(before);
});

await test('2) canonical latch: V1-vs-V2 chosen from carrier version (selectionSpec.v) via one seam — not env', async () => {
  const before = ioDelta();
  // v===2 carrier ⇒ V2 path
  const rV2 = activate({ refHeroV2: buildCarrier(), slotPlan: mkPlan() });
  assert.ok(!rV2.error && rV2.ctx.v2 === true, 'v2 carrier ⇒ ctx.v2');
  // v===1 carrier (own selectionSpec) ⇒ V1 path (ctx ไม่มี v2) — seam เดียวกัน latch เดียวกัน
  const rV1 = activate(mkV1Args());
  assert.ok(!rV1.error, `v1 carrier ต้องผ่าน (ได้ ${rV1.errorType}: ${JSON.stringify(rV1.reasons)})`);
  assert.notEqual(rV1.ctx.v2, true, 'v1 carrier ⇒ ctx ไม่ใช่ v2');
  assert.equal(rV1.ctx.authority.refId, 'REF-V1-DISPATCH');
  // dispatch key = selectionSpec.v: บิด v2-carrier ให้ v=1 ⇒ ถูกส่งเข้า V1 validator ⇒ HOLD ด้วยเหตุผล V1-shaped
  const bent = buildCarrier(); bent.selectionSpec = clone(bent.selectionSpec); bent.selectionSpec.v = 1;
  const rBent = activate({ refHeroV2: bent, slotPlan: mkPlan() });
  assert.ok(rBent.error, 'v ถูกบิดเป็น 1 → V1 validator ปฏิเสธ (v2 shape ไม่ผ่าน V1)');
  assert.equal(rBent.errorType, 'STRICT_V2_CONTRACT_HOLD', 'carrier เป็น refHeroV2 → errorType ตระกูล V2');
  assert.ok(rBent.reasons.some((x) => ['bad_mode', 'bad_source', 'bad_version'].includes(String(x))), `ต้องเป็นเหตุผลจาก V1 validator (ได้ ${JSON.stringify(rBent.reasons)})`);
  assertNoIO(before);
});

await test('3) NO DOWNGRADE (V2) + V1 latch-OFF LEGACY PARITY (item 7): V2 carrier+OFF ⇒ HOLD ก่อน IO · V1-only carrier+OFF ⇒ legacy (ignored)', async () => {
  for (const setEnv of [() => delete process.env.MEGA_STRICT_RENDER, () => { process.env.MEGA_STRICT_RENDER = '0'; }, () => { process.env.MEGA_STRICT_RENDER = 'true'; }]) {
    setEnv();
    // V2 carrier (refHeroV2) + latch OFF ⇒ HOLD ก่อน IO (no downgrade — V2 ต้องไม่ถอย legacy)
    const before = ioDelta();
    const rV2 = await composeAndVerify(mkArgs());
    assert.equal(rV2.success, false);
    assert.equal(rV2.errorType, 'STRICT_RENDER_LATCH_OFF', 'V2 carrier + latch off ⇒ HOLD (ห้าม legacy)');
    assert.deepEqual(rV2.reasons, ['strict_latch_off_v2_carrier_present']);
    assert.equal(rV2.base64, undefined, 'ห้ามปล่อยภาพ');
    assertNoIO(before); // V2 HOLD ก่อนแตะ IO
    // V1-ONLY carrier (selectionSpec, ไม่มี refHeroV2) + latch OFF ⇒ LEGACY parity: carrier ถูก IGNORE →
    //   ผลเท่ากับ args เดียวกันที่ "ถอด carrier ออก" เป๊ะ (ไม่เคยถูกอ่าน — ตรงตาม item 7)
    const rWith = await composeAndVerify(mkV1Args());
    const stripped = mkV1Args(); delete stripped.selectionSpec; delete stripped.realizedTemplate;
    const rNo = await composeAndVerify(stripped);
    assert.notEqual(rWith.errorType, 'STRICT_RENDER_LATCH_OFF', 'V1-only carrier + off ⇒ NOT a strict HOLD (legacy)');
    assert.deepStrictEqual(rWith, rNo, 'V1-only carrier ถูก ignore ใต้ latch off (legacy byte parity)');
  }
  delete process.env.MEGA_STRICT_RENDER;
});

await test('4) latch ON + partial/tampered carrier ⇒ STRICT_V2_CONTRACT_HOLD ก่อน IO (fetch/sharp/fd/exec=0)', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    // pure seam: partial carriers
    for (const bad of [null, undefined, [], 42, 'x', {}, { ok: false }, { ok: true }]) {
      const r = activate({ refHeroV2: bad, slotPlan: mkPlan() });
      assert.ok(r.error, `carrier=${JSON.stringify(bad)} ต้อง HOLD`);
      assert.equal(r.errorType, 'STRICT_V2_CONTRACT_HOLD', `carrier=${JSON.stringify(bad)}`);
      assert.ok(Array.isArray(r.reasons) && r.reasons.length >= 1);
      assert.equal(r.ctx, undefined, 'ห้ามคืน ctx เมื่อ HOLD');
    }
    // carrier ok:true แต่ selectionSpec หาย
    const partial = clone(CARRIER0); delete partial.selectionSpec;
    assert.equal(activate({ refHeroV2: partial, slotPlan: mkPlan() }).errorType, 'STRICT_V2_CONTRACT_HOLD');
    // external-pin tampers (re-sign จับได้)
    const tampers = [
      (c) => { c.expectedSpecHash = HEX64('x'); },
      (c) => { c.expectedReplayHash = HEX64('x'); },
      (c) => { c.expectedSelectionAuthorityHash = HEX64('x'); },
      (c) => { c.selectionSpec = clone(c.selectionSpec); c.selectionSpec.slots[0].primary.imageUrl = 'https://evil/x.jpg'; },
    ];
    for (const mut of tampers) {
      const c = clone(CARRIER0); mut(c);
      const r = activate({ refHeroV2: c, slotPlan: mkPlan() });
      assert.equal(r.errorType, 'STRICT_V2_CONTRACT_HOLD');
      assert.ok(r.reasons.length >= 1);
    }
    // end-to-end ผ่าน composeAndVerify — ต้อง HOLD ก่อน IO เช่นกัน
    const rE = await composeAndVerify(mkArgs({ refHeroV2: { ok: true } }));
    assert.equal(rE.errorType, 'STRICT_V2_CONTRACT_HOLD');
    assert.equal(rE.manifest, undefined, 'ห้ามปล่อย manifest');
    assertNoIO(before);
  });
});

await test('5) mandatory-field completeness: non-hero personId=null ในสเปก canonical ⇒ STRICT_V2_PLAN_INCOMPLETE (consumer เข้มกว่า schema)', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    const slotsNullPerson = clone(SLOTS); slotsNullPerson[1].personId = null; // non-hero (context) — schema อนุญาต null
    const carrier = buildCarrier({ slots: slotsNullPerson });
    assert.equal(carrier.selectionSpec.slots[1].primary.personId, null, 'sanity: canonical spec ยอม null personId (non-hero)');
    // pure seam
    const r = activate({ refHeroV2: carrier, slotPlan: mkPlan() });
    assert.equal(r.errorType, 'STRICT_V2_PLAN_INCOMPLETE', 'personId ภาคบังคับที่ consumer ⇒ HOLD');
    assert.ok(r.reasons.some((x) => String(x).startsWith('plan_row_missing_personId:')), `ได้ ${JSON.stringify(r.reasons)}`);
    // end-to-end ก่อน IO
    const rE = await composeAndVerify(mkArgs({ refHeroV2: buildCarrier({ slots: slotsNullPerson }) }));
    assert.equal(rE.errorType, 'STRICT_V2_PLAN_INCOMPLETE');
    assertNoIO(before);
  });
});

await test('6) dup identity ⇒ HOLD (upstream authority ปฏิเสธ) + consumer มี guard ซ้อน · personId ซ้ำ = ยอมได้ (ไม่ใช่ identity key)', async () => {
  const before = ioDelta();
  // ① dup candidateId/sourceAssetId ถูกปฏิเสธตั้งแต่ authority (ด่านต้นน้ำที่ consumer พึ่งพา)
  const dupAuth = buildSelectionAuthorityV1({
    storyAuthorityHash: IDS.storyAuthorityHash, castManifestHash: IDS.castManifestHash, assignmentHash: IDS.assignmentHash,
    hero: HERO, slots: (() => { const s = clone(SLOTS); s[2].candidateId = 'cand_c'; s[2].sourceAssetId = 'asset_c'; return s; })(),
    expectedSelectionAuthorityHash: HEX64('any'), expectedStoryAuthorityHash: IDS.storyAuthorityHash, expectedCastManifestHash: IDS.castManifestHash,
    expectedAssignmentHash: IDS.assignmentHash, expectedHeroContractHash: IDS.heroContractHash,
  });
  assert.equal(dupAuth.ok, false, 'authority ปฏิเสธ dup identity');
  assert.ok(dupAuth.reasons.includes('sa_dup_candidateId') && dupAuth.reasons.includes('sa_dup_sourceAssetId'), `ได้ ${JSON.stringify(dupAuth.reasons)}`);
  // ② consumer มี guard ซ้อน (defense-in-depth) — dup ⇒ HOLD ตามที่ review สั่ง (reason codes สร้างแบบ dynamic)
  assert.ok(SVC_SRC.includes('plan_row_dup_') && SVC_SRC.includes('plan_row_missing_'), 'consumer ต้องมี dup + missing guard');
  assert.ok(SVC_SRC.includes("STRICT_V2_PLAN_INCOMPLETE"), 'HOLD code สำหรับ completeness/dup');
  // dedup key set: refSlotId/composerSlotId/candidateId/sourceAssetId (personId ไม่อยู่ใน dup loop)
  const dedupBlock = SVC_SRC.slice(SVC_SRC.indexOf('plan_row_dup_') - 400, SVC_SRC.indexOf('plan_row_dup_') + 200);
  for (const k of ['refSlotId', 'composerSlotId', 'candidateId', 'sourceAssetId']) assert.ok(dedupBlock.includes(`'${k}'`), `dedup ครอบ ${k}`);
  // ③ personId ซ้ำ (person_a ทั้ง hero+moment) = ยอมได้ — ไม่ใช่ identity key (คนเดียวหลายช่องเป็นเรื่องปกติ)
  const r = activate({ refHeroV2: buildCarrier(), slotPlan: mkPlan() });
  assert.ok(!r.error, `personId ซ้ำต้องไม่ HOLD (ได้ ${r.errorType}: ${JSON.stringify(r.reasons)})`);
  assert.deepEqual(r.ctx.snapshot.map((s) => s.personId), ['person_a', 'person_b', 'person_a'], 'person_a ปรากฏสองช่องได้');
  assertNoIO(before);
});

await test('7) render plan มาจาก canonical bindings ล้วน: slotPlan ที่ขัด identity ⇒ STRICT_V2_PRIMARY_UNAVAILABLE (cross-check เท่านั้น)', async () => {
  const before = ioDelta();
  const p1 = mkPlan(); p1[1].refSlotId = 'WRONG';
  assert.deepEqual(activate({ refHeroV2: buildCarrier(), slotPlan: p1 }).reasons, ['primary_ref_mismatch:ctx']);
  const p2 = mkPlan(); p2[0].candidateId = 'cand_EVIL';
  assert.deepEqual(activate({ refHeroV2: buildCarrier(), slotPlan: p2 }).reasons, ['primary_candidate_mismatch:main']);
  const p3 = mkPlan(); p3[2].sourceAssetId = 'asset_EVIL';
  assert.deepEqual(activate({ refHeroV2: buildCarrier(), slotPlan: p3 }).reasons, ['primary_asset_mismatch:circ']);
  const p4 = [...mkPlan(), { url: URLC, slot: 'decoy' }];
  const r4 = activate({ refHeroV2: buildCarrier(), slotPlan: p4 });
  assert.equal(r4.errorType, 'STRICT_V2_PRIMARY_UNAVAILABLE');
  assert.deepEqual(r4.reasons, ['primary_duplicate_in_plan:ctx']);
  // slotPlan ว่าง ⇒ ยังผ่าน (authority = ความจริง · ไม่มี substitution possible)
  const rEmpty = activate({ refHeroV2: buildCarrier(), slotPlan: [] });
  assert.ok(!rEmpty.error && rEmpty.ctx, 'slotPlan ว่างต้องผ่าน (bindings จาก canonical)');
  assert.deepEqual(rEmpty.ctx.snapshot.map((s) => s.imageUrl), [URLH, URLC, URLM]);
  assertNoIO(before);
});

await test('8) HERO crop authority = spec.hero.heroSlotId → composerSlotId (NOT /main|hero/ regex)', async () => {
  // fixture ที่ regex ต้องเลือกผิดช่อง: hero refSlotId "hero" → composerSlotId "panelA" (regex ไม่ match)
  //   ในขณะที่ช่อง context (non-hero) → composerSlotId "main" (regex match) — กับดักโดยเฉพาะ
  const bindingsHero = [
    { refSlotId: 'hero', composerSlotId: 'panelA', candidateId: 'cand_h', sourceAssetId: 'asset_h', imageUrl: URLH },
    { refSlotId: 'context', composerSlotId: 'main', candidateId: 'cand_c', sourceAssetId: 'asset_c', imageUrl: URLC },
    { refSlotId: 'moment', composerSlotId: 'circ', candidateId: 'cand_m', sourceAssetId: 'asset_m', imageUrl: URLM },
  ];
  const realizedHero = {
    templateId: 'tmpl_hero', canvasW: 1080, canvasH: 1350, feather: 8,
    slots: [
      { id: 'panelA', x: 0, y: 0, w: 594, h: 1350, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' },
      { id: 'main', x: 594, y: 0, w: 486, h: 900, zIndex: 0, border: false, borderWidth: 0, shape: 'rect' },
      { id: 'circ', x: 594, y: 950, w: 360, h: 360, zIndex: 3, border: true, borderWidth: 8, shape: 'circle' },
    ],
  };
  const mk = () => buildCarrier({ bindings: bindingsHero, realized: realizedHero, refId: 'REF-HERO-MAP' });
  const r = activate({ refHeroV2: mk(), slotPlan: mkPlan() });
  assert.ok(!r.error, `ต้องผ่าน (ได้ ${r.errorType}: ${JSON.stringify(r.reasons)})`);
  assert.equal(r.ctx.heroComposerSlotId, 'panelA', 'hero = ช่องที่ refSlotId===hero.heroSlotId (panelA) ไม่ใช่ regex');
  // ประจานว่า regex จะเลือกผิด
  assert.equal(/main|hero/i.test('panelA'), false, 'regex ไม่ match hero จริง');
  assert.equal(/main|hero/i.test('main'), true, 'regex จะไปโดนช่อง context ผิดๆ');
  // isHero flag ผูกกับ refSlotId===heroSlotId เท่านั้น
  const byRef = Object.fromEntries(r.ctx.bind.map((b) => [b.refSlotId, b.meta.isHero]));
  assert.deepEqual(byRef, { hero: true, context: false, moment: false });
  // end-to-end: manifest ผูก hero identity ('hero') กับ composerSlotId 'panelA'
  await withStrict(async () => {
    const rE = await composeAndVerify({ newsTitle: 'hero-map', slotPlan: mkPlan(), refDNA: null, stableOrder: true, refHeroV2: mk() });
    assert.equal(rE.success, true, rE.error);
    const heroRow = rE.manifest.strictRender.slots.find((s) => s.refSlotId === 'hero');
    assert.equal(heroRow.composerSlotId, 'panelA', 'manifest: hero refSlot → panelA (heroSlotId mapping ถึง render จริง)');
    const mainRow = rE.manifest.strictRender.slots.find((s) => s.composerSlotId === 'main');
    assert.equal(mainRow.refSlotId, 'context', 'ช่อง "main" คือ context (regex จะเข้าใจผิดว่าเป็น hero)');
  });
});

await test('9) border rule ครบทั้งสองทิศ: true⇒"#FFFFFF" false⇒null (snapshot/bind/spec + ถึง executor template)', async () => {
  // rect ที่ border=true ต้องได้ '#FFFFFF' ด้วย (กฎผูกกับ render.border ไม่ใช่ shape)
  const realizedBorder = clone(REALIZED); realizedBorder.slots[0].border = true; realizedBorder.slots[0].borderWidth = 6;
  const ctx = activate({ refHeroV2: buildCarrier({ realized: realizedBorder }), slotPlan: mkPlan() }).ctx;
  assert.deepEqual(ctx.snapshot.map((s) => s.borderColor), ['#FFFFFF', null, '#FFFFFF']);
  assert.deepEqual(ctx.bind.map((b) => b.borderColor), ['#FFFFFF', null, '#FFFFFF']);
  assert.deepEqual(ctx.spec.slots.map((s) => s.border), ['#FFFFFF', null, '#FFFFFF']);
  await withStrict(async () => {
    const r = await composeAndVerify(mkArgs());
    assert.equal(r.success, true, r.error);
    const byT = Object.fromEntries((globalThis.__EXEC_TEMPLATE || []).map((s) => [s.id, s]));
    assert.equal(byT.main.border, null); assert.equal(byT.ctx.border, null);
    assert.equal(byT.circ.border, '#FFFFFF'); assert.equal(byT.circ.borderWidth, 8);
  });
});

await test('10) personId & sourceAssetId ใน manifest + อยู่ใน drift-check (identity guard) · exec drift ⇒ STRICT_ASSIGNMENT_DRIFT', async () => {
  await withStrict(async () => {
    const r = await composeAndVerify(mkArgs());
    assert.equal(r.success, true, r.error);
    // manifest.strictRender.slots มี personId + sourceAssetId ครบ (ไม่ใช่แค่ candidateId/url)
    assert.deepEqual(r.manifest.strictRender.slots, [
      { composerSlotId: 'main', refSlotId: 'hero', candidateId: 'cand_h', personId: 'person_a', sourceAssetId: 'asset_h', imageUrl: URLH },
      { composerSlotId: 'ctx', refSlotId: 'context', candidateId: 'cand_c', personId: 'person_b', sourceAssetId: 'asset_c', imageUrl: URLC },
      { composerSlotId: 'circ', refSlotId: 'moment', candidateId: 'cand_m', personId: 'person_a', sourceAssetId: 'asset_m', imageUrl: URLM },
    ]);
    // drift-check source รวม sourceAssetId/personId (defense-in-depth guard)
    assert.ok(SVC_SRC.includes('loaded_asset_drift'), 'drift-check ต้องมี loaded_asset_drift');
    assert.ok(SVC_SRC.includes('loaded_person_drift'), 'drift-check ต้องมี loaded_person_drift');
    // exec สลับ source ⇒ invariant จับ (ทางเส้น V2 ก็ต้องกั้น)
    globalThis.__EXEC_MODE = 'drift';
    try {
      const rD = await composeAndVerify(mkArgs());
      assert.equal(rD.success, false);
      assert.equal(rD.errorType, 'STRICT_ASSIGNMENT_DRIFT');
      assert.equal(rD.manifest, undefined, 'drift ⇒ ห้ามปล่อย manifest success');
    } finally { delete globalThis.__EXEC_MODE; }
  });
});

await test('11) success end-to-end: manifest ตรง authority · crops URL จาก authority · index order · fetch=3 · border ที่ render', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    const r = await composeAndVerify(mkArgs());
    assert.equal(r.success, true, r.error);
    const sr = r.manifest?.strictRender;
    assert.equal(sr?.verified, true);
    assert.equal(sr.refId, 'REF-V2-TEST');
    assert.equal(sr.specHash, CARRIER0.expectedSpecHash);
    assert.equal(sr.replayHash, CARRIER0.expectedReplayHash);
    const cropUrl = Object.fromEntries(r.crops.map((c) => [c.slot, c.url]));
    assert.equal(cropUrl.main, URLH); assert.equal(cropUrl.ctx, URLC); assert.equal(cropUrl.circ, URLM);
    const by = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
    assert.deepEqual([by.main.idx, by.ctx.idx, by.circ.idx], [0, 1, 2]);
    assert.equal(by.main.bytes, 7001); assert.equal(by.ctx.bytes, 7002); assert.equal(by.circ.bytes, 7003);
    assert.equal(ioDelta().fetch - before.fetch, 3, 'fetch เฉพาะ 3 primary ของ authority');
  });
});

await test('12) no asset substitution: decoy thumbnailUrl/backup ในแผน ห้ามถูกใช้ (source ล็อก URL authority)', async () => {
  await withStrict(async () => {
    const p = mkPlan();
    p[1].thumbnailUrl = URLH; p[1].backups = [{ url: 'https://evil.example/backup.jpg' }];
    const r = await composeAndVerify(mkArgs({ slotPlan: p }));
    assert.equal(r.success, true, r.error);
    assert.deepEqual(r.manifest.strictRender.slots.map((s) => s.imageUrl), [URLH, URLC, URLM]);
  });
});

await test('13) ambiguous carrier: มีทั้ง refHeroV2 และ selectionSpec ⇒ STRICT_RENDER_CARRIER_AMBIGUOUS ก่อน IO', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    const r = await composeAndVerify(mkArgs({ selectionSpec: mkV1Spec(), realizedTemplate: dnaToTemplateSpec(DNA_V1) }));
    assert.equal(r.success, false);
    assert.equal(r.errorType, 'STRICT_RENDER_CARRIER_AMBIGUOUS');
    assert.deepEqual(r.reasons, ['carrier_ambiguous_v1_and_v2']);
    assertNoIO(before);
  });
});

await test('14) determinism: input เดิม 2 รอบ ⇒ byte-identical (V2 strict)', async () => {
  await withStrict(async () => {
    const run = async () => {
      const r = await composeAndVerify(mkArgs());
      return JSON.stringify({ success: r.success, placed: r.placed, crops: r.crops, qcFlags: r.qcFlags, strictRender: r.manifest?.strictRender, outputHash: r.manifest?.outputHash });
    };
    assert.equal(await run(), await run());
  });
});

await test('15) V1 flag-OFF byte parity: NO carrier ⇒ legacy byte-identical (latch ON/OFF ไม่เกี่ยว) · carrier ⇒ HOLD (contrast)', async () => {
  const DNA3 = { template: { slots: [
    { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
    { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
    { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
  ] } };
  const legacyPlan = () => [
    { url: URLH, slot: 'hero', isHero: true, person: 'A' },
    { url: URLC, slot: 'context', person: 'B' },
    { url: URLM, slot: 'moment', person: 'A' },
  ];
  const legacyArgs = () => ({ newsTitle: 'legacy-parity', slotPlan: legacyPlan(), refDNA: structuredClone(DNA3), refImagePath: null, stableOrder: true });
  delete process.env.MEGA_STRICT_RENDER;
  const baseline = await composeAndVerify(legacyArgs());
  assert.equal(baseline.success, true, baseline.error);
  assert.equal(baseline.manifest?.strictRender, undefined, 'legacy ห้ามมี strictRender');
  const baseResp = structuredClone(baseline);
  const baseSnap = structuredClone(globalThis.__EXEC_SNAP || []);
  // NO carrier: latch OFF/'0'/ON ⇒ legacy byte-identical (carrier ไม่มี = ไม่แตะเส้น strict)
  const compareNoCarrier = async (label, env) => {
    if (env === undefined) delete process.env.MEGA_STRICT_RENDER; else process.env.MEGA_STRICT_RENDER = env;
    try {
      const r = await composeAndVerify(legacyArgs());
      assert.equal(r.manifest?.strictRender, undefined, `${label}: ห้ามมี strictRender`);
      assert.deepStrictEqual(r, baseResp, `${label}: response ต้องเท่ากับ baseline`);
      assert.deepStrictEqual(globalThis.__EXEC_SNAP, baseSnap, `${label}: __EXEC_SNAP เท่ากับ baseline`);
    } finally { delete process.env.MEGA_STRICT_RENDER; }
  };
  await compareNoCarrier('unset', undefined);
  await compareNoCarrier("'0'", '0');
  await compareNoCarrier("'1' (no carrier = legacy job จริง)", '1');
  // contrast: refHeroV2 present + latch OFF ⇒ HOLD (P0-2 — ไม่ใช่ legacy)
  const rDown = await composeAndVerify({ ...legacyArgs(), refHeroV2: buildCarrier() });
  assert.equal(rDown.errorType, 'STRICT_RENDER_LATCH_OFF', 'carrier + OFF = HOLD (no silent downgrade)');
});

await test('16) (item 6) outer carrier read via descriptor ONCE — refHeroV2 as an accessor ⇒ HOLD, getter NEVER invoked', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    let gets = 0;
    const args = { newsTitle: 'acc', slotPlan: mkPlan(), refDNA: null, stableOrder: true };
    Object.defineProperty(args, 'refHeroV2', { enumerable: true, configurable: true, get() { gets++; return buildCarrier(); } });
    const r = await composeAndVerify(args);
    assert.equal(r.success, false);
    assert.equal(r.errorType, 'STRICT_V2_CONTRACT_HOLD');
    assert.deepEqual(r.reasons, ['carrier_accessor_or_undefined']);
    assert.equal(gets, 0, 'refHeroV2 getter ต้องไม่ถูกเรียก (descriptor-read เท่านั้น)');
    assertNoIO(before);
  });
});

await test('17) (item 9) slotPlan identity contradiction covers personId + composerSlotId (not just ref/candidate/asset)', async () => {
  const before = ioDelta();
  // personId ขัด canonical ⇒ primary_person_mismatch (composerSlotId ของช่อง context = 'ctx')
  const pPerson = mkPlan(); pPerson[1].personId = 'person_EVIL';
  assert.deepEqual(activate({ refHeroV2: buildCarrier(), slotPlan: pPerson }).reasons, ['primary_person_mismatch:ctx']);
  // composerSlotId ขัด canonical ⇒ primary_composer_mismatch (ช่อง hero = 'main')
  const pComposer = mkPlan(); pComposer[0].composerSlotId = 'WRONG_COMPOSER';
  assert.deepEqual(activate({ refHeroV2: buildCarrier(), slotPlan: pComposer }).reasons, ['primary_composer_mismatch:main']);
  // control: plan row ประกาศ personId/composerSlotId ตรง canonical ⇒ ผ่าน
  const pOk = mkPlan(); pOk[0].composerSlotId = 'main'; pOk[0].personId = 'person_a'; pOk[1].personId = 'person_b';
  assert.ok(!activate({ refHeroV2: buildCarrier(), slotPlan: pOk }).error, 'ประกาศตรง canonical = ผ่าน');
  assertNoIO(before);
});

await test('18) (item 8) Eye transaction excludes the CANONICAL hero (heroComposerSlotId) — NOT /main|hero/ regex', async () => {
  // hero จริง = "panelA" (regex ไม่ match) · decoy "main" = context (regex match) — กับดักโดยเฉพาะ
  assert.equal(/main|hero/i.test('panelA'), false, 'regex ไม่ match hero จริง');
  assert.equal(/main|hero/i.test('main'), true, 'regex จะไปโดน decoy "main" ผิดๆ');
  const mkCore = () => ({
    assignments: [
      { slotId: 'panelA', imageIndex: 0, crop: { x: 0.1, y: 0.3, w: 0.8, h: 0.6 }, why: 'hero' },
      { slotId: 'main', imageIndex: 1, crop: { x: 0.1, y: 0.3, w: 0.8, h: 0.6 }, why: 'ctx' },
    ],
    used: new Set([0, 1]), qcFlags: [], traceSink: [],
    loaded: [{ person: 'person_a', clean: true, url: URLH }, { person: 'person_b', clean: true, url: URLC }],
    faceBoxes: [null, null], spec: null,
    heroComposerSlotId: 'panelA', // ★ canonical hero (V2)
  });
  const prevReqc = process.env.MEGA_EYE_REQC;
  process.env.MEGA_EYE_REQC = '0'; // รับผลตาเลย (ไม่มี regression gate)
  try {
    const core = mkCore();
    const calls = { n: 0 };
    const tx = await _runEyeFixTransaction({
      core,
      fixes: [{ slot: 'panelA', action: 'shift_up' }, { slot: 'main', action: 'shift_up' }],
      buffer: Buffer.from('pre'), cropTrace: [],
      renderCover: async () => { calls.n++; core.traceSink.length = 0; core.traceSink.push({ slot: 'main', branch: 'x' }); return Buffer.from('post'); },
    });
    assert.equal(tx.fixedCount, 1, 'เฉพาะ main (non-hero) ถูกแก้ · panelA (canonical hero) ถูกกัน');
    assert.equal(core.assignments[0].crop.y, 0.3, 'canonical hero (panelA) crop ต้องไม่ถูกแตะ');
    assert.equal(core.assignments[1].crop.y, 0.2, 'main (non-hero) ถูก shift_up 0.1 (regex จะกันช่องนี้ผิดๆ)');
    assert.equal(calls.n, 1, 'render รอบ post-fix ครั้งเดียว');
  } finally {
    if (prevReqc === undefined) delete process.env.MEGA_EYE_REQC; else process.env.MEGA_EYE_REQC = prevReqc;
  }
});

await test('19) (item 10) measureTechRules hero role from explicit heroComposerSlotId (not /main|hero/ regex); V1 preserves regex', async () => {
  const spec = { canvasW: 1080, canvasH: 1350, slots: [
    { id: 'panelA', x: 0, y: 0, w: 594, h: 1350, shape: 'rect' },
    { id: 'main', x: 594, y: 0, w: 486, h: 900, shape: 'rect' },
    { id: 'circ', x: 594, y: 950, w: 360, h: 360, shape: 'circle' },
  ] };
  const assignments = [{ slotId: 'panelA', imageIndex: 0 }, { slotId: 'main', imageIndex: 1 }, { slotId: 'circ', imageIndex: 2 }];
  // V2: canonical hero = 'panelA' → face-share/headroom rules apply to panelA, ไม่ใช่ decoy 'main'
  const v2 = measureTechRules({ assignments, spec, faceBoxes: [], cropTrace: [], heroComposerSlotId: 'panelA' });
  assert.equal(v2.measured.bySlot.panelA.role, 'hero', 'canonical hero slot = hero role (V2)');
  assert.notEqual(v2.measured.bySlot.main.role, 'hero', 'decoy "main" ไม่ใช่ hero ใน V2');
  // V1/legacy: ไม่ส่ง heroComposerSlotId ⇒ regex → 'main' = hero (byte-identical เดิม)
  const v1 = measureTechRules({ assignments, spec, faceBoxes: [], cropTrace: [] });
  assert.equal(v1.measured.bySlot.main.role, 'hero', 'V1 regex → main = hero (ของเดิมคงไว้)');
  assert.notEqual(v1.measured.bySlot.panelA.role, 'hero', 'V1 regex ไม่ match panelA');
});

await test('20) (P1-R1) V2 PLAIN-object carrier: each outer descriptor read EXACTLY once (count wrapped Object.getOwnPropertyDescriptor, filter obj===args, restore in finally)', async () => {
  await withStrict(async () => {
    const args = { ...mkArgs() }; // plain data object with a valid V2 carrier (NO Proxy — benign outer Proxy is now rejected)
    const counts = {};
    const realGOPD = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = function (obj, key) { if (obj === args && typeof key === 'string') counts[key] = (counts[key] || 0) + 1; return realGOPD(obj, key); };
    let r;
    try { r = await composeAndVerify(args); } finally { Object.getOwnPropertyDescriptor = realGOPD; }
    assert.equal(r.success, true, r.error);
    assert.equal(counts.refHeroV2, 1, 'refHeroV2 descriptor read EXACTLY once');
    assert.equal(counts.selectionSpec, 1, 'selectionSpec descriptor read EXACTLY once');
    assert.equal(counts.realizedTemplate, 1, 'realizedTemplate descriptor read EXACTLY once');
    assert.equal(counts.slotPlan, 1, 'slotPlan captured by descriptor EXACTLY once');
  });
});

await test('21) (P0-A) seam is the FIRST args observation — a slotPlan/newsTitle getter cannot delete/replace the carrier before capture (no downgrade)', async () => {
  await withStrict(async () => {
    let planGet = 0, titleGet = 0;
    const t = { refDNA: null, stableOrder: true, refHeroV2: buildCarrier() };
    Object.defineProperty(t, 'slotPlan', { enumerable: true, configurable: true, get() { planGet++; delete t.refHeroV2; return mkPlan(); } });
    Object.defineProperty(t, 'newsTitle', { enumerable: true, configurable: true, get() { titleGet++; delete t.refHeroV2; return 'x'; } });
    const r = await composeAndVerify(t);
    assert.equal(r.success, true, `V2 captured before any business getter ⇒ no downgrade (got ${r.errorType || 'ok'})`);
    assert.equal(r.manifest?.strictRender?.verified, true, 'strict V2 render happened (NOT legacy)');
    assert.equal(planGet, 0, 'slotPlan getter NEVER invoked (descriptor read) — cannot delete the carrier before capture');
  });
});

await test('22) (P0) RAW outer Proxy rejected at the VERY START — before ANY trap; cross-key/self/V1 deletion cannot hide ambiguity or downgrade; ON+OFF, no IO', async () => {
  const zero = () => ({ gopd: 0, get: 0, proto: 0, has: 0, ownKeys: 0 });
  const mkHandler = (c, mut) => ({
    getOwnPropertyDescriptor(t, k) { c.gopd++; mut(t, k); return Object.getOwnPropertyDescriptor(t, k); },
    get(t, k, r) { c.get++; return Reflect.get(t, k, r); },
    getPrototypeOf(t) { c.proto++; return Object.getPrototypeOf(t); },
    has(t, k) { c.has++; return Reflect.has(t, k); },
    ownKeys(t) { c.ownKeys++; return Reflect.ownKeys(t); },
  });
  const shapes = [
    // stateful cross-key trap: return the real V2 descriptor while DELETING selectionSpec ⇒ would hide V1+V2 ambiguity
    { label: 'dual-cross-key-delete', mk: () => ({ refHeroV2: buildCarrier(), selectionSpec: mkV1Spec(), realizedTemplate: dnaToTemplateSpec(DNA_V1), slotPlan: mkPlan() }), mut: (t, k) => { if (k === 'refHeroV2') delete t.selectionSpec; } },
    { label: 'v1-only-delete', mk: () => ({ selectionSpec: mkV1Spec(), realizedTemplate: dnaToTemplateSpec(DNA_V1), slotPlan: mkPlan() }), mut: (t, k) => { if (k === 'selectionSpec') delete t.realizedTemplate; } },
    { label: 'v2-self-delete', mk: () => ({ refHeroV2: buildCarrier(), slotPlan: mkPlan() }), mut: (t, k) => { if (k === 'refHeroV2') delete t.refHeroV2; } },
  ];
  for (const s of shapes) {
    for (const armed of [true, false]) {
      if (armed) process.env.MEGA_STRICT_RENDER = '1'; else delete process.env.MEGA_STRICT_RENDER;
      const c = zero();
      const proxy = new Proxy(s.mk(), mkHandler(c, s.mut));
      const before = ioDelta();
      const r = await composeAndVerify(proxy);
      const tag = `${s.label}/${armed ? 'ON' : 'OFF'}`;
      assert.equal(r.success, false, tag);
      assert.equal(r.errorType, 'STRICT_RENDER_CONTRACT_INVALID', `${tag}: typed HOLD`);
      assert.deepEqual(r.reasons, ['input_proxy_unsupported'], `${tag}: stable reason`);
      assert.deepEqual(c, { gopd: 0, get: 0, proto: 0, has: 0, ownKeys: 0 }, `${tag}: rejected BEFORE any Proxy trap (all counters 0)`);
      assertNoIO(before);
    }
  }
  delete process.env.MEGA_STRICT_RENDER;
});

await test('23) inner V2 carrier descriptor trap (PLAIN outer args, inner carrier is a throwing Proxy) ⇒ carrier_inner_descriptor_trap HOLD before IO — descriptor-trap semantics preserved where testable', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    const innerProxy = new Proxy({ ok: true }, { getOwnPropertyDescriptor(t, k) { if (k === 'ok') throw new Error('inner-gopd-trap'); return Object.getOwnPropertyDescriptor(t, k); } });
    const args = { newsTitle: 'inner', slotPlan: mkPlan(), refDNA: null, stableOrder: true, refHeroV2: innerProxy }; // PLAIN outer object (not a Proxy)
    const r = await composeAndVerify(args);
    assert.equal(r.success, false);
    assert.equal(r.errorType, 'STRICT_V2_CONTRACT_HOLD');
    assert.deepEqual(r.reasons, ['carrier_inner_descriptor_trap']);
    assertNoIO(before);
  });
});

await test('24) (P1-R1) V1 PLAIN-object carrier: each outer descriptor read EXACTLY once (count wrapped Object.getOwnPropertyDescriptor, filter obj===args, restore in finally)', async () => {
  await withStrict(async () => {
    const args = { ...mkV1Args() }; // plain data object (NO Proxy)
    const counts = {};
    const realGOPD = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = function (obj, key) { if (obj === args && typeof key === 'string') counts[key] = (counts[key] || 0) + 1; return realGOPD(obj, key); };
    let r;
    try { r = await composeAndVerify(args); } finally { Object.getOwnPropertyDescriptor = realGOPD; }
    assert.equal(r.success, true, r.error);
    assert.equal(counts.selectionSpec, 1, 'selectionSpec descriptor read EXACTLY once');
    assert.equal(counts.realizedTemplate, 1, 'realizedTemplate descriptor read EXACTLY once');
    assert.equal(counts.refHeroV2, 1, 'refHeroV2 descriptor read EXACTLY once (absent)');
  });
});

await test('25) (P1) exported seam takes RAW args only — a fabricated snapshot argument has NO effect and NO API path', async () => {
  const forged = Object.freeze({ isObj: true, isPlain: true, refHeroV2: { present: true, accessor: false, trapError: false, value: buildCarrier() }, selectionSpec: { present: false }, realizedTemplate: { present: false }, slotPlan: { value: mkPlan() } });
  // (a) forged snapshot ignored — args has no carrier ⇒ none (legacy)
  const rNone = _strictActivate({ args: { slotPlan: mkPlan() }, latchArmed: true, snapshot: forged });
  assert.equal(rNone.none, true, 'fabricated snapshot ignored — args has no carrier ⇒ none');
  // (b) forged snapshot cannot bless a bad carrier that lives in args
  const rBad = _strictActivate({ args: { refHeroV2: { ok: true }, slotPlan: mkPlan() }, latchArmed: true, snapshot: forged });
  assert.equal(rBad.errorType, 'STRICT_V2_CONTRACT_HOLD', 'forged snapshot cannot bless a bad carrier — seam captures from args');
  assert.equal(rBad.ctx, undefined);
});

await test('26) (ambiguity) V1+V2 both present ⇒ ambiguous HOLD that CANNOT be hidden by latch (ON and OFF), no IO', async () => {
  const dual = () => ({ refHeroV2: buildCarrier(), selectionSpec: mkV1Spec(), realizedTemplate: dnaToTemplateSpec(DNA_V1), slotPlan: mkPlan(), refDNA: null, stableOrder: true });
  await withStrict(async () => {
    const before = ioDelta();
    const r = await composeAndVerify(dual());
    assert.equal(r.errorType, 'STRICT_RENDER_CARRIER_AMBIGUOUS', 'ambiguous (latch ON)');
    assert.deepEqual(r.reasons, ['carrier_ambiguous_v1_and_v2']);
    assertNoIO(before);
  });
  delete process.env.MEGA_STRICT_RENDER;
  const before2 = ioDelta();
  const r2 = await composeAndVerify(dual());
  assert.equal(r2.errorType, 'STRICT_RENDER_CARRIER_AMBIGUOUS', 'ambiguity CANNOT be hidden at latch OFF');
  assertNoIO(before2);
});

await test('27) (P1 evidence integrity) consumer tri-state newsScene: plan OMITS ⇒ meta.newsScene===null · explicit false ⇒ false · explicit true ⇒ true (real _strictPrepareV2 seam, no reimpl)', async () => {
  const before = ioDelta();
  // Exercise the tri-state read in the REAL consumer seam (_strictActivate → _strictPrepareV2). The V2 PRODUCER now
  //   OMITS newsScene (canonical chain never carries triage.newsScene), so an omitted key MUST surface as null —
  //   never a fabricated true. Explicit false/true (were they ever present) must be preserved verbatim.
  const plan = [
    { url: URLH, slot: 'hero', isHero: true, person: 'person_a', refSlotId: 'hero', candidateId: 'cand_h', sourceAssetId: 'asset_h', faces: 1 }, // newsScene OMITTED
    { url: URLC, slot: 'context', person: 'person_b', refSlotId: 'context', candidateId: 'cand_c', sourceAssetId: 'asset_c', faces: 1, newsScene: false },
    { url: URLM, slot: 'moment', person: 'person_a', refSlotId: 'moment', candidateId: 'cand_m', sourceAssetId: 'asset_m', faces: 1, newsScene: true },
  ];
  const res = activate({ refHeroV2: buildCarrier(), slotPlan: plan });
  assert.ok(!res.error, `ต้องไม่ HOLD (ได้ ${res.errorType}: ${JSON.stringify(res.reasons)})`);
  const byRef = Object.fromEntries(res.ctx.bind.map((b) => [b.refSlotId, b.meta.newsScene]));
  assert.strictEqual(byRef.hero, null, 'omitted newsScene ⇒ meta.newsScene === null (unknown — never fabricated true)');
  assert.strictEqual(byRef.context, false, 'explicit false ⇒ meta.newsScene === false (preserved)');
  assert.strictEqual(byRef.moment, true, 'explicit true ⇒ meta.newsScene === true (preserved)');
  assertNoIO(before);
});

await test('28) (P1 fail-closed carrier presence) V2 + ANY own V1 field ⇒ ambiguous (latch ON & OFF, zero IO) · V1 half-pair (spec-only / realized-only) ⇒ STRICT_RENDER_CONTRACT_INVALID before latch/IO · complete V1 + latch OFF ⇒ legacy', async () => {
  const before = ioDelta();
  const V1SPEC = mkV1Spec();
  const V1REAL = dnaToTemplateSpec(DNA_V1);
  // ── V2 + ANY own V1 field (selectionSpec and/or realizedTemplate) ⇒ STRICT_RENDER_CARRIER_AMBIGUOUS regardless of
  //   latch, BEFORE any IO — a V2 carrier may never co-exist with a V1 field. (realized-only was silently accepted+
  //   ignored before this fix; cover-ref-test/compose can both forward that exact shape.) ──
  const ambiguous = [
    { label: 'v2+selectionSpec-only', mk: () => ({ refHeroV2: buildCarrier(), selectionSpec: V1SPEC, slotPlan: mkPlan() }) },
    { label: 'v2+realizedTemplate-only', mk: () => ({ refHeroV2: buildCarrier(), realizedTemplate: V1REAL, slotPlan: mkPlan() }) },
    { label: 'v2+both', mk: () => ({ refHeroV2: buildCarrier(), selectionSpec: V1SPEC, realizedTemplate: V1REAL, slotPlan: mkPlan() }) },
  ];
  for (const c of ambiguous) {
    for (const armed of [true, false]) {
      const r = _strictActivate({ args: c.mk(), latchArmed: armed });
      assert.equal(r.errorType, 'STRICT_RENDER_CARRIER_AMBIGUOUS', `${c.label} (armed=${armed}) ⇒ ambiguous`);
      assert.deepEqual(r.reasons, ['carrier_ambiguous_v1_and_v2'], `${c.label} (armed=${armed}): stable ambiguity reason`);
      assert.equal(r.ctx, undefined, `${c.label} (armed=${armed}): no ctx on HOLD`);
      assert.notEqual(r.none, true, `${c.label} (armed=${armed}): never a silent legacy downgrade`);
    }
  }
  // ── V1 half-pair (exactly one of selectionSpec/realizedTemplate, no V2) ⇒ typed invalid, BEFORE latch/IO, stable reason ──
  const halfPairs = [
    { label: 'v1-spec-only', mk: () => ({ selectionSpec: V1SPEC, slotPlan: mkPlan() }) },
    { label: 'v1-realized-only', mk: () => ({ realizedTemplate: V1REAL, slotPlan: mkPlan() }) },
  ];
  for (const c of halfPairs) {
    for (const armed of [true, false]) {
      const r = _strictActivate({ args: c.mk(), latchArmed: armed });
      assert.equal(r.errorType, 'STRICT_RENDER_CONTRACT_INVALID', `${c.label} (armed=${armed}) ⇒ invalid half-pair`);
      assert.deepEqual(r.reasons, ['carrier_v1_half_pair'], `${c.label} (armed=${armed}): stable half-pair reason`);
      assert.notEqual(r.none, true, `${c.label} (armed=${armed}): never a silent legacy downgrade`);
    }
  }
  // ── complete V1 pair + latch OFF ⇒ legacy parity (none, not an error) — unchanged by this fix ──
  const rLegacy = _strictActivate({ args: mkV1Args(), latchArmed: false });
  assert.equal(rLegacy.none, true, 'complete V1 + latch OFF ⇒ legacy (none)');
  assert.equal(rLegacy.error, undefined, 'complete V1 + latch OFF is not an error');
  // ── the whole pure matrix touched ZERO IO ──
  assertNoIO(before);
  // ── end-to-end compose path (the /api/mega/compose consumer) ALSO HOLDs before IO on a V2+realized-only wire ──
  const beforeC = ioDelta();
  const rCompose = await withStrict(async () => composeAndVerify({ refHeroV2: buildCarrier(), realizedTemplate: V1REAL, slotPlan: mkPlan(), refDNA: null, stableOrder: true }));
  assert.equal(rCompose.success, false, 'compose path: V2+realized-only ⇒ fail');
  assert.equal(rCompose.errorType, 'STRICT_RENDER_CARRIER_AMBIGUOUS', 'compose path: ambiguous HOLD (mirrors the seam)');
  assert.equal(rCompose.base64, undefined, 'compose path: no image emitted');
  assertNoIO(beforeC);
});

console.log(`1..${passed}`);
