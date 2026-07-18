// ============================================================
// 🧪 s5_keywords — fail-fast เมื่อคีย์เวิร์ด 0 คำค้น (18 ก.ค. 69, เคส MG-0011 เนื้อหาเป็น '?' ล้วน)
// ------------------------------------------------------------
// พิสูจน์: (1) /api/keywords สำเร็จแต่ทุกหมวดว่าง → status:'failed' ทันที (ไม่ปล่อยไปเปลือง 4 tick ที่ s5_search)
//          (2) มีคำค้นปกติ → done + dossierPatch เดิมเป๊ะ (parity ทางปกติ)
// เทคนิค: @/ alias resolve ผ่าน loader hook + stub global fetch (แบบเดียวกับ reftest-queue.test.mjs)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const ORIG_FETCH_DESC = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const EMPTY_KW = {
  queries_th: [], queries_en: [], object_queries: [], moment_action: [], scene_place: [],
  relationship_archive: [], lifestyle_travel: [], family_album: [], landmark_context: [],
  emotion: [], source_show: [], subjects: [],
};

// stub fetch: คืน payload ที่ตั้งไว้ (json สำเร็จเสมอ)
let payload = null;
function stubFetch() {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true, writable: true,
    value: async () => ({ status: 200, json: async () => payload }),
  });
}
function restoreFetch() {
  if (ORIG_FETCH_DESC) Object.defineProperty(globalThis, 'fetch', ORIG_FETCH_DESC);
}

test('s5_keywords: ทุกหมวดว่าง (0 คำค้น) → failed ทันที ไม่ปล่อยผ่านไป search', async () => {
  stubFetch();
  try {
    payload = { success: true, keywords: { ...EMPTY_KW } };
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const r = await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub' });
    assert.equal(r.status, 'failed', 'ต้อง failed ไม่ใช่ done');
    assert.match(String(r.summary || ''), /0 คำค้น/, 'summary ต้องบอกเหตุ 0 คำค้น');
    assert.equal(r.dossierPatch, undefined, 'ห้ามเขียน dossierPatch ตอน fail');
  } finally { restoreFetch(); }
});

test('s5_keywords: มีคำค้นปกติ → done + keywordsCount เดิมเป๊ะ (parity ทางปกติ)', async () => {
  stubFetch();
  try {
    payload = { success: true, keywords: { ...EMPTY_KW, queries_th: ['ลำไย ไหทองคำ', 'พี่ช้าง แฟนลำไย'], subjects: [{ name: 'ลำไย' }] } };
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const r = await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub' });
    assert.equal(r.status, 'done');
    assert.equal(r.dossierPatch.images.keywordsCount, 2);
    assert.deepEqual(r.dossierPatch.images.subjects, ['ลำไย']);
  } finally { restoreFetch(); }
});

test('s5_keywords: /api/keywords ล้ม (success:false) → failed เส้นเดิมไม่เปลี่ยน', async () => {
  stubFetch();
  try {
    payload = { success: false, error: 'PROVIDER_ERROR' };
    const { s5_keywords } = await import('@/lib/megaAdapters');
    const r = await s5_keywords({ dossier: { images: { caseId: 'AC-TEST' } } }, { origin: 'http://stub' });
    assert.equal(r.status, 'failed');
    assert.match(String(r.summary || ''), /ไม่สำเร็จ/);
  } finally { restoreFetch(); }
});
