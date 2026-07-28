// ============================================================
// 🎯 PATCH /api/ref-covers — รองรับ {id, matchNewsType:[...]} (29 ก.ค. 69, แก้ตามผลตรวจ Opus แบตช์
//   ref-category-rotation รอบ 2) — เหตุผล: data/ref-cover-library.json ใน working tree โดน Supabase sync
//   ทับได้ทุกเมื่อ (บั๊กเก่าที่รู้กัน) → ทางเดียวที่ติดป้ายหมวดถาวรคือยิง PATCH endpoint จริง (scripts/tag-refs-via-api.mjs)
// พิสูจน์: (1) merge เข้า dna เดิมไม่ทับทั้งก้อน — template/slots/panelCount/_humanVerified ต้องรอดครบ
//   (2) idempotent (ยิงป้ายชุดเดิมซ้ำไม่งอก) (3) เพดาน 40 ตัวอักษร/ป้าย + 12 ป้าย/ใบ (4) id ไม่พบ → 404
//   (5) ไม่กระทบ branch styleName/template.slots/verified/reanalyze เดิม
// harness: stub @/lib/refCoverLibrary (listRefCovers/updateRefCover คุมผ่าน globalThis) — resolve
//   @/lib/refCoverBrain, @/lib/refCoverGrade, @/lib/refTemplateFidelity, @/lib/refTemplate ของจริง 100%
//   (แพทเทิร์นเดียวกับ tests/pickbestref-fidelity.test.mjs)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);

// stub เก็บ "คลังจำลอง" ใน globalThis.__RCP_STORE (Map id→record) — update mutate ตรงๆ (เหมือน file-fallback จริง)
const STUB_REFLIB = _mod(`
export async function listRefCovers(n) { return Array.from(globalThis.__RCP_STORE.values()); }
export async function updateRefCover(id, patch) {
  const cur = globalThis.__RCP_STORE.get(id);
  if (!cur) return null;
  const updated = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  globalThis.__RCP_STORE.set(id, updated);
  return updated;
}
export function syncDnaSlotsToTemplate(dnaSlots) { return Array.isArray(dnaSlots) ? dnaSlots.slice() : []; }
export async function addRefCover() { throw new Error('addRefCover ไม่ควรถูกเรียกในเทส PATCH นี้'); }
export async function deleteRefCover() { throw new Error('deleteRefCover ไม่ควรถูกเรียกในเทส PATCH นี้'); }
`);
// ★ node ESM ธรรมดา resolve 'next/server' (package export ของ Next) ไม่ได้ตรงๆ — stub ขั้นต่ำ (แพทเทิร์นเดียวกับ
//   tests/ac0107-compose-test-parity.test.mjs ที่มีอยู่แล้ว) แค่ NextResponse.json ที่พอใช้ทดสอบ status/body
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, status: (init && init.status) || 200, async json(){ return this._body; } }) };');

