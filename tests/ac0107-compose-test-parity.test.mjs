// ============================================================
// 🧪 AC-0107 compose-test ⇄ full-route QC NON-EQUIVALENCE regression (offline)
// ------------------------------------------------------------
// The production incident (hero crop 2.69× → QC_REJECTED) was on /cover-ref-test, whose QC is a HARD 422 gate (zero
// archive). /mega/compose-test is a TUNING tool whose QC is ADVISORY: HTTP success + auto-archive follow out.success,
// NOT qcVerdict.pass — so the SAME QC-failed output is presented as success:true here. That non-equivalence is why a
// green compose-test result is NOT Production parity. This test proves both semantics with the EXACT incident flag
// ('upscaled:main:2.69'), and pins the new truthful `productionQcPass` parity indicator (advisory/frozen mode intact).
//
// Offline: real coverQcGate (the shared verdict); composeAndVerify/caseStore/imageStore/refCoverLibrary/archive/next
// are process-local data:URL stubs. No network, no fs, no real compose.
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// composeAndVerify stub: returns whatever globalThis.__CT_COMPOSE yields (per-test control) — a rendered cover with
// caller-chosen qcFlags. NEVER real sharp/compose.
const STUB_COMPOSER = _mod('export async function composeAndVerify(p){ if (globalThis.__CT_COMPOSE) return globalThis.__CT_COMPOSE(p); throw new Error("REAL_COMPOSE_FORBIDDEN_IN_TEST"); }');
const STUB_CASE = _mod('export async function getCase(id){ return globalThis.__CT_SP.getCase(id); } export async function listRecent(){ return []; }');
const STUB_STORE = _mod('export async function readImages(id){ return globalThis.__CT_SP.readImages(id); }');
const STUB_REFLIB = _mod('export async function listRefCovers(n){ return globalThis.__CT_SP.listRefCovers(n); }');
// auto-archive stub — count invocations (proves the NORMAL path archives QC-pass but NOT QC-fail after the AC-0107 gate)
const STUB_ARCHIVE = _mod('export async function addMegaCover(e){ globalThis.__CT_ARCHIVE = (globalThis.__CT_ARCHIVE||0)+1; return { id: "CT-ARCH" }; }');
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, status: (init && init.status) || 200 }) };');
// normal-path leaves: compassBrain, s6_slots, pickBestRef — all data-driven from globalThis.__CT_SP
// ★ ตรวจ (28 ก.ค. 69): compassBrain/s5_gapsearch นับจำนวนครั้งที่ถูกเรียกจริงด้วย (globalThis.__CT_CALLS) —
//   ใช้พิสูจน์ว่าโหมด frozen ข้ามทั้งคู่ไปเลย (ไม่ใช่แค่ผลลัพธ์เหมือนเดิม แต่ "ไม่ถูกเรียก" จริงๆ)
const STUB_BRAINS = _mod('export async function compassBrain(){ globalThis.__CT_CALLS.compass++; return globalThis.__CT_SP.compass(); }');
const STUB_ADAPTERS = _mod('export async function s6_slots(){ return globalThis.__CT_SP.s6(); } export async function s5_gapsearch(){ globalThis.__CT_CALLS.gapsearch++; return globalThis.__CT_SP.gapsearch ? globalThis.__CT_SP.gapsearch() : { summary: "x" }; }');
const STUB_REFMATCH = _mod('export async function pickBestRef(){ return globalThis.__CT_SP.pickBestRef ? globalThis.__CT_SP.pickBestRef() : null; }');

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/services/megaComposerService') return { url: ${JSON.stringify(STUB_COMPOSER)}, shortCircuit: true };
  if (specifier === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/refCoverLibrary') return { url: ${JSON.stringify(STUB_REFLIB)}, shortCircuit: true };
  if (specifier === '@/lib/megaCoverArchive') return { url: ${JSON.stringify(STUB_ARCHIVE)}, shortCircuit: true };
  if (specifier === '@/lib/megaBrains') return { url: ${JSON.stringify(STUB_BRAINS)}, shortCircuit: true };
  if (specifier === '@/lib/megaAdapters') return { url: ${JSON.stringify(STUB_ADAPTERS)}, shortCircuit: true };
  if (specifier === '@/lib/refCoverMatch') return { url: ${JSON.stringify(STUB_REFMATCH)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// fetch bomb (nothing here should touch network)
let fetchBomb = 0;
const ORIG_FETCH = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
globalThis.fetch = () => { fetchBomb++; throw new Error('NETWORK_FORBIDDEN'); };

// real coverQcGate (shared hard-gate verdict) + the compose-test route under test
const { evaluateCoverQc } = await import('../src/app/../lib/coverQcGate.js');
const { POST } = await import('../src/app/api/mega/compose-test/route.js');

globalThis.__CT_CALLS = { compass: 0, gapsearch: 0 }; // ★ ตรวจ 28 ก.ค. 69 — นับ call จริงของ compassBrain/s5_gapsearch (ต้องมีก่อนสตับใดๆ ถูกเรียก)

const CASE_ID = 'AC0107-CT';
const REF_ID = 'REF-CT-1';
// 6 clean relevant images ⇒ pool ≥ POOL_MIN_FLOOR under the default clean gate
const IMGS = Array.from({ length: 6 }, (_, i) => ({ id: `I${i}`, imageUrl: `https://cdn.test/I${i}.jpg`, triage: { relevant: true, clean: true, faceCount: 1 } }));
globalThis.__CT_SP = {
  getCase: async () => ({ id: CASE_ID, analysis: { headline: 'ข่าวทดสอบ AC-0107' } }),
  readImages: async () => IMGS,
  listRefCovers: async () => [{ id: REF_ID, styleName: 'ct', imagePath: '/ref/ct.jpg', dna: { layoutFamily: 'x', panelCount: 5 } }],
  // normal (non-frozen) path leaves:
  compass: () => ({ angle: 'a', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: [{ name: 'X', role: 'hero' }], visualDreamShots: [] }),
  s6: () => ({ status: 'done', dossierPatch: { pickImages: { slots: {
    hero: { imageUrl: 'https://cdn.test/I0.jpg', person: 'X' },
    reaction: { imageUrl: 'https://cdn.test/I1.jpg' },
    context: { imageUrl: 'https://cdn.test/I2.jpg' },
  } } } }),
};
const mkNormalReq = () => ({ url: 'http://localhost:3000/api/mega/compose-test', json: async () => ({ caseId: CASE_ID, refId: REF_ID, heroPersonHint: '' }) });
const FROZEN_PLAN = [
  { url: 'https://cdn.test/I0.jpg', slot: 'hero', isHero: true },
  { url: 'https://cdn.test/I1.jpg', slot: 'reaction' },
  { url: 'https://cdn.test/I2.jpg', slot: 'context' },
];
// ★ ตรวจ (28 ก.ค. 69): req จำลองของโหมด frozen ไม่มี .url เลย (ตัวแทนของจริง — ปุ่ม ② composeFrozen ใน /m ก็ไม่
//   จำเป็นต้องมี URL จริงให้ route ใช้ เพราะโหมดนี้ไม่ควรแตะ origin/compass/gap-search เลยตามสัญญา "ข้าม compass+S6"
const mkReq = () => ({ json: async () => ({ caseId: CASE_ID, refId: REF_ID, slotPlan: FROZEN_PLAN }) });
// compose double: a RENDERED cover (out.success:true, has base64) carrying caller-chosen qcFlags
const composeYielding = (qcFlags) => async () => ({ success: true, base64: 'data:image/jpeg;base64,QUJD', template: 'ct', refSimilarity: 80, manifest: {}, qcFlags });

const clearHardQc = () => { delete process.env.MEGA_HARD_QC; }; // default = hard gate ACTIVE (only '0' bypasses)

let n = 0, failed = 0;
const test = async (name, fn) => { n++; try { await fn(); console.log(`ok ${n} - ${name}`); } catch (e) { failed++; console.log(`not ok ${n} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n  ')}`); } };

// ── sanity: the shared hard-gate verdict on the EXACT incident flag ──
await test('shared coverQcGate rejects the exact incident flag: upscaled:main:2.69 ⇒ pass:false + needs_gap_search (this is what /cover-ref-test HARD-gates on ⇒ 422 + zero archive)', async () => {
  clearHardQc();
  const v = evaluateCoverQc({ qcFlags: ['upscaled:main:2.69'], refSimilarity: 80, manifest: {} });
  assert.strictEqual(v.pass, false, 'hero 2.69× > 1.2× ⇒ QC pass=false');
  assert.strictEqual(v.suggestedStatus, 'needs_gap_search', 'upscale fail ⇒ needs_gap_search (the intended bounded recovery)');
  assert.ok(Array.isArray(v.reasons) && v.reasons.length > 0, 'QC fail carries at least one reason');
});

// ── compose-test presents the SAME QC-failed output as success:true, but productionQcPass truthfully = false ──
await test('AC-0107 non-equivalence (frozen diagnostic mode): compose-test with a QC-FAILED render (upscaled:main:2.69) still returns HTTP 200 + success:true (ADVISORY) — but productionQcPass:false + qcVerdict.pass:false truthfully flag the Production hard-gate REJECT that /cover-ref-test enforces (422 + zero archive)', async () => {
  clearHardQc();
  globalThis.__CT_COMPOSE = composeYielding(['upscaled:main:2.69']);
  const res = await POST(mkReq());
  assert.strictEqual(res.status, 200, `advisory HTTP 200 preserved (frozen diagnostic mode intact) — got ${res.status}`);
  assert.strictEqual(res._body.success, true, 'advisory success:true follows out.success, NOT QC — this is what makes a green compose-test result ≠ Production parity');
  assert.strictEqual(res._body.frozenPlan, true, 'frozen diagnostic mode preserved');
  // truthful parity: the NEW indicator that stops success:true from misleading callers into thinking it is Production-safe
  assert.strictEqual(res._body.productionQcPass, false, 'productionQcPass:false — Production (/cover-ref-test) would 422 + zero-archive this exact output');
  assert.strictEqual(res._body.qcVerdict.pass, false, 'attached qcVerdict.pass:false (real shared gate)');
  assert.strictEqual(res._body.qcVerdict.suggestedStatus, 'needs_gap_search');
});

// ── ตรวจ (28 ก.ค. 69, ผู้ตรวจ): โหมด frozen ต้องไม่เรียก compassBrain และไม่ยิง gap-search เลย — regression ของ
//    MEGA_QUICK_GAP เอง (ย้าย compass+QUICK_GAP มาไว้ก่อนด่าน frozen จนโหมดแช่แข็งเสียเวลา compass 10-30s + อาจ
//    ยิง gap-search เป็นนาที ทั้งที่ไม่ใช้ผล จนชน AbortSignal/maxDuration ของ /m) — นับ call จริงต้องเป็น 0 ทั้งคู่
await test('frozen mode ต้องไม่เรียก compassBrain และไม่ยิง s5_gapsearch เลย (นับ call จริง = 0 ทั้งคู่ — กัน regression เสียเวลา/ชน timeout)', async () => {
  clearHardQc();
  globalThis.__CT_CALLS = { compass: 0, gapsearch: 0 };
  globalThis.__CT_COMPOSE = composeYielding([]);
  const res = await POST(mkReq());
  assert.strictEqual(res.status, 200, 'frozen request ยังต้องสำเร็จตามปกติ');
  assert.strictEqual(res._body.frozenPlan, true);
  assert.strictEqual(globalThis.__CT_CALLS.compass, 0, 'compassBrain ต้องไม่ถูกเรียกเลยในโหมด frozen');
  assert.strictEqual(globalThis.__CT_CALLS.gapsearch, 0, 's5_gapsearch ต้องไม่ถูกเรียกเลยในโหมด frozen');
});

// ── control: a QC-passing render ⇒ productionQcPass:true (parity indicator does not over-fire) ──
await test('control: a clean render (no stretch flags) ⇒ success:true AND productionQcPass:true (indicator is truthful, not always-false)', async () => {
  clearHardQc();
  globalThis.__CT_COMPOSE = composeYielding([]);
  const res = await POST(mkReq());
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(res._body.productionQcPass, true, 'clean cover ⇒ productionQcPass:true (would pass Production hard gate too)');
  assert.strictEqual(res._body.qcVerdict.pass, true);
});

// ── NORMAL (non-frozen) auto-archive branch: ★ 27 ก.ค. 69 (เจ้าของเคาะนโยบายใหม่ 27 ก.ค. 69 แทน AC-0107 เดิม
//    "เก็บทุกใบ+ติดป้ายสถานะ") — a QC-FAILED cover is NOW archived too, tagged qcStatus:'manual_review' for a human
//    to review later, instead of the old AC-0107 zero-archive gate ──
await test('archive policy REPLACED 27 ก.ค. 69 (เจ้าของเคาะนโยบายใหม่ "เก็บทุกใบ+ติดป้ายสถานะ" แทน AC-0107 เดิม): a QC-FAILED render (upscaled:main:2.69) still returns success:true (advisory) + productionQcPass:false, and IS now auto-archived with qcStatus:"manual_review" — the cover library keeps every render but flags QC-failed ones for manual review instead of zero-archiving them', async () => {
  clearHardQc();
  globalThis.__CT_ARCHIVE = 0;
  globalThis.__CT_COMPOSE = composeYielding(['upscaled:main:2.69']);
  const res = await POST(mkNormalReq());
  assert.strictEqual(res.status, 200, `advisory HTTP 200 (got ${res.status} ${JSON.stringify(res._body?.errorType || res._body?.error)})`);
  assert.strictEqual(res._body.success, true, 'advisory success:true preserved');
  assert.strictEqual(res._body.frozenPlan, undefined, 'NORMAL path (not frozen)');
  assert.strictEqual(res._body.productionQcPass, false, 'productionQcPass:false');
  assert.strictEqual(res._body.qcVerdict.pass, false, 'qcVerdict.pass:false');
  assert.strictEqual(res._body.qcStatus, 'manual_review', 'qcStatus:"manual_review" — new policy tags QC-failed covers for review instead of zero-archiving');
  assert.strictEqual(res._body.archivedId, 'CT-ARCH', 'archivedId set — QC-failed cover IS now archived (new policy)');
  assert.strictEqual(res._body.archiveSkipReason, null, 'archiveSkipReason:null — archive succeeded');
  assert.strictEqual(globalThis.__CT_ARCHIVE, 1, 'addMegaCover IS called for a QC-failed normal-path output (new policy: archive every render, tag status instead of zero-archive)');
});

await test('control (NORMAL path): a clean render (no stretch flags) IS auto-archived (the deliberate tuning-tool feature still works for QC-passing output)', async () => {
  clearHardQc();
  globalThis.__CT_ARCHIVE = 0;
  globalThis.__CT_COMPOSE = composeYielding([]);
  const res = await POST(mkNormalReq());
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res._body.success, true);
  assert.strictEqual(res._body.productionQcPass, true, 'clean ⇒ productionQcPass:true');
  assert.strictEqual(globalThis.__CT_ARCHIVE, 1, 'clean cover IS auto-archived (feature preserved)');
  assert.strictEqual(res._body.archivedId, 'CT-ARCH', 'archivedId surfaced');
});

await test('no network touched (fetch bomb uncalled)', async () => { assert.strictEqual(fetchBomb, 0, `fetch bomb = ${fetchBomb}`); });

if (ORIG_FETCH) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH); else delete globalThis.fetch;
console.log(`\n# ac0107-compose-test-parity: ${n - failed}/${n} passed`);
console.log(`1..${n}`);
if (failed) process.exitCode = 1;
