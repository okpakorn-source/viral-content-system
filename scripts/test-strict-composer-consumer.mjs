// ============================================================
// 🔐 STRICT COMPOSER CONSUMER — regression harness (Checkpoint B, 11 ก.ค.)
// ------------------------------------------------------------
// ทุกเทสยิง composeAndVerify "ตัวจริง" (ไม่จำลอง logic ซ้ำ) — no network/sharp/LLM:
//   · 'sharp' = ระเบิด (เส้น strict ห้ามแตะ sharp เลย — แตะ = fail ดัง)
//   · fetch = ระเบิด by default (ภาพใช้ data: URL ซึ่ง fetchOne ถอดเองไม่มี IO) — เทส 3 สลับเป็น fake ชั่วคราว
//   · faceDetector/executeCover = stub นับ call (พิสูจน์ fail-closed "ก่อน IO")
//   · openai = ตอบตามที่เทสกำหนดเท่านั้น ไม่กำหนด = ระเบิด
// ครอบ 11 ข้อบังคับของ Codex (ดูชื่อเทส) — fixture สัญญาสร้างด้วย refSlotContract/refTemplate ของจริง
// ============================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const MOD = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
// ★ รอบ 2: sharp = fake มีพฤติกรรม (ไม่ใช่ native — พิสูจน์ no-real-sharp เหมือนเดิม):
//   metadata กำหนดได้ per ขนาด buffer (__SHARP_META) · corrupt ได้ตามสั่ง (__SHARP_FAIL_LEN)
//   raw 8x8 สร้างจากเนื้อ buffer จริง → aHash uniform/varied แยกกันได้จริง (ด่าน blank_image ทำงาน)
//   ★ รอบ 4 (P1-2): นับทุก call (__SHARP_CALLS) — no-IO proof ต้องพิสูจน์ด้วยตัวนับจริง ไม่ใช่คำอ้าง
//   ★ รอบ 4 (P1-1): รองรับเส้น trimVividBorder จริง — resize(100)→raw = RGB 30000 ไบต์จากเนื้อ buffer;
//     __TRIM_LEN ตรงกับขนาด buffer ไหน = ฉีดแถบเขียวจัด 5 แถวบน (std 0 + chroma 255 = กรอบ artifact แท้)
//     → depth('t')=5 → extract→jpeg คืนเนื้อใหม่ 4321 ไบต์ (varied — ไม่ชน blank_image)
const SHARP_STUB = MOD(`
export default function sharp(buf){
  globalThis.__SHARP_CALLS = (globalThis.__SHARP_CALLS||0)+1;
  const fail = globalThis.__SHARP_FAIL_LEN === buf.length;
  const meta = (globalThis.__SHARP_META && globalThis.__SHARP_META[buf.length]) || { width: 1000, height: 1250 };
  let sized = 0, extracted = false;
  const chain = {
    metadata: async () => { if (fail) throw new Error('CORRUPT_IMAGE'); return meta; },
    greyscale(){ return chain; },
    resize(w){ sized = w; return chain; },
    raw(){ return chain; },
    jpeg(){ return chain; },
    extract(){ extracted = true; return chain; },
    toColourspace(){ return chain; },
    removeAlpha(){ return chain; },
    toBuffer: async () => {
      if (fail) throw new Error('CORRUPT_IMAGE');
      if (extracted) return Buffer.from(Array.from({ length: 4321 }, (_, i) => (i * 11 + 3) % 251));
      if (sized === 100) {
        const out = Buffer.alloc(30000);
        for (let i = 0; i < 30000; i++) out[i] = buf[(i * 13) % buf.length];
        if (globalThis.__TRIM_LEN === buf.length) {
          for (let y = 0; y < 5; y++) for (let x = 0; x < 100; x++) { const o = (y * 100 + x) * 3; out[o] = 0; out[o + 1] = 255; out[o + 2] = 0; }
        }
        return out;
      }
      return Buffer.from(Array.from({ length: 64 }, (_, i) => buf[(i * 97) % buf.length]));
    },
  };
  return chain;
}`);
// crypto ห่อของจริง — createHash ระเบิดได้ตามสั่ง (__HASH_MODE) เพื่อพิสูจน์ P0-3 strict manifest ห้าม fail-open
const CRYPTO_STUB = MOD(`
import real from 'node:crypto';
export default new Proxy(real, {
  get(t, k) {
    if (k === 'createHash') return (...a) => { if (globalThis.__HASH_MODE === 'fail') throw new Error('HASH_FAIL_TEST'); return real.createHash(...a); };
    return t[k];
  },
});`);
const OPENAI_STUB = MOD(`export async function callAI(){ const r = globalThis.__EYE_RESPONSE; if (!r) throw new Error('LLM_FORBIDDEN'); return r; }`);
const FD_STUB = MOD(`
export async function batchDetectFaces(items){
  globalThis.__FD_CALLS = (globalThis.__FD_CALLS||0)+1;
  const m = new Map();
  // ★ รอบ 5: โหมด zero ต้อง "มี mainSubject ขนาดจริง" — normalizeFaceBox จะคืน object truthy
  //   (count=0 กรอบศูนย์) = กับดัก semantic ที่ Codex ชี้ · โหมด one = ใบแรกมีหน้าจริงใบเดียว (control)
  const NORMAL = { imageWidth:1000, imageHeight:1250, hasFaces:true, faces:[{x:400,y:300,width:200,height:250}] };
  // ★ รอบ 7: subject กำหนดได้ต่อเทส (__FD_SUBJECT) — ใช้ยิงเคส edge/off-canvas/nonfinite
  const SUBJECT_ONLY = { imageWidth:1000, imageHeight:1250, hasFaces:false, faces:[], mainSubject: globalThis.__FD_SUBJECT || { x:100, y:100, width:600, height:800 } };
  items.forEach((it, idx) => {
    if (globalThis.__FD_MODE === 'zero') m.set(it.id, SUBJECT_ONLY);
    else if (globalThis.__FD_MODE === 'one') m.set(it.id, idx === 0 ? NORMAL : SUBJECT_ONLY);
    else m.set(it.id, NORMAL);
  });
  return m;
}
export async function detectFaces(){ throw new Error('DETECTFACES_FORBIDDEN'); }`);
const EXEC_STUB = MOD(`
export async function executeCover({ assignments, imageBuffers, templateSpec, faceBoxes, traceSink }){
  globalThis.__EXEC_CALLS = (globalThis.__EXEC_CALLS||0)+1;
  globalThis.__EXEC_SNAP = assignments.map((a)=>({ slot:a.slotId, idx:a.imageIndex, bytes: imageBuffers[a.imageIndex]?.buffer?.length || 0, crop: a.crop ? JSON.parse(JSON.stringify(a.crop)) : null }));
  if (globalThis.__EXEC_MODE === 'drift' && assignments[1]) assignments[1].imageIndex = 0; // จำลอง render layer เกเรเปลี่ยน source
  if (globalThis.__EXEC_MODE === 'mutate-template') templateSpec.slots[0].x = 999; // จำลอง render layer แอบแก้โครง (ต้องโดน freeze)
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

const { composeAndVerify, _runEyeFixTransaction } = await import('../src/lib/services/megaComposerService.js');
const { buildRefSlotContract, buildSelectionSpec } = await import('../src/lib/refSlotContract.js');
const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');

// ── การ์ดสิ่งแวดล้อม: network ระเบิด by default (★ รอบ 4: นับก่อน throw — fetchOne กลืน error
//    แต่ตัวนับพิสูจน์ว่ามีการ "พยายาม" ยิงจริง) · env สะอาด ──
const NET_BOMB = () => { globalThis.__FETCH_CALLS = (globalThis.__FETCH_CALLS || 0) + 1; throw new Error('NETWORK_FORBIDDEN'); };
globalThis.fetch = NET_BOMB;
delete process.env.MEGA_EYE_REQC;
delete process.env.MEGA_COVER_TESTER;
delete process.env.MEGA_STRICT_RENDER;

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };
const withStrict = async (fn) => {
  process.env.MEGA_STRICT_RENDER = '1';
  try { return await fn(); } finally { delete process.env.MEGA_STRICT_RENDER; }
};
// ★ รอบ 4 (P1-2): no-IO proof ครบ 4 ช่องทาง — fetch + sharp + face detector + renderer
const ioDelta = () => ({
  fetch: globalThis.__FETCH_CALLS || 0,
  sharp: globalThis.__SHARP_CALLS || 0,
  fd: globalThis.__FD_CALLS || 0,
  exec: globalThis.__EXEC_CALLS || 0,
});
const assertNoIO = (before) => {
  const now = ioDelta();
  assert.equal(now.fetch, before.fetch, 'ห้ามพยายามยิง network');
  assert.equal(now.sharp, before.sharp, 'ห้ามแตะ sharp');
  assert.equal(now.fd, before.fd, 'ห้ามแตะ face detector');
  assert.equal(now.exec, before.exec, 'ห้ามแตะ render');
};

// ── fixtures: สัญญาจริงจาก refSlotContract + realized จริงจาก refTemplate ──
const DNA3 = { template: { slots: [
  { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
  { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
  { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
] } };
// เนื้อ buffer ต้อง "ไม่ uniform" — aHash จริงของ strict จะได้ไม่ติด blank_image ทุกใบ · uniform = fixture blank โดยเฉพาะ
const VARIED = (size, seed) => { const b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = (i * 7 + seed) % 251; return b; };
const U = (tag, size = 6001) => 'data:image/jpeg;base64,' + VARIED(size, tag.charCodeAt(0)).toString('base64');
const U_BLANK = (size = 7777) => 'data:image/jpeg;base64,' + Buffer.alloc(size, 128).toString('base64');
const URLS = [U('h', 6001), U('c', 6002), U('m', 6003)];
const P = (cid, url) => ({ candidateId: cid, imageUrl: url, backups: [] });
const mkRealized = () => dnaToTemplateSpec(DNA3);
const mkSpec = (urls = URLS) => buildSelectionSpec({
  contract: buildRefSlotContract({ refDNA: DNA3 }),
  realizedTemplate: mkRealized(),
  plannedByRefSlot: { hero: P('H', urls[0]), context: P('C', urls[1]), moment: P('M', urls[2]) },
  refId: 'REF-STRICT-B',
});
// ★ รอบ 3 (FINAL P0): primary row ปกติทุกตัวต้องประกาศ refSlotId ถูกต้อง — สัญญา exact สามชั้นเป็นภาคบังคับ
const mkPlan = (urls = URLS) => [
  { url: urls[0], slot: 'hero', isHero: true, person: 'A', refSlotId: 'hero' },
  { url: urls[1], slot: 'context', person: 'B', refSlotId: 'context' },
  { url: urls[2], slot: 'moment', person: 'A', refSlotId: 'moment' }, // ⚠️ ตั้งใจ: วงกลมคนเดียวกับ hero — authority เลือกเอง strict ห้ามขัด
];
const mkArgs = (over = {}) => ({
  newsTitle: 'strict-b', slotPlan: mkPlan(), refDNA: null, refImagePath: null, stableOrder: true,
  selectionSpec: mkSpec(), realizedTemplate: mkRealized(), ...over,
});
assert.equal(mkSpec().strictReady, true, 'fixture ต้อง strictReady จริงก่อนเริ่ม');

await test('1) activation: NO carrier ⇒ legacy · V1-only carrier+OFF ⇒ legacy (item 7) · V2 carrier+OFF ⇒ LATCH_OFF · ON+present ⇒ strict ตื่น', async () => {
  // baseline = call ที่ "ไม่มี own selectionSpec" (legacy) — NO carrier เท่านั้นที่เป็น legacy parity
  const baseline = await composeAndVerify({ newsTitle: 'strict-b', slotPlan: [], refDNA: null });
  assert.equal(baseline.errorType, 'NO_SLOT_PLAN', 'baseline ต้องเป็น legacy error เดิม');
  // ★ (item 7) V1-ONLY carrier (own selectionSpec, no refHeroV2) + latch OFF ⇒ LEGACY parity (carrier ignored) —
  //   empty plan ⇒ the legacy NO_SLOT_PLAN error, NOT a strict HOLD (restores OFF parity for V1).
  const rOff = await composeAndVerify(mkArgs({ slotPlan: [] }));
  assert.equal(rOff.errorType, 'NO_SLOT_PLAN', 'V1-only carrier + unset latch ⇒ legacy (carrier ignored)');
  process.env.MEGA_STRICT_RENDER = '0';
  try {
    const rZero = await composeAndVerify(mkArgs({ slotPlan: [] }));
    assert.equal(rZero.errorType, 'NO_SLOT_PLAN', "V1-only carrier + '0' ⇒ legacy (carrier ignored)");
  } finally { delete process.env.MEGA_STRICT_RENDER; }
  // ★ (item 7) V2 carrier (refHeroV2) + latch OFF ⇒ STRICT_RENDER_LATCH_OFF (no downgrade — contrast to V1)
  const rV2Off = await composeAndVerify({ newsTitle: 'strict-b', slotPlan: mkPlan(), refDNA: null, refHeroV2: { ok: true } });
  assert.equal(rV2Off.errorType, 'STRICT_RENDER_LATCH_OFF', 'V2 carrier + unset latch ⇒ HOLD (no downgrade)');
  assert.deepEqual(rV2Off.reasons, ['strict_latch_off_v2_carrier_present']);
  await withStrict(async () => {
    // ON + ไม่มี own-property selectionSpec = งาน legacy จริง → ผลเต็มตรง baseline
    const rAbsent = await composeAndVerify({ newsTitle: 'strict-b', slotPlan: [], refDNA: null });
    assert.deepEqual(rAbsent, baseline, 'ON + absent spec = ผลเต็มตรง baseline (legacy)');
    // ON + present (แม้พัง) = strict ตื่นและ fail-closed — คอนทราสต์พิสูจน์ activation
    const rOn = await composeAndVerify(mkArgs({ selectionSpec: {}, slotPlan: [] }));
    assert.equal(rOn.errorType, 'STRICT_RENDER_CONTRACT_INVALID', 'ON + present = strict จับก่อน legacy check');
  });
});

await test('2) present-but-broken ทุกแบบ: fail-closed ก่อน IO (fetch/face/render = 0) + เหตุผล deterministic', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    for (const bad of [null, undefined, {}, { slots: 'bad' }, 42]) {
      const r = await composeAndVerify(mkArgs({ selectionSpec: bad }));
      assert.equal(r.success, false);
      assert.equal(r.errorType, 'STRICT_RENDER_CONTRACT_INVALID', `spec=${JSON.stringify(bad)}`);
      assert.ok(Array.isArray(r.reasons) && r.reasons.length >= 1, 'ต้องมี reasons');
    }
    // realized template หายทั้งก้อน → validator ฟ้อง realized_missing — ห้าม truthiness ถอย legacy
    const rNoRt = await composeAndVerify(mkArgs({ realizedTemplate: undefined }));
    assert.equal(rNoRt.errorType, 'STRICT_RENDER_CONTRACT_INVALID');
    assert.ok(rNoRt.reasons.includes('realized_missing'));
    // ผูก primary ไม่ได้ (slotPlan ว่าง) → ก่อน IO เช่นกัน
    const rNoPlan = await composeAndVerify(mkArgs({ slotPlan: [] }));
    assert.equal(rNoPlan.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
    assert.deepEqual(rNoPlan.reasons, ['primary_missing:main', 'primary_missing:context_1', 'primary_missing:circle']);
    assertNoIO(before);
    // determinism ของ reasons
    const a = await composeAndVerify(mkArgs({ selectionSpec: { slots: 'bad' } }));
    const b = await composeAndVerify(mkArgs({ selectionSpec: { slots: 'bad' } }));
    assert.equal(JSON.stringify(a.reasons), JSON.stringify(b.reasons));
  });
});

await test('3) exact primary binding ไม่ขึ้นกับลำดับ fetch เสร็จ: h ช้าสุด/m เร็วสุด → ทุกช่องยังได้ใบของตัวเอง', async () => {
  const HURLS = ['http://t.local/h.jpg', 'http://t.local/c.jpg', 'http://t.local/m.jpg'];
  const SIZES = { 'http://t.local/h.jpg': 7001, 'http://t.local/c.jpg': 7002, 'http://t.local/m.jpg': 7003 };
  const DELAY = { 'http://t.local/h.jpg': 30, 'http://t.local/c.jpg': 10, 'http://t.local/m.jpg': 0 };
  // เนื้อ varied กลางๆ — uniform มืด/สว่างจะโดน trimVividBorder (ที่ตอนนี้รันจริงในเส้น strict) มองเป็นกรอบทั้งใบ
  globalThis.fetch = (url) => new Promise((res) => setTimeout(() => res({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => VARIED(SIZES[String(url)], 7),
  }), DELAY[String(url)]));
  try {
    await withStrict(async () => {
      const r = await composeAndVerify(mkArgs({ selectionSpec: mkSpec(HURLS), slotPlan: mkPlan(HURLS) }));
      assert.equal(r.success, true, r.error);
      const bySlot = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
      assert.equal(bySlot.main.bytes, 7001, 'main ต้องได้ h.jpg แม้โหลดเสร็จท้ายสุด');
      assert.equal(bySlot.context_1.bytes, 7002);
      assert.equal(bySlot.circle.bytes, 7003, 'circle ต้องได้ m.jpg แม้โหลดเสร็จก่อนใคร');
      assert.deepEqual([bySlot.main.idx, bySlot.context_1.idx, bySlot.circle.idx], [0, 1, 2], 'index = ลำดับ authority เสมอ');
    });
  } finally { globalThis.fetch = NET_BOMB; }
});

await test('4) primary หาย/ซ้ำในแผน/โหลดพัง → STRICT_PRIMARY_UNAVAILABLE — ไม่มี backup/thumbnail ช่วย', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    // หาย: แผนไม่มีใบของ context
    const planMissing = mkPlan().filter((p) => p.url !== URLS[1]);
    const r1 = await composeAndVerify(mkArgs({ slotPlan: planMissing }));
    assert.equal(r1.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
    assert.deepEqual(r1.reasons, ['primary_missing:context_1']);
    // ซ้ำ: URL เดียวกันสองรายการ = กำกวม ห้ามเดา
    const r2 = await composeAndVerify(mkArgs({ slotPlan: [...mkPlan(), { url: URLS[1], slot: 'extra' }] }));
    assert.equal(r2.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
    assert.deepEqual(r2.reasons, ['primary_duplicate_in_plan:context_1']);
    assertNoIO(before); // ทั้งสองเคสจับก่อน IO
    // โหลดพัง (ไฟล์จิ๋วเกินใช้): thumbnailUrl ใหญ่สวยวางล่อไว้ — strict ห้ามแตะ
    const tiny = U('t', 100);
    const spec3 = mkSpec([URLS[0], tiny, URLS[2]]);
    const plan3 = mkPlan([URLS[0], tiny, URLS[2]]);
    plan3[1].thumbnailUrl = URLS[1]; // เหยื่อล่อ fallback
    const r3 = await composeAndVerify(mkArgs({ selectionSpec: spec3, slotPlan: plan3 }));
    assert.equal(r3.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
    assert.deepEqual(r3.reasons, ['primary_unusable:context_1']);
    assert.equal(ioDelta().exec, before.exec, 'ห้ามถึง render');
  });
});

await test('5) realized geometry พัง → STRICT_TEMPLATE_INVALID ก่อน IO (ห้าม recompute/fallback template)', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    const cases = [
      [(rt) => { rt.slots[0].w = -5; }, 'slot_size_not_positive:main'],
      [(rt) => { rt.slots[1].x = 'abc'; }, 'slot_geometry_not_finite:context_1'],
      // ★ รอบ 2 (P1): numeric string ห้ามถูก Number() ซ่อมเงียบ — typeof number แท้เท่านั้น
      [(rt) => { rt.slots[1].x = '10'; }, 'slot_geometry_not_finite:context_1'],
      [(rt) => { rt.canvasW = 0; }, 'canvas_invalid'],
      [(rt) => { rt.canvasW = '1080'; }, 'canvas_invalid'],
      // ★ รอบ 4 (P1-5): canvas ต้อง exact 1080×1350 ตามสัญญา refTemplate — จิ๋ว/มหาศาลตกหมด
      [(rt) => { rt.canvasW = 1; rt.canvasH = 1; }, 'canvas_invalid'],
      [(rt) => { rt.canvasW = 100000; rt.canvasH = 100000; }, 'canvas_invalid'],
      [(rt) => { rt.canvasW = 1080; rt.canvasH = 1349; }, 'canvas_invalid'],
      [(rt) => { rt.slots[0].w = rt.canvasW * 3; }, 'slot_out_of_canvas:main'],
      // ★ รอบ 2 (P1): exact bounds ไม่มี tolerance — ล้น 1px = ตก · ล้น 0.1px = ตก (จับที่ integer rule)
      [(rt) => { rt.slots[0].w = (rt.canvasW - rt.slots[0].x) + 1; }, 'slot_out_of_canvas:main'],
      [(rt) => { rt.slots[0].w = (rt.canvasW - rt.slots[0].x) + 0.1; }, 'slot_geometry_not_integer:main'],
      [(rt) => { rt.slots[1].h = 10.5; }, 'slot_geometry_not_integer:context_1'],
      [(rt) => { rt.slots[2].y = NaN; }, 'slot_geometry_not_finite:circle'],
    ];
    for (const [mut, reason] of cases) {
      const rt = mkRealized();
      mut(rt);
      const r = await composeAndVerify(mkArgs({ realizedTemplate: rt }));
      assert.equal(r.errorType, 'STRICT_TEMPLATE_INVALID', reason);
      assert.ok(r.reasons.includes(reason), `ต้องมี ${reason} (ได้: ${r.reasons})`);
    }
    assertNoIO(before);
  });
});

await test('6) duplicated roles (context สองช่อง) + สอง circle (circle/circle1): ทุกช่อง map exact ด้วย composerSlotId', async () => {
  const DNA4 = { template: { slots: [
    { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
    { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 50 },
    { role: 'context', shape: 'rect', xPct: 55, yPct: 50, wPct: 45, hPct: 50 },
    { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
  ] } };
  const contract4 = buildRefSlotContract({ refDNA: DNA4 });
  const realized4 = dnaToTemplateSpec(DNA4);
  const urls4 = [U('1', 8001), U('2', 8002), U('3', 8003), U('4', 8004)];
  const planned4 = Object.fromEntries(contract4.slots.map((cs, i) => [cs.id, P(`K${i}`, urls4[i])]));
  const spec4 = buildSelectionSpec({ contract: contract4, realizedTemplate: realized4, plannedByRefSlot: planned4, refId: 'REF-DUP-ROLE' });
  assert.equal(spec4.strictReady, true, 'สัญญา 4 ช่อง (context ซ้ำบท) ต้อง ready');
  const plan4 = urls4.map((u, i) => ({ url: u, slot: `s${i}`, person: `P${i}`, refSlotId: contract4.slots[i].id }));
  await withStrict(async () => {
    const r = await composeAndVerify(mkArgs({ selectionSpec: spec4, realizedTemplate: realized4, slotPlan: plan4 }));
    assert.equal(r.success, true, r.error);
    const bySlot = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s.bytes]));
    // แต่ละ composer slot ต้องได้ใบของตัวเองตาม authority เป๊ะ — ไม่ใช่ตามตำแหน่ง/บทซ้ำ
    for (let i = 0; i < spec4.slots.length; i++) {
      const cs = spec4.slots[i];
      const wantBytes = 8001 + urls4.indexOf(cs.primary.imageUrl);
      assert.equal(bySlot[cs.composerSlotId], wantBytes, `${cs.composerSlotId} ต้องได้ใบของ ${cs.refSlotId}`);
    }
    // สอง circle: realized ให้ id unique จริง ('circle','circle1') → strict ต้อง map exact รายวง
    //   (moment→circle, moment_2→circle1) ไม่ใช่เดา/สลับตามตำแหน่ง
    const DNA2C = { template: { slots: [
      { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
      { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
      { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 24, hPct: 20 },
      { role: 'moment', shape: 'circle', xPct: 60, yPct: 60, wPct: 24, hPct: 20 },
    ] } };
    const c2 = buildRefSlotContract({ refDNA: DNA2C });
    const rt2 = dnaToTemplateSpec(DNA2C);
    assert.deepEqual(rt2.slots.map((s) => s.id), ['main', 'context_1', 'circle', 'circle1'], 'realized สองวงต้องได้ id unique');
    const urls2c = [U('5', 9101), U('6', 9102), U('7', 9103), U('8', 9104)];
    const p2 = Object.fromEntries(c2.slots.map((cs, i) => [cs.id, P(`Q${i}`, urls2c[i])]));
    const spec2c = buildSelectionSpec({ contract: c2, realizedTemplate: rt2, plannedByRefSlot: p2, refId: 'REF-2C' });
    assert.equal(spec2c.strictReady, true);
    const r2c = await composeAndVerify(mkArgs({ selectionSpec: spec2c, realizedTemplate: rt2, slotPlan: c2.slots.map((cs, i) => ({ url: p2[cs.id].imageUrl, slot: `x${i}`, refSlotId: cs.id })) }));
    assert.equal(r2c.success, true, r2c.error);
    const by2c = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s.bytes]));
    for (const cs of spec2c.slots) {
      assert.equal(by2c[cs.composerSlotId], 9101 + urls2c.indexOf(cs.primary.imageUrl), `${cs.composerSlotId} ← ${cs.refSlotId} ต้อง exact`);
    }
  });
});

await test('7) source lock: Eye สั่ง swap ถูกปฏิเสธ · crop action ยังทำงาน · ไม่มีธง circle_same_person · source ไม่ขยับ', async () => {
  await withStrict(async () => {
    globalThis.__EYE_RESPONSE = {
      grid: true, inserts: true, hero_shot: true, sub_shots: false, crops: true,
      diffs: ['เทส'], fixes: [{ slot: 'context_1', action: 'swap' }, { slot: 'context_1', action: 'shift_up' }],
    };
    try {
      const r = await composeAndVerify(mkArgs({ refImagePath: U('r', 5500) }));
      assert.equal(r.success, true, r.error);
      assert.equal(r.eyeFixed, 1, 'swap โดนปฏิเสธ · shift_up (crop) นับ 1');
      const bySlot = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
      assert.deepEqual([bySlot.main.idx, bySlot.context_1.idx, bySlot.circle.idx], [0, 1, 2], 'source ทุกช่องยังตรง authority หลัง Eye');
      assert.equal(bySlot.context_1.bytes, 6002, 'context ยังใบเดิม (swap ไม่เกิด)');
      // แผนตั้งใจให้วงกลมคนเดียวกับ hero (person A ทั้งคู่) — strict ต้องไม่ swap และไม่ติดธง
      assert.ok(!(r.qcFlags || []).includes('circle_same_person_as_hero'), 'authority ตั้งใจใช้คนซ้ำ = ไม่ใช่ความผิด');
      assert.equal(r.manifest?.strictRender?.verified, true, 'ผ่าน invariant + ได้ audit');
    } finally { delete globalThis.__EYE_RESPONSE; }
  });
});

await test('8) deliberate drift (render layer เปลี่ยน imageIndex) → STRICT_ASSIGNMENT_DRIFT · ไม่มี manifest success', async () => {
  await withStrict(async () => {
    globalThis.__EXEC_MODE = 'drift';
    try {
      const r = await composeAndVerify(mkArgs());
      assert.equal(r.success, false);
      assert.equal(r.errorType, 'STRICT_ASSIGNMENT_DRIFT');
      assert.ok(r.reasons.some((x) => String(x).startsWith('image_index_drift:context_1')), `ได้: ${r.reasons}`);
      // ★ รอบ 2 (P1): drift แบบนี้ทำ used ≠ เซ็ต index สุดท้ายด้วย — invariant ต้องจับทั้งสองมิติ
      assert.ok(r.reasons.some((x) => String(x).startsWith('used_set_mismatch')), `used ต้องถูกจับ (ได้: ${r.reasons})`);
      assert.equal(r.manifest, undefined, 'ห้ามปล่อย manifest ใดๆ เมื่อ drift');
      assert.equal(r.base64, undefined, 'ห้ามปล่อยภาพ success');
    } finally { delete globalThis.__EXEC_MODE; }
  });
});

await test('9) success: manifest.strictRender ตรง authority ทุกช่อง + verified=true (legacy ไม่มี field นี้)', async () => {
  await withStrict(async () => {
    const spec = mkSpec();
    const r = await composeAndVerify(mkArgs({ selectionSpec: spec }));
    assert.equal(r.success, true, r.error);
    const sr = r.manifest?.strictRender;
    assert.equal(sr?.verified, true);
    assert.equal(sr.refId, 'REF-STRICT-B');
    assert.equal(sr.specHash, spec.specHash);
    assert.equal(sr.replayHash, spec.replayHash);
    assert.deepEqual(sr.slots, spec.slots.map((s) => ({
      composerSlotId: s.composerSlotId, refSlotId: s.refSlotId, candidateId: s.primary.candidateId, imageUrl: s.primary.imageUrl,
    })));
    // URL จริงที่ขึ้นปก (จาก loaded ผ่าน placed/crops) ต้องตรง authority ต่อช่อง
    for (const c of r.crops) {
      const want = spec.slots.find((s) => s.composerSlotId === c.slot)?.primary.imageUrl;
      assert.equal(c.url, want, `crops.${c.slot} ต้องชี้ URL ของ authority`);
    }
  });
});

await test('10) determinism: input เดิม 2 รอบ → ผลลัพธ์ byte-identical', async () => {
  await withStrict(async () => {
    const run = async () => {
      const r = await composeAndVerify(mkArgs());
      return JSON.stringify({ success: r.success, placed: r.placed, crops: r.crops, qcFlags: r.qcFlags, strictRender: r.manifest?.strictRender, outputHash: r.manifest?.outputHash });
    };
    assert.equal(await run(), await run());
  });
});

await test('11) source guard: canonical latch + versioned dispatch · route own-property additive · strict ไม่มี template fallback · invariant หลัง Eye ก่อน manifest', async () => {
  const svcSrc = readFileSync(new URL('../src/lib/services/megaComposerService.js', import.meta.url), 'utf8');
  const routeSrc = readFileSync(new URL('../src/app/api/mega/compose/route.js', import.meta.url), 'utf8');
  // ★ P0-1: canonical latch = MEGA_STRICT_RENDER === '1' เท่านั้น · alias V2 ต้องสูญพันธุ์จากทั้งไฟล์
  assert.ok(!svcSrc.includes('MEGA_STRICT_RENDER_V2') && !routeSrc.includes('MEGA_STRICT_RENDER_V2'), 'ห้ามมี alias MEGA_STRICT_RENDER_V2');
  assert.ok(!/MEGA_STRICT_RENDERER\b/.test(svcSrc), 'ห้ามมี alias MEGA_STRICT_RENDERER ใน service');
  assert.ok(svcSrc.includes("latchArmed: process.env.MEGA_STRICT_RENDER === '1'"), 'canonical latch === "1" ส่งเข้า seam (seam owns the latch decision)');
  // ★ P0-1: version selection = validateStrictRenderActivationVersioned (peek selectionSpec.v) — ไม่ใช่ env
  assert.ok(svcSrc.includes('validateStrictRenderActivationVersioned'), 'ต้องใช้ versioned dispatcher');
  assert.ok(!svcSrc.includes('validateStrictRenderActivation(carrier)'), 'ต้องไม่เรียก V1 validator ตรง (ผ่าน versioned)');
  // route: ส่งผ่านแบบ own-property "additive" เท่านั้น (ไม่มี env gate ที่ route) ห้ามสร้าง payload เอง
  assert.ok(routeSrc.includes("hasOwnProperty.call(body, 'selectionSpec')"), 'route เช็ค own-property selectionSpec');
  assert.ok(routeSrc.includes("hasOwnProperty.call(body, 'realizedTemplate')"), 'route เช็ค own-property realizedTemplate');
  assert.ok(routeSrc.includes("hasOwnProperty.call(body, 'refHeroV2')"), 'route forward refHeroV2 own-property');
  assert.ok(routeSrc.includes('payload.selectionSpec = body.selectionSpec') && routeSrc.includes('payload.refHeroV2 = body.refHeroV2'), 'pass-through ตรงๆ');
  // ★ P0-2 NO DOWNGRADE: carrier present + latch off ⇒ STRICT_RENDER_LATCH_OFF (มีในโค้ด consumer)
  assert.ok(svcSrc.includes('STRICT_RENDER_LATCH_OFF'), 'ต้องมี HOLD code STRICT_RENDER_LATCH_OFF');
  // service: the shared seam (_strictActivate) ต้องถูกเรียกก่อน composeCore เสมอ
  const iCompose = svcSrc.indexOf('export async function composeAndVerify');
  const iGate = svcSrc.indexOf("_strictActivate({ args, latchArmed: process.env.MEGA_STRICT_RENDER === '1' })", iCompose);
  const iCore = svcSrc.indexOf('composeCore({ slotPlan, refDNA, stableOrder, strictCtx })', iCompose);
  assert.ok(iCompose > 0 && iGate > iCompose && iCore > iGate, 'ลำดับ: composeAndVerify → strict seam → composeCore');
  // ★ (P0-A) the seam is the FIRST observation of args — NO business-field destructure/[[Get]] before it
  const iBizDestructure = svcSrc.indexOf('const { newsTitle', iCompose);
  assert.ok(iBizDestructure > iGate, 'seam (_strictActivate) ต้องเป็น observation แรกของ args — ก่อน destructure business fields (P0-A)');
  // the seam receives RAW args only + explicit latch — NO caller-supplied snapshot path (P1: unforgeable)
  assert.ok(!svcSrc.includes('snapshot: _carrierSnap') && !/_strictActivate\([^)]*snapshot/.test(svcSrc), 'ห้ามมี caller-supplied snapshot ส่งเข้า seam (unforgeable)');
  // strict path ต้องไม่มีทางเข้า template fallback ใดๆ
  const iStrictFn = svcSrc.indexOf('async function composeCoreStrict');
  const iStrictEnd = svcSrc.indexOf('function _strictDriftCheck');
  const strictBody = svcSrc.slice(iStrictFn, iStrictEnd);
  for (const banned of ['dnaToTemplateSpec', 'pickTemplateForDNA', 'V3_TEMPLATES', 'thumbnailUrl']) {
    assert.ok(!strictBody.includes(banned), `เส้น strict ห้ามมี ${banned}`);
  }
  // ★ P1: hero crop authority ห้ามใช้ regex /main|hero/ บนเส้น V2 — ต้องผ่าน heroComposerSlotId
  assert.ok(strictBody.includes('heroComposerSlotId'), 'composeCoreStrict ต้องแมป hero ผ่าน heroComposerSlotId (V2)');
  // invariant: หลังบล็อก Eye (catch ตาเทียบ) · ก่อน techRules และ manifest
  const iEyeCatch = svcSrc.indexOf("ตาเทียบ ref ล้ม (ใช้ปกเดิม)");
  const iInvariant = svcSrc.indexOf('_strictDriftCheck(core, strictCtx)', iCompose);
  const iTech = svcSrc.indexOf('measureTechRules({', iCompose);
  const iManifest = svcSrc.indexOf('manifest = {', iCompose);
  assert.ok(iEyeCatch > 0 && iInvariant > iEyeCatch && iTech > iInvariant && iManifest > iInvariant, 'invariant ต้องอยู่หลัง Eye ก่อน techRules/manifest');
  // strictRender เขียนจุดเดียว ใต้ if (strictCtx) — legacy manifest ไม่มีทางมี field นี้
  assert.ok(/if \(strictCtx\) \{\s*\n\s*manifest\.strictRender/.test(svcSrc));
  // strict dispatch ต้องมาก่อน legacy guard ทุกตัวใน composeCore
  const iCoreFn = svcSrc.indexOf('async function composeCore(');
  const iDispatch = svcSrc.indexOf('if (strictCtx) return composeCoreStrict(strictCtx);', iCoreFn);
  const iNoPlan = svcSrc.indexOf("errorType: 'NO_SLOT_PLAN'", iCoreFn);
  assert.ok(iDispatch > iCoreFn && iNoPlan > iDispatch, 'strict dispatch ต้องนำหน้า NO_SLOT_PLAN');
  // postcondition ยืนกั้น "ทันทีก่อน" success return ของ composeAndVerify
  const iPost = svcSrc.indexOf('strictRender?.verified !== true', iCompose);
  const iSuccessRet = svcSrc.indexOf('base64: `data:image/jpeg;base64,${buffer.toString', iCompose);
  assert.ok(iPost > iCompose && iSuccessRet > iPost, 'postcondition ต้องอยู่ก่อน success return');
});