const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
  if (specifier === '@/lib/refCoverLibrary') return { url: ${JSON.stringify(STUB_REFLIB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  // relative import ไม่มีนามสกุล (เช่น './usageLogger' ใน openai.js/geminiClient.js) — เติม .js ให้ก่อนส่งต่อ
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.(m?js|json)$/.test(specifier)) {
    return nextResolve(specifier + '.js', context);
  }
  return nextResolve(specifier, context);
}`;
register(_mod(hook));

const { PATCH } = await import('../src/app/api/ref-covers/route.js');

const mkReq = (body) => ({ json: async () => body });

function resetStore(records) {
  globalThis.__RCP_STORE = new Map(records.map((r) => [r.id, r]));
}

const BASE_DNA = {
  template: { slots: [{ role: 'hero', xPct: 0, yPct: 0, wPct: 50, hPct: 100 }], seamStyle: 'edge-to-edge' },
  slots: [{ role: 'hero', pos: 'กลาง' }],
  panelCount: 1,
  matchNewsType: ['human-interest', 'ครอบครัว-ดราม่า'],
  _humanVerified: true,
  _fidelity: { score: 88, confidence: 'ok', worstOffsetPx: 3 },
};

test('PATCH matchNewsType: merge เข้า dna เดิม — ป้ายใหม่ขึ้นก่อน + คงป้ายเก่าครบ + template/slots/panelCount/_humanVerified/_fidelity รอดครบ (ไม่ shallow-replace)', async () => {
  resetStore([{ id: 'REF-1', styleName: 'ทดสอบ', dna: structuredClone(BASE_DNA) }]);
  const res = await PATCH(mkReq({ id: 'REF-1', matchNewsType: ['กตัญญู'] }));
  const body = await res.json();
  assert.equal(res.status ?? 200, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.item.dna.matchNewsType, ['กตัญญู', 'human-interest', 'ครอบครัว-ดราม่า'], 'ป้ายใหม่ต้องขึ้นก่อน + ป้ายเก่าอยู่ครบ');
  assert.deepEqual(body.item.dna.template, BASE_DNA.template, 'template ต้องรอดครบ ไม่ถูกทับ');
  assert.deepEqual(body.item.dna.slots, BASE_DNA.slots, 'slots ต้องรอดครบ');
  assert.equal(body.item.dna.panelCount, 1, 'panelCount ต้องรอดครบ');
  assert.equal(body.item.dna._humanVerified, true, '_humanVerified ต้องรอดครบ');
  assert.deepEqual(body.item.dna._fidelity, BASE_DNA._fidelity, '_fidelity ต้องรอดครบ');
});

test('PATCH matchNewsType: idempotent — ยิงป้ายชุดเดิมซ้ำ (รวมป้ายที่มีอยู่แล้ว) → ไม่งอก (Set dedupe)', async () => {
  resetStore([{ id: 'REF-1', styleName: 'ทดสอบ', dna: structuredClone(BASE_DNA) }]);
  await PATCH(mkReq({ id: 'REF-1', matchNewsType: ['กตัญญู'] }));
  const res2 = await PATCH(mkReq({ id: 'REF-1', matchNewsType: ['กตัญญู'] })); // ยิงซ้ำป้ายเดิม
  const body2 = await res2.json();
  assert.deepEqual(body2.item.dna.matchNewsType, ['กตัญญู', 'human-interest', 'ครอบครัว-ดราม่า'], 'ยิงซ้ำต้องไม่เพิ่มป้ายซ้ำ (ความยาวเท่าเดิม)');

  const res3 = await PATCH(mkReq({ id: 'REF-1', matchNewsType: ['human-interest'] })); // ยิงป้ายที่มีอยู่แล้วในคลังเดิม (ไม่ใช่ป้ายที่เพิ่งเติม)
  const body3 = await res3.json();
  assert.deepEqual(body3.item.dna.matchNewsType, ['human-interest', 'กตัญญู', 'ครอบครัว-ดราม่า'], 'ป้ายที่ยิงมาต้องขึ้นก่อนเสมอ แต่ไม่ซ้ำ/ไม่งอกจำนวน');
});

test('PATCH matchNewsType: เพดาน 40 ตัวอักษร/ป้าย (ตัดทิ้งส่วนเกิน) + 12 ป้าย/ใบ (ตัดป้ายเกินทิ้ง ป้ายใหม่ยังคงอยู่ก่อนเสมอ)', async () => {
  const longTag = 'ก'.repeat(60);
  resetStore([{ id: 'REF-1', styleName: 'ทดสอบ', dna: { ...structuredClone(BASE_DNA), matchNewsType: Array.from({ length: 11 }, (_, i) => `เดิม${i}`) } }]);
  const res = await PATCH(mkReq({ id: 'REF-1', matchNewsType: [longTag, 'ใหม่2'] }));
  const body = await res.json();
  assert.equal(body.item.dna.matchNewsType[0].length, 40, 'ป้ายยาวเกินต้องถูกตัดเหลือ 40 ตัวอักษร');
  assert.equal(body.item.dna.matchNewsType.length, 12, 'รวมทั้งหมดต้องไม่เกิน 12 ป้าย/ใบ');
  assert.equal(body.item.dna.matchNewsType[1], 'ใหม่2', 'ป้ายใหม่ทั้งสองต้องอยู่ต้นแถวก่อนป้ายเก่า');
});

test('PATCH matchNewsType: string ว่าง/whitespace/ไม่ใช่ string ในอาเรย์ → กรองทิ้ง ไม่เข้าไปปนในผลลัพธ์', async () => {
  resetStore([{ id: 'REF-1', styleName: 'ทดสอบ', dna: structuredClone(BASE_DNA) }]);
  const res = await PATCH(mkReq({ id: 'REF-1', matchNewsType: ['', '   ', 123, null, 'กตัญญู'] }));
  const body = await res.json();
  assert.deepEqual(body.item.dna.matchNewsType, ['กตัญญู', 'human-interest', 'ครอบครัว-ดราม่า']);
});

test('PATCH matchNewsType: id ไม่พบในคลัง → 404', async () => {
  resetStore([{ id: 'REF-1', styleName: 'ทดสอบ', dna: structuredClone(BASE_DNA) }]);
  const res = await PATCH(mkReq({ id: 'REF-NOT-EXIST', matchNewsType: ['กตัญญู'] }));
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.success, false);
});

test('PATCH matchNewsType: dna เดิมไม่มี matchNewsType เลย (undefined) → merge ได้ปกติ ไม่ throw', async () => {
  const dnaNoTag = structuredClone(BASE_DNA);
  delete dnaNoTag.matchNewsType;
  resetStore([{ id: 'REF-1', styleName: 'ทดสอบ', dna: dnaNoTag }]);
  const res = await PATCH(mkReq({ id: 'REF-1', matchNewsType: ['กตัญญู'] }));
  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.item.dna.matchNewsType, ['กตัญญู']);
  assert.deepEqual(body.item.dna.template, BASE_DNA.template, 'template ต้องยังรอดแม้ dna เดิมไม่มี matchNewsType');
});

test('PATCH: ไม่ส่ง matchNewsType เลย (เช่น ส่งแค่ styleName) → พฤติกรรมเดิมเป๊ะ ไม่แตะ dna.matchNewsType', async () => {
  resetStore([{ id: 'REF-1', styleName: 'เก่า', dna: structuredClone(BASE_DNA) }]);
  const res = await PATCH(mkReq({ id: 'REF-1', styleName: 'ใหม่' }));
  const body = await res.json();
  assert.equal(body.item.styleName, 'ใหม่');
  assert.deepEqual(body.item.dna, BASE_DNA, 'dna ทั้งก้อนต้องไม่ถูกแตะเลยเมื่อไม่ส่ง matchNewsType/template/verified/reanalyze');
});

test('PATCH: ไม่ส่ง id เลย → 400', async () => {
  resetStore([{ id: 'REF-1', styleName: 'ทดสอบ', dna: structuredClone(BASE_DNA) }]);
  const res = await PATCH(mkReq({ matchNewsType: ['กตัญญู'] }));
  assert.equal(res.status, 400);
});