await test('12) (P0-1) carrier แปลก: array/function พก own selectionSpec → input_not_plain_object ก่อน IO — ไม่ใช่ legacy', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    const arr = [];
    arr.selectionSpec = mkSpec();
    arr.realizedTemplate = mkRealized();
    arr.slotPlan = mkPlan();
    const rA = await composeAndVerify(arr);
    assert.equal(rA.success, false);
    assert.equal(rA.errorType, 'STRICT_RENDER_CONTRACT_INVALID');
    assert.deepEqual(rA.reasons, ['input_not_plain_object'], 'array carrier ต้องโดนกฎ validator ตรงตัว');
    const fn = () => {};
    fn.selectionSpec = mkSpec();
    fn.realizedTemplate = mkRealized();
    fn.slotPlan = mkPlan();
    const rF = await composeAndVerify(fn);
    assert.equal(rF.errorType, 'STRICT_RENDER_CONTRACT_INVALID');
    assert.deepEqual(rF.reasons, ['input_not_plain_object']);
    assertNoIO(before);
    // carrier แบบเดียวกันแต่ "ไม่พก" property + ON = legacy แท้
    const rPlain = await composeAndVerify([]);
    assert.equal(rPlain.errorType, 'NO_SLOT_PLAN');
  });
});

await test('13) (P0-2) identity สองชั้น + TOCTOU: refSlotId mismatch = fail ก่อน IO · mutate slotPlan หลังเริ่ม = ไร้ผล', async () => {
  await withStrict(async () => {
    const before = ioDelta();
    // plan ประกาศ refSlotId ผิดตัว → primary_ref_mismatch (ก่อน IO)
    const planBad = mkPlan();
    planBad[1].refSlotId = 'WRONG';
    const r1 = await composeAndVerify(mkArgs({ slotPlan: planBad }));
    assert.equal(r1.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
    assert.deepEqual(r1.reasons, ['primary_ref_mismatch:context_1']);
    assertNoIO(before);
    // ประกาศถูกตัว → ผ่านปกติ
    const planOk = mkPlan();
    planOk[1].refSlotId = 'context';
    const r2 = await composeAndVerify(mkArgs({ slotPlan: planOk }));
    assert.equal(r2.success, true, r2.error);
    // TOCTOU: ทำลาย plan object+array ทันทีหลังเริ่ม call — binding เป็นสำเนาแช่แข็งก่อน await แรกแล้ว
    const planMut = mkPlan();
    const promise = composeAndVerify(mkArgs({ slotPlan: planMut }));
    planMut[0].url = 'data:image/jpeg;base64,SEVL';
    planMut[1].person = 'HACKED';
    planMut.length = 0;
    const r3 = await promise;
    assert.equal(r3.success, true, r3.error);
    assert.deepEqual(r3.manifest.strictRender.slots.map((s) => s.imageUrl), URLS, 'URL/identity ต้องเป็นค่าตอน bind ไม่ใช่หลัง mutate');
    for (const c of r3.crops) assert.ok(URLS.includes(c.url), `crops.${c.slot} ต้องเป็น URL เดิม`);
  });
});

await test('14) (P0-3) manifest สร้างล้ม → STRICT_MANIFEST_FAILED — strict ห้าม success พร้อม manifest หาย/ไม่ verified', async () => {
  await withStrict(async () => {
    globalThis.__HASH_MODE = 'fail'; // crypto.createHash ระเบิด → legacy catch เดิมกลืน → manifest = null
    try {
      const r = await composeAndVerify(mkArgs());
      assert.equal(r.success, false, 'strict + manifest ล้ม ต้องไม่ success');
      assert.equal(r.errorType, 'STRICT_MANIFEST_FAILED');
      assert.deepEqual(r.reasons, ['manifest_unverified']);
      assert.equal(r.base64, undefined, 'ห้ามปล่อยภาพ');
      assert.equal(r.manifest, undefined);
    } finally { delete globalThis.__HASH_MODE; }
    const rOk = await composeAndVerify(mkArgs());
    assert.equal(rOk.success, true, 'ปลดตัวก่อกวนแล้วต้องกลับมาปกติ');
    assert.equal(rOk.manifest?.strictRender?.verified, true);
  });
});

await test('15) (P1) โครงแช่แข็งจริง: executor แอบ mutate template → โดนบล็อก ไม่มีทางหลุดเป็น success', async () => {
  await withStrict(async () => {
    globalThis.__EXEC_MODE = 'mutate-template';
    try {
      const r = await composeAndVerify(mkArgs());
      assert.equal(r.success, false, 'mutate โครง strict ต้องไม่รอด');
      assert.ok(['COMPOSE_FAILED', 'STRICT_ASSIGNMENT_DRIFT'].includes(r.errorType), `ได้ ${r.errorType} (freeze โยน หรือ drift จับ — อย่างใดอย่างหนึ่ง)`);
    } finally { delete globalThis.__EXEC_MODE; }
  });
});

await test('16) (P1 คุณภาพ) blank_image/low-res ติดธงจริง · corrupt = unreadable · source ล็อกแม้คุณภาพแย่', async () => {
  await withStrict(async () => {
    // blank: วงกลมใช้ภาพ uniform → aHash จริง popcount สุดขั้ว → ธง blank_image:circle · source เดิม
    const urlsB = [U('h', 6601), U('c', 6602), U_BLANK(7777)];
    const rB = await composeAndVerify(mkArgs({ selectionSpec: mkSpec(urlsB), slotPlan: mkPlan(urlsB) }));
    assert.equal(rB.success, true, rB.error);
    assert.ok((rB.qcFlags || []).includes('blank_image:circle'), `ด่าน blank_image ต้องไม่ถูก bypass (ได้: ${rB.qcFlags})`);
    const byB = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
    assert.equal(byB.circle.bytes, 7777, 'ภาพ blank ยังอยู่ช่องเดิม — ธงได้ เปลี่ยนไม่ได้');
    // low-res: ไฟล์จริง context = 150x180 (sharp metadata จริง) → upscaled_src ติดธง · ห้าม swap
    globalThis.__SHARP_META = { 6002: { width: 150, height: 180 } };
    try {
      const rL = await composeAndVerify(mkArgs());
      assert.equal(rL.success, true, rL.error);
      assert.ok((rL.qcFlags || []).some((f) => String(f).startsWith('upscaled_src:context_1:')), `ต้องติดธงยืดจากมิติไฟล์จริง (ได้: ${rL.qcFlags})`);
      const byL = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
      assert.equal(byL.context_1.idx, 1, 'low-res source lock — ห้ามเลือกใบอื่น');
    } finally { delete globalThis.__SHARP_META; }
    // corrupt/unreadable: sharp อ่าน metadata ไม่ได้ → STRICT_PRIMARY_UNAVAILABLE
    globalThis.__SHARP_FAIL_LEN = 6002;
    try {
      const rC = await composeAndVerify(mkArgs());
      assert.equal(rC.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
      assert.deepEqual(rC.reasons, ['primary_unreadable:context_1']);
    } finally { delete globalThis.__SHARP_FAIL_LEN; }
  });
});

await test('17) (FINAL P0) refSlotId ภาคบังคับ: หาย/null/ว่าง → STRICT_PRIMARY_UNAVAILABLE ก่อน fetch/sharp/face/render', async () => {
  await withStrict(async () => {
    // ★ รอบ 4 (P1-2): ใช้ HTTP primary URLs — ถ้า binding หลุดไปถึง fetchOne จริง global fetch (NET_BOMB)
    //   จะถูก "นับ" แม้ fetchOne กลืน error (data URL พิสูจน์ network ไม่ได้เพราะ decode local)
    const HU = ['http://t.local/p0h.jpg', 'http://t.local/p0c.jpg', 'http://t.local/p0m.jpg'];
    const specH = mkSpec(HU);
    const rtH = mkRealized();
    const mkPlanH = () => [
      { url: HU[0], slot: 'hero', isHero: true, person: 'A', refSlotId: 'hero' },
      { url: HU[1], slot: 'context', person: 'B', refSlotId: 'context' },
      { url: HU[2], slot: 'moment', person: 'A', refSlotId: 'moment' },
    ];
    const before = ioDelta();
    // ลบ refSlotId ออกจาก primary row เดียว — เดิม (optional check) เคยหลุดผ่าน = ช่องโหว่ที่ Codex ชี้
    for (const strip of [
      (p) => { delete p.refSlotId; },
      (p) => { p.refSlotId = null; },
      (p) => { p.refSlotId = undefined; },
      (p) => { p.refSlotId = ''; },
      (p) => { p.refSlotId = '   '; },
    ]) {
      const plan = mkPlanH();
      strip(plan[1]);
      const r = await composeAndVerify(mkArgs({ selectionSpec: specH, realizedTemplate: rtH, slotPlan: plan }));
      assert.equal(r.success, false);
      assert.equal(r.errorType, 'STRICT_PRIMARY_UNAVAILABLE');
      assert.deepEqual(r.reasons, ['primary_ref_mismatch:context_1'], `strip=${strip.toString().slice(0, 40)}`);
    }
    assertNoIO(before); // ทั้ง 5 เคสตายก่อน IO — fetch/sharp/face/render ทุกตัวนับได้ 0
    // แผนครบ refSlotId ถูกต้อง → ยังผ่านปกติ (ยืนยันไม่ได้ทำ fixture พังทั้งกระดาน)
    const rOk = await composeAndVerify(mkArgs());
    assert.equal(rOk.success, true, rOk.error);
  });
});

await test('18) (P1-1) trimVividBorder จริงบน exact primary: buffer เปลี่ยน + ธง border_trimmed · identity/URL/index นิ่งสนิท', async () => {
  await withStrict(async () => {
    globalThis.__TRIM_LEN = 6002; // ฉีดกรอบเขียว 5 แถวบนให้เฉพาะภาพ context (ผ่าน seam sharp ของ trim จริง)
    try {
      const r = await composeAndVerify(mkArgs());
      assert.equal(r.success, true, r.error);
      assert.ok((r.qcFlags || []).includes('border_trimmed:context_1'), `ธง trim ต้องติดแบบ deterministic (ได้: ${r.qcFlags})`);
      assert.equal((r.qcFlags || []).filter((f) => String(f).startsWith('border_trimmed:')).length, 1, 'trim เฉพาะใบที่มีกรอบจริง');
      const by = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
      assert.equal(by.context_1.bytes, 4321, 'buffer ที่ render ต้องเป็นเนื้อหลัง trim (same-asset preprocessing)');
      assert.equal(by.main.bytes, 6001, 'ใบอื่นไม่โดน trim');
      assert.deepEqual([by.main.idx, by.context_1.idx, by.circle.idx], [0, 1, 2], 'imageIndex ห้ามขยับ — ไม่ใช่ source swap');
      // identity/URL ใน audit ต้องยังเป็น URL ต้นฉบับเป๊ะ (asset เดิม แค่ตัดกรอบ)
      assert.deepEqual(r.manifest.strictRender.slots.map((s) => s.imageUrl), URLS);
      for (const c of r.crops) assert.ok(URLS.includes(c.url), `crops.${c.slot} URL เดิม`);
      assert.equal(r.manifest.strictRender.verified, true, 'ผ่าน invariant ครบ (loaded identity ไม่ drift)');
    } finally { delete globalThis.__TRIM_LEN; }
  });
});

await test('19) (P1-4) FD ล่มทั้งชุด: retry 1 รอบ (FD=2 call) แล้ว expected≥2 → FACE_EYE_DOWN ก่อน render · expected<2 → fallback เดิม', async () => {
  await withStrict(async () => {
    globalThis.__FD_MODE = 'zero';
    try {
      // binding metadata ยืนยันมีหน้า ≥2 ใบ → detector ล่มยาว = error ให้คิววน ห้าม blind crop
      const planF = mkPlan();
      planF[0].faces = 1;
      planF[1].faces = 2;
      const before = ioDelta();
      const r = await composeAndVerify(mkArgs({ slotPlan: planF }));
      assert.equal(r.success, false);
      assert.equal(r.errorType, 'FACE_EYE_DOWN');
      assert.equal((globalThis.__FD_CALLS || 0) - before.fd, 2, 'ต้อง retry เป๊ะ 1 รอบ (รวม 2 call)');
      assert.equal((globalThis.__EXEC_CALLS || 0) - before.exec, 0, 'ห้ามถึง render');
      // expected <2 (แผนไม่ประกาศ faces) → fallback crop ตามสัญญาเดิม — ไม่ใช่ face lock
      const before2 = ioDelta();
      const r2 = await composeAndVerify(mkArgs());
      assert.equal(r2.success, true, r2.error);
      assert.equal((globalThis.__FD_CALLS || 0) - before2.fd, 2, 'retry แล้วเดินต่อ');
      assert.equal((globalThis.__EXEC_CALLS || 0) - before2.exec, 1, 'render ปกติด้วย crop fallback');
      const by = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
      assert.deepEqual([by.main.idx, by.context_1.idx, by.circle.idx], [0, 1, 2], 'ไม่มีการแตะ asset ใดๆ ทั้งสองเคส');
    } finally { delete globalThis.__FD_MODE; }
    // ★ รอบ 5 (control): หน้าจริง 1 ใบ (ที่เหลือ subject-only) ต้องไม่ถูกมองเป็น outage —
    //   ไม่ retry ไม่ FACE_EYE_DOWN ไม่มีกฎคน/identity เพิ่ม แม้แผนประกาศ faces ≥2
    globalThis.__FD_MODE = 'one';
    try {
      const planC = mkPlan();
      planC[0].faces = 1;
      planC[1].faces = 2;
      const before3 = ioDelta();
      const r3 = await composeAndVerify(mkArgs({ slotPlan: planC }));
      assert.equal(r3.success, true, r3.error);
      assert.equal((globalThis.__FD_CALLS || 0) - before3.fd, 1, 'หน้าจริง ≥1 = ไม่ใช่ outage ห้าม retry');
      const by3 = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
      assert.deepEqual([by3.main.idx, by3.context_1.idx, by3.circle.idx], [0, 1, 2], 'source นิ่ง — ไม่มี face lock/กติกาคนรายช่อง');
      assert.equal(r3.manifest?.strictRender?.verified, true);
    } finally { delete globalThis.__FD_MODE; }
  });
});

await test('20) (P1-B/รอบ7) subject-only: hint ขอบเขตแน่นทุกเคส central/edge/partial · off-canvas/nonfinite ถอย fallback · guard ชี้ subject-box จริง', async () => {
  await withStrict(async () => {
    const GENERIC_RECT = { x: 0.02, y: 0, w: 0.96, h: 0.94, _final: true };
    const GENERIC_CIRCLE = { x: 0.2, y: 0.05, w: 0.6, h: 0.6, _final: true };
    const boundsOk = (c) => [c.x, c.y, c.w, c.h].every(Number.isFinite) && c.w > 0 && c.h > 0 && c.x >= 0 && c.y >= 0 && c.x + c.w <= 1 && c.y + c.h <= 1;
    const runSubject = async (subject) => {
      globalThis.__FD_MODE = 'zero';
      globalThis.__FD_SUBJECT = subject;
      try {
        const r = await composeAndVerify(mkArgs());
        assert.equal(r.success, true, r.error);
        const by = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
        assert.deepEqual([by.main.idx, by.context_1.idx, by.circle.idx], [0, 1, 2], 'source/index นิ่งทุกสถานการณ์');
        assert.deepEqual(r.manifest.strictRender.slots.map((s) => s.imageUrl), URLS, 'identity/URL นิ่ง');
        return by;
      } finally { delete globalThis.__FD_MODE; delete globalThis.__FD_SUBJECT; }
    };
    // ① central: subject px (100,100)-(700,900) ของ 1000×1250 → กรอบ (0.1,0.08)-(0.7,0.72) center (0.4,0.4)
    const byCentral = await runSubject({ x: 100, y: 100, width: 600, height: 800 });
    for (const slot of ['main', 'context_1', 'circle']) {
      const c = byCentral[slot].crop;
      assert.ok(c && !('_final' in c), `${slot} hint ไม่มี _final (ได้ ${JSON.stringify(c)})`);
      assert.ok(boundsOk(c), `${slot} ขอบเขตแน่น (ได้ ${JSON.stringify(c)})`);
      assert.ok(c.x <= 0.4 && 0.4 <= c.x + c.w && c.y <= 0.4 && 0.4 <= c.y + c.h, `${slot} ครอบ subject center`);
    }
    assert.notDeepStrictEqual(byCentral.context_1.crop, GENERIC_RECT, 'ไม่ใช่ generic rect เดิม');
    assert.notDeepStrictEqual(byCentral.circle.crop, GENERIC_CIRCLE, 'ไม่ใช่ generic circle เดิม');
    // ② จิ๋วชิดขวา-ล่าง: บังคับ min 0.05 — ต้อง "ขยายแล้วเลื่อน origin กลับ" ห้าม x+w/y+h ทะลุ 1
    const byEdge = await runSubject({ x: 970, y: 1210, width: 25, height: 30 });
    for (const slot of ['main', 'context_1', 'circle']) {
      const c = byEdge[slot].crop;
      assert.ok(!('_final' in c) && boundsOk(c), `${slot} edge-จิ๋ว ขอบเขตแน่น (ได้ ${JSON.stringify(c)})`);
      assert.ok(c.w >= 0.05 && c.h >= 0.05, 'ขั้นต่ำ 0.05 คงอยู่หลังเลื่อนกลับ');
    }
    // ③ ล้นขอบบางส่วนแต่ยังทับภาพ → ใช้ส่วน intersect เป็น hint (ยัง valid)
    const byPartial = await runSubject({ x: -200, y: -150, width: 500, height: 600 });
    for (const slot of ['main', 'context_1', 'circle']) {
      const c = byPartial[slot].crop;
      assert.ok(!('_final' in c) && boundsOk(c), `${slot} partial-outside เป็น hint ในขอบ (ได้ ${JSON.stringify(c)})`);
    }
    // ④ หลุดนอกภาพทั้งกล่อง → subject invalid → generic fallback เดิม (ไม่มีการสลับภาพ — index เช็คใน runSubject)
    const byOut = await runSubject({ x: 1200, y: 100, width: 300, height: 300 });
    assert.deepEqual(byOut.context_1.crop, GENERIC_RECT, 'off-canvas → generic rect เดิม');
    assert.deepEqual(byOut.circle.crop, GENERIC_CIRCLE, 'off-canvas → generic circle เดิม');
    // ⑤ nonfinite (width=Infinity → subject.x2=Infinity) → invalid → generic fallback เดิม
    const byInf = await runSubject({ x: 100, y: 100, width: Infinity, height: 800 });
    assert.deepEqual(byInf.context_1.crop, GENERIC_RECT, 'nonfinite → generic rect เดิม');
    assert.deepEqual(byInf.circle.crop, GENERIC_CIRCLE);
    // static integration guard (แก้ false-positive เดิมที่ indexOf('fb.subject') เจอ story-single-subject ก่อน):
    // ทาง subject-only จริงของ rect = branch ที่ตั้ง _br = 'subject-box' และอยู่ "หลัง" _final gate ใน renderRectTile
    const execSrc = readFileSync(new URL('../src/lib/services/coverExecutorService.js', import.meta.url), 'utf8');
    const iRect = execSrc.indexOf('async function renderRectTile');
    const iCircleFn = execSrc.indexOf('async function renderCircleTile');
    const iFinalGate = execSrc.indexOf('if (crop && crop._final)', iRect);
    const iSubjBox = execSrc.indexOf("_br = 'subject-box'", iRect);
    assert.ok(iRect > 0 && iFinalGate > iRect && iSubjBox > iFinalGate && iSubjBox < iCircleFn,
      "rect: _final gate มาก่อน branch _br='subject-box' และ branch อยู่ใน renderRectTile จริง");
    // circle: ไม่อ้าง subject-box — semantics คือ hint bounded ไม่มี _final แล้ว executor เข้า noface-square
    const iNofaceSq = execSrc.indexOf("_br = 'noface-square'", iCircleFn);
    assert.ok(iCircleFn > 0 && iNofaceSq > iCircleFn, "circle ไร้หน้า = branch _br='noface-square' (ใช้ hint ที่ส่งไป)");
    // control: หน้าจริงปกติ → face crop สูตรเดิม (ต่างจาก subject hint) + ไม่มี _final
    const rC = await composeAndVerify(mkArgs());
    assert.equal(rC.success, true, rC.error);
    const byC = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
    assert.ok(byC.circle.crop && !('_final' in byC.circle.crop), 'control: วงกลม face crop เป็น hint เช่นกัน');
    assert.notDeepStrictEqual(byC.circle.crop, byCentral.circle.crop, 'control: face crop ≠ subject hint');
    assert.notDeepStrictEqual(byC.main.crop, byCentral.main.crop);
  });
});

await test('21) (P1-3) strict Eye zoom guard: subject-only + zoom + REQC=0 → skip เงียบไม่ render ใหม่ · control หน้าจริง/legacy เดิม', async () => {
  const ZOOM_EYE = { grid: true, inserts: true, hero_shot: true, sub_shots: false, crops: true, diffs: [], fixes: [{ slot: 'context_1', action: 'zoom_in' }] };
  await withStrict(async () => {
    const prevReqc = process.env.MEGA_EYE_REQC;
    process.env.MEGA_EYE_REQC = '0'; // จุดอันตรายที่ Codex ชี้: gate ปิด = รับผลตาทันที
    globalThis.__EYE_RESPONSE = ZOOM_EYE;
    try {
      // strict + subject-only: zoom ต้องถูก skip — fixedCount=0 · render รอบเดียว · crop hint เดิมไม่ยุบ
      globalThis.__FD_MODE = 'zero';
      let before = ioDelta();
      const r = await composeAndVerify(mkArgs({ refImagePath: U('r', 5500) }));
      assert.equal(r.success, true, r.error);
      assert.equal(r.eyeFixed, 0, 'subject-only ห้ามถูกนับเป็นหน้าให้ zoom');
      assert.equal((globalThis.__EXEC_CALLS || 0) - before.exec, 1, 'ห้ามมี render รอบ post-fix');
      const by = Object.fromEntries((globalThis.__EXEC_SNAP || []).map((s) => [s.slot, s]));
      assert.ok(!('_final' in by.context_1.crop) && by.context_1.crop.w > 0.2, 'crop ยังเป็น subject hint เดิม — ไม่ยุบเป็นจุด');
      assert.deepEqual([by.main.idx, by.context_1.idx, by.circle.idx], [0, 1, 2], 'source/index ไม่ขยับ');
      delete globalThis.__FD_MODE;
      // control strict + หน้าจริง: zoom ยังทำงานเต็ม — fixedCount=1 + render รอบ post-fix
      before = ioDelta();
      const rC = await composeAndVerify(mkArgs({ refImagePath: U('r', 5500) }));
      assert.equal(rC.success, true, rC.error);
      assert.equal(rC.eyeFixed, 1, 'strict + หน้าจริง = zoom ได้ตามเดิม');
      assert.equal((globalThis.__EXEC_CALLS || 0) - before.exec, 2, 'มี render รอบ post-fix ปกติ');
    } finally {
      delete globalThis.__EYE_RESPONSE;
      delete globalThis.__FD_MODE;
      if (prevReqc === undefined) delete process.env.MEGA_EYE_REQC; else process.env.MEGA_EYE_REQC = prevReqc;
    }
  });
  // control legacy (นอก strict — ไม่มี _strictSourceLock): subject-only truthy → zoom apply = พฤติกรรมเดิม byte-เดิม
  const prevReqc2 = process.env.MEGA_EYE_REQC;
  process.env.MEGA_EYE_REQC = '0';
  try {
    const subjBox = { x1: 0, y1: 0, x2: 0, y2: 0, imgW: 1000, imgH: 1250, count: 0, allFaces: [], subject: { x1: 0.1, y1: 0.08, x2: 0.7, y2: 0.72 } };
    const core = {
      assignments: [{ slotId: 'context_1', imageIndex: 0, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, why: 'ctx' }],
      used: new Set([0]),
      qcFlags: [],
      traceSink: [],
      loaded: [{ person: 'B', clean: true, url: 'u0' }],
      faceBoxes: [subjBox],
      spec: null,
    };
    const calls = { n: 0 };
    const tx = await _runEyeFixTransaction({
      core,
      fixes: [{ slot: 'context_1', action: 'zoom_in' }],
      buffer: Buffer.from('pre'),
      cropTrace: [],
      renderCover: async () => { calls.n++; core.traceSink.length = 0; core.traceSink.push({ slot: 'context_1', branch: 'face' }); return Buffer.from('post'); },
    });
    assert.equal(tx.fixedCount, 1, 'legacy: fb truthy = zoom apply ตามเดิมเป๊ะ (guard ใหม่ต้องไม่รั่วมา legacy)');
    assert.equal(calls.n, 1, 'legacy render รอบ post-fix ตามเดิม');
  } finally {
    if (prevReqc2 === undefined) delete process.env.MEGA_EYE_REQC; else process.env.MEGA_EYE_REQC = prevReqc2;
  }
});

await test('22) (P1-A/item 7) legacy SUCCESS parity: NO carrier & V1-only carrier+OFF byte-identical · V2 carrier+OFF ⇒ STRICT_RENDER_LATCH_OFF', async () => {
  // fresh args ทุก call · ห้ามมี own selectionSpec/realizedTemplate · refDNA clone กันแชร์ reference
  const mkLegacySuccessArgs = () => ({
    newsTitle: 'legacy-success-parity',
    slotPlan: mkPlan(),
    refDNA: structuredClone(DNA3),
    refImagePath: null,
    stableOrder: true,
  });
  const prevEnv = process.env.MEGA_STRICT_RENDER;
  delete process.env.MEGA_STRICT_RENDER;
  try {
    // ── baseline: legacy success เต็มเส้น (env unset · ไม่มี carrier) ──
    const b0 = ioDelta();
    const baseline = await composeAndVerify(mkLegacySuccessArgs());
    assert.equal(baseline.success, true, baseline.error);
    assert.equal((globalThis.__EXEC_CALLS || 0) - b0.exec, 1, 'baseline: render ครั้งเดียว');
    assert.ok(typeof baseline.base64 === 'string' && baseline.base64.startsWith('data:image/jpeg;base64,'), 'มีภาพจริง');
    assert.ok(baseline.manifest && Array.isArray(baseline.manifest.slots) && baseline.manifest.outputHash, 'manifest success ปกติ');
    assert.ok(Array.isArray(baseline.placed) && Array.isArray(baseline.crops) && Array.isArray(baseline.qcFlags), 'placed/crops/qcFlags ครบ');
    assert.equal(baseline.manifest.strictRender, undefined, 'legacy manifest ห้ามมี strictRender');
    const baseResp = structuredClone(baseline);
    const baseSnap = structuredClone(globalThis.__EXEC_SNAP || []);
    assert.ok(baseSnap.length >= 3 && baseSnap.every((s) => s.crop && Number.isInteger(s.idx)), 'snapshot ต้องมี slot/idx/bytes/crop ครบ');

    // ── NO carrier: env unset/'0'/'1' ⇒ legacy byte-identical (parity เฉพาะเมื่อไม่มี carrier) ──
    const compareNoCarrier = async (label, env) => {
      if (env === undefined) delete process.env.MEGA_STRICT_RENDER; else process.env.MEGA_STRICT_RENDER = env;
      try {
        const d0 = ioDelta();
        const r = await composeAndVerify(mkLegacySuccessArgs());
        assert.equal(r.success, true, `${label}: ${r.error}`);
        assert.equal((globalThis.__EXEC_CALLS || 0) - d0.exec, 1, `${label}: render ครั้งเดียว`);
        assert.equal(r.manifest?.strictRender, undefined, `${label}: ห้ามมี strictRender`);
        assert.equal(r.base64, baseResp.base64, `${label}: พิกเซล base64 byte-identical`);
        assert.deepStrictEqual(r, baseResp, `${label}: complete response ต้องเท่ากันทุก field`);
        assert.deepStrictEqual(globalThis.__EXEC_SNAP, baseSnap, `${label}: __EXEC_SNAP (slot/idx/bytes/crop) ต้องเท่ากันเป๊ะ`);
      } finally { delete process.env.MEGA_STRICT_RENDER; }
    };
    await compareNoCarrier('unset (no carrier)', undefined);
    await compareNoCarrier("'0' (no carrier)", '0');
    await compareNoCarrier("'1' (no carrier = legacy job จริง)", '1');

    // ── (item 7) carrier semantics under latch OFF/"0":
    //   · V1-ONLY carrier (selectionSpec+realizedTemplate, valid OR poison) ⇒ LEGACY parity: carrier is IGNORED,
    //     result byte-identical to the no-carrier baseline (never read — proves parity).
    //   · V2 carrier (refHeroV2) ⇒ STRICT_RENDER_LATCH_OFF before IO (no downgrade).
    for (const env of [undefined, '0']) {
      if (env === undefined) delete process.env.MEGA_STRICT_RENDER; else process.env.MEGA_STRICT_RENDER = env;
      try {
        // valid V1 carrier ignored ⇒ legacy byte-identical baseline
        const rV = await composeAndVerify({ ...mkLegacySuccessArgs(), selectionSpec: mkSpec(), realizedTemplate: mkRealized() });
        assert.equal(rV.success, true, `V1 carrier+${env || 'unset'} ⇒ legacy success (${rV.error})`);
        assert.equal(rV.manifest?.strictRender, undefined, 'legacy ห้ามมี strictRender');
        assert.deepStrictEqual(rV, baseResp, `V1 carrier+${env || 'unset'} ⇒ byte-identical baseline (carrier ignored)`);
        // poison V1 carrier ALSO just ignored (never read) ⇒ still baseline
        const rP = await composeAndVerify({ ...mkLegacySuccessArgs(), selectionSpec: { __offPoison: true, slots: 'INVALID_IF_READ' }, realizedTemplate: { __offPoison: true, canvasW: -999, canvasH: -999 } });
        assert.deepStrictEqual(rP, baseResp, `poison V1 carrier+${env || 'unset'} ⇒ byte-identical baseline (never read)`);
        // V2 carrier ⇒ HOLD (no downgrade), before IO
        const b2 = ioDelta();
        const rV2 = await composeAndVerify({ ...mkLegacySuccessArgs(), refHeroV2: { ok: true } });
        assert.equal(rV2.errorType, 'STRICT_RENDER_LATCH_OFF', `V2 carrier+${env || 'unset'} ⇒ HOLD (no downgrade)`);
        assert.deepEqual(rV2.reasons, ['strict_latch_off_v2_carrier_present']);
        assert.equal(rV2.base64, undefined, 'ห้ามปล่อยภาพ');
        assertNoIO(b2); // V2 HOLD ก่อน IO
      } finally { delete process.env.MEGA_STRICT_RENDER; }
    }
  } finally {
    // cleanup แน่นหนา — ห้าม state ใดรั่วไปเทสถัดไป
    if (prevEnv === undefined) delete process.env.MEGA_STRICT_RENDER; else process.env.MEGA_STRICT_RENDER = prevEnv;
    delete globalThis.__FD_MODE;
    delete globalThis.__FD_SUBJECT;
    delete globalThis.__EXEC_MODE;
    delete globalThis.__SHARP_META;
    delete globalThis.__SHARP_FAIL_LEN;
    delete globalThis.__TRIM_LEN;
    delete globalThis.__HASH_MODE;
    delete globalThis.__EYE_RESPONSE;
  }
});

await test('23) (Wave1A) refHeroV2 carrier routing + no-downgrade — canonical latch เดียว (MEGA_STRICT_RENDER)', async () => {
  const mkLegacyArgs = () => ({ newsTitle: 'v2-routing', slotPlan: mkPlan(), refDNA: structuredClone(DNA3), refImagePath: null, stableOrder: true });
  const prev = process.env.MEGA_STRICT_RENDER;
  delete process.env.MEGA_STRICT_RENDER;
  try {
    // baseline: legacy success (ไม่มี latch · ไม่มี carrier)
    const baseline = await composeAndVerify(mkLegacyArgs());
    assert.equal(baseline.success, true, baseline.error);
    assert.equal(baseline.manifest?.strictRender, undefined, 'legacy ห้ามมี strictRender');
    const baseResp = structuredClone(baseline);
    const baseSnap = structuredClone(globalThis.__EXEC_SNAP || []);
    // ★ P0-2: refHeroV2 carrier + latch OFF ⇒ STRICT_RENDER_LATCH_OFF (ห้ามถอย legacy)
    const rOff = await composeAndVerify({ ...mkLegacyArgs(), refHeroV2: { ok: true } });
    assert.equal(rOff.errorType, 'STRICT_RENDER_LATCH_OFF', 'refHeroV2 + OFF = HOLD (no downgrade)');
    process.env.MEGA_STRICT_RENDER = '1';
    try {
      // ★ routing แยก: refHeroV2 → V2 family (STRICT_V2_*) · selectionSpec → V1 family (STRICT_RENDER_CONTRACT_INVALID)
      const rV2 = await composeAndVerify({ ...mkLegacyArgs(), refHeroV2: { ok: true } });
      assert.equal(rV2.errorType, 'STRICT_V2_CONTRACT_HOLD', 'refHeroV2 + ON = V2 path HOLD');
      const rV1 = await composeAndVerify({ ...mkLegacyArgs(), selectionSpec: {}, realizedTemplate: {} });
      assert.equal(rV1.errorType, 'STRICT_RENDER_CONTRACT_INVALID', 'selectionSpec + ON = V1 path HOLD (คนละ path)');
      // no carrier + ON = legacy byte-identical (ทั้ง response และ executor snapshot)
      const rLegacy = await composeAndVerify(mkLegacyArgs());
      assert.deepStrictEqual(rLegacy, baseResp, 'ON + no carrier = legacy byte-identical');
      assert.deepStrictEqual(globalThis.__EXEC_SNAP, baseSnap, 'ON + no carrier = executor snapshot เดิม');
    } finally { delete process.env.MEGA_STRICT_RENDER; }
  } finally {
    if (prev === undefined) delete process.env.MEGA_STRICT_RENDER; else process.env.MEGA_STRICT_RENDER = prev;
  }
});

console.log(`1..${passed}`);
