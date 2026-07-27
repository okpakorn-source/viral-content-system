// ============================================================
// 🔎 MEGA_HERO_GAP_CLOSEUP (เคส AC-0197, 27 ก.ค. 69) — self-contained harness (module stubs, ไม่ยิง
// LLM/network/store จริง) เทสทริกเกอร์ใหม่ใน s5_gapsearch: ตัวเอกหลักไม่มีภาพเดี่ยวสะอาด faceCount=1 หน้าใหญ่พอ
// (ไม่มีเลย หรือมีแต่ faceH ต่ำ) → ยิงค้นเสริม 1 รอบ คำค้นตรงชื่อจริงเท่านั้น เพดาน ≤12 ใบ ผ่าน triage เดิม
//
// Pattern เดียวกับ tests/mega-semantic-selection.test.mjs (register() ESM hook + globalThis.__MEGA_SP stub)
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const AI_STUB = _mod('export function callBrain(a){ if (globalThis.__MEGA_AI) return globalThis.__MEGA_AI(a); throw new Error("LLM_FORBIDDEN_IN_TEST"); }');
const STUB_IMAGESEARCH = _mod(`
export const PLATFORMS = ['google','google_news','facebook','tiktok','youtube'];
export function buildQueries(kw, maxQ){ return ['q1','q2']; }
export async function searchImages(platform, q, opts){ return globalThis.__MEGA_SP.searchImages(platform, q, opts); }
export async function instagramProfile(){ return { images: [] }; }
export async function facebookProfile(){ return { images: [] }; }
`);
const STUB_TRIAGE = _mod('export async function vetImages(a){ return globalThis.__MEGA_SP.vetImages(a); }');
const STUB_STORE = _mod(`
export async function addImages(caseId, imgs){ return globalThis.__MEGA_SP.addImages(caseId, imgs); }
export async function readImages(caseId){ return []; }
`);
const STUB_CASE = _mod('export async function getCase(id){ return globalThis.__MEGA_SP.getCase ? globalThis.__MEGA_SP.getCase(id) : {}; }');
const STUB_JUNK = _mod(`
export function isCatalogSource(){ return false; }
export function isOwnPageSource(){ return false; }
export function isMismatchedFbMedia(){ return false; }
`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/imageSearch') return { url: ${JSON.stringify(STUB_IMAGESEARCH)}, shortCircuit: true };
  if (specifier === '@/lib/libraryTriage') return { url: ${JSON.stringify(STUB_TRIAGE)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE)}, shortCircuit: true };
  if (specifier === '@/lib/junkSources') return { url: ${JSON.stringify(STUB_JUNK)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

process.env.IMG_GAP_SEARCH = '1';
const { s5_gapsearch, _heroCloseupGapFor } = await import('../src/lib/megaAdapters.js');

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok ${passed + failed} - ${name}`); } catch (e) { failed++; console.log(`not ok ${passed + failed} - ${name}\n  ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n  ')}`); } };

// ---------- helper fixtures ----------
const heroJob = (name = 'ม่วย') => ({ dossier: { images: { caseId: 'AC0197' }, compass: { mainCharacters: [{ name, role: 'hero' }] } } });
const cleanSolo = (id, faceH) => ({ id, imageUrl: `https://x/${id}.jpg`, triage: { clean: true, relevant: true, faceCount: 1, person: 'ม่วย', faceBox: { h: faceH } }, realWidth: 1200, realHeight: 1500 });
const groupShot = (id) => ({ id, imageUrl: `https://x/${id}.jpg`, triage: { clean: true, relevant: true, faceCount: 2, person: 'ม่วย' }, realWidth: 1200, realHeight: 1500 });

// ---------- unit: _heroCloseupGapFor (pure) ----------
await test('_heroCloseupGapFor: ไม่มี mainCharacters เลย → null (ไม่มีเกณฑ์จะวัด)', () => {
  assert.strictEqual(_heroCloseupGapFor({ dossier: {} }, []), null);
});

await test('_heroCloseupGapFor: มีภาพเดี่ยวสะอาด faceH สูงพอ (0.30 ≥ 0.22) → null (ไม่ต้องค้นเสริม)', () => {
  assert.strictEqual(_heroCloseupGapFor(heroJob(), [cleanSolo('a', 0.30)]), null);
});

await test('_heroCloseupGapFor: ไม่มีภาพของตัวเอกเลย → { name }', () => {
  const r = _heroCloseupGapFor(heroJob('ม่วย'), []);
  assert.deepEqual(r, { name: 'ม่วย' });
});

await test('_heroCloseupGapFor: มีภาพเดี่ยวสะอาดแต่ faceH ต่ำ (0.10 < 0.22, พอร์เทรตครึ่งตัวเคส AC-0197) → { name }', () => {
  const r = _heroCloseupGapFor(heroJob('ม่วย'), [cleanSolo('half-body', 0.10)]);
  assert.deepEqual(r, { name: 'ม่วย' });
});

await test('_heroCloseupGapFor: มีแต่ภาพกลุ่ม (faceCount=2, ไม่ผ่าน _heroGradeOf) → { name }', () => {
  const r = _heroCloseupGapFor(heroJob('ม่วย'), [groupShot('g')]);
  assert.deepEqual(r, { name: 'ม่วย' });
});

await test('_heroCloseupGapFor: faceH วัดไม่ได้ (faceBox หาย) → นับเป็นยังไม่มีโคลสอัพ (ไม่เดา) → { name }', () => {
  const noBox = { id: 'nb', imageUrl: 'https://x/nb.jpg', triage: { clean: true, relevant: true, faceCount: 1, person: 'ม่วย' }, realWidth: 1200, realHeight: 1500 };
  const r = _heroCloseupGapFor(heroJob('ม่วย'), [noBox]);
  assert.deepEqual(r, { name: 'ม่วย' });
});

// ---------- integration: s5_gapsearch (kill-switch + real query/cap/log/merge behaviour) ----------
const mkSP = (overrides = {}) => ({
  searchImages: async (platform, q) => (overrides.imagesFor ? overrides.imagesFor(platform, q) : []),
  vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { ...(x.triage || {}), relevant: true } })), kept: images.length, dropped: 0, failed: 0 }),
  addImages: async (caseId, imgs) => ({ added: imgs.length }),
  getCase: async () => ({ analysis: {}, keywords: {} }),
  ...overrides,
});
const jf = (libImages) => async (url) => (String(url).includes('/api/images/') ? { images: libImages } : (() => { throw new Error('NO NET'); })());

await test('s5_gapsearch: kill-switch OFF (MEGA_HERO_GAP_CLOSEUP=0) → ไม่มีทริกเกอร์เลย (searchImages ไม่ถูกเรียกสำหรับคำค้นโคลสอัพ, ไม่มี log)', async () => {
  process.env.MEGA_HERO_GAP_CLOSEUP = '0';
  const calls = [];
  globalThis.__MEGA_SP = mkSP({ searchImages: async (platform, q) => { calls.push(q); return []; } });
  const logs = [];
  const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    await s5_gapsearch(heroJob('ม่วย'), { origin: 'http://mock', _deps: { fetchJson: jf([]) } });
  } finally {
    console.log = origLog;
    delete process.env.MEGA_HERO_GAP_CLOSEUP;
    delete globalThis.__MEGA_SP;
  }
  assert.ok(!calls.some((q) => q.includes('สัมภาษณ์') || q.includes('โคลสอัพ')), `closeup queries never fired (got ${JSON.stringify(calls)})`);
  assert.ok(!logs.some((l) => l.includes('gap-closeup')), 'no gap-closeup log line at all when kill-switch is off');
});

await test('s5_gapsearch: default ON + ไม่มีโคลสอัพเลย → ยิงคำค้นตรงชื่อจริง 2 คำ ("<ชื่อ> สัมภาษณ์" / "<ชื่อ> ใบหน้า โคลสอัพ") ผ่าน google + google_news, เก็บเข้าคลัง, log ตรงสเปค', async () => {
  const firedQueries = [];
  globalThis.__MEGA_SP = mkSP({
    searchImages: async (platform, q) => {
      firedQueries.push(`${platform}:${q}`);
      return [{ imageUrl: `https://found/${platform}-${q}.jpg` }];
    },
  });
  const logs = [];
  const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  let result;
  try {
    result = await s5_gapsearch(heroJob('ม่วย'), { origin: 'http://mock', _deps: { fetchJson: jf([]) } });
  } finally {
    console.log = origLog;
    delete globalThis.__MEGA_SP;
  }
  assert.ok(firedQueries.includes('google:ม่วย สัมภาษณ์'), `fires "ม่วย สัมภาษณ์" on google (got ${JSON.stringify(firedQueries)})`);
  assert.ok(firedQueries.includes('google_news:ม่วย สัมภาษณ์'), 'fires on google_news too');
  assert.ok(firedQueries.includes('google:ม่วย ใบหน้า โคลสอัพ'), 'fires the second deterministic query');
  assert.ok(firedQueries.length === 4, `exactly 2 queries × 2 platforms = 4 calls (got ${firedQueries.length})`);
  const line = logs.find((l) => l.includes('gap-closeup'));
  assert.ok(line, 'emits the required gap-closeup log line');
  assert.match(line, /🔎 gap-closeup: ตัวเอก ม่วย ไม่มีโคลสอัพ → ค้นเพิ่ม \d+ ใบ/, `log matches exact required format (got "${line}")`);
  assert.ok(result, 's5_gapsearch still returns normally (does not crash the pipeline)');
});

await test('s5_gapsearch: มีภาพเกิน 12 ใบจากการค้น → เก็บเข้าคลังไม่เกินเพดาน 12 ใบ (ตามสเปค)', async () => {
  let stored = null;
  globalThis.__MEGA_SP = mkSP({
    searchImages: async (platform, q) => Array.from({ length: 15 }, (_, i) => ({ imageUrl: `https://found/${platform}-${q}-${i}.jpg` })),
    addImages: async (caseId, imgs) => { stored = imgs; return { added: imgs.length }; },
  });
  const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    await s5_gapsearch(heroJob('ม่วย'), { origin: 'http://mock', _deps: { fetchJson: jf([]) } });
  } finally { console.log = origLog; delete globalThis.__MEGA_SP; }
  assert.ok(stored, 'addImages was called');
  assert.ok(stored.length <= 12, `stored ≤12 images even though search returned far more (got ${stored.length})`);
  const line = logs.find((l) => l.includes('gap-closeup'));
  assert.match(line, /ค้นเพิ่ม 12 ใบ/, `log reports the capped count (got "${line}")`);
});

await test('s5_gapsearch: ตัวเอกมีโคลสอัพอยู่แล้วในพูล → ไม่ยิงค้นเสริมเลย (searchImages ไม่ถูกเรียกด้วยคำค้นโคลสอัพ)', async () => {
  const calls = [];
  globalThis.__MEGA_SP = mkSP({ searchImages: async (platform, q) => { calls.push(q); return []; } });
  const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    await s5_gapsearch(heroJob('ม่วย'), { origin: 'http://mock', _deps: { fetchJson: jf([cleanSolo('good', 0.35)]) } });
  } finally { console.log = origLog; delete globalThis.__MEGA_SP; }
  assert.ok(!calls.some((q) => q.includes('สัมภาษณ์') || q.includes('โคลสอัพ')), `no closeup search when a qualifying image already exists (got ${JSON.stringify(calls)})`);
  assert.ok(!logs.some((l) => l.includes('gap-closeup')), 'no gap-closeup log line when there is nothing to fill');
});

await test('s5_gapsearch: ภาพที่เพิ่งเก็บจากโคลสอัพ ถูกนับรวมในแกน (ก)/(ข) เดิมของรอบเดียวกัน (ไม่ต้องยิงค้นซ้ำคนเดิมสองรอบ)', async () => {
  // scene axis (ข) จัดให้ผ่านล่วงหน้าด้วยภาพเดิมในพูล (ไม่เกี่ยวกับ closeup) — เหลือแค่ hero-grade axis (ก) ที่ขาด
  // ก่อน closeup วิ่ง แล้วให้ closeup หามาเติมจนครบ (≥2) ในรอบเดียวกัน โดยไม่ต้องเรียกสมอง (callBrain) เลย
  globalThis.__MEGA_SP = mkSP({
    searchImages: async () => [{ imageUrl: `https://found/${Math.random()}.jpg`, triage: { faceCount: 1, faceBox: { h: 0.35 } } }],
    vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { ...(x.triage || {}), relevant: true, clean: true, faceCount: 1, person: 'ม่วย', faceBox: { h: 0.35 } } })), kept: images.length, dropped: 0, failed: 0 }),
  });
  let aiCalled = false;
  globalThis.__MEGA_AI = async () => { aiCalled = true; return { text: '{"queries":["should-not-be-needed"]}' }; };
  const job = { dossier: { images: { caseId: 'AC0197', storyQueries: ['sq'] }, compass: { mainCharacters: [{ name: 'ม่วย', role: 'hero' }] } } };
  const sceneImgs = [0, 1, 2].map((i) => ({ id: `scene${i}`, imageUrl: `https://scene/${i}.jpg`, query: 'sq', triage: { relevant: true } }));
  let result;
  try {
    result = await s5_gapsearch(job, { origin: 'http://mock', _deps: { fetchJson: jf(sceneImgs) } });
  } finally { delete globalThis.__MEGA_SP; delete globalThis.__MEGA_AI; }
  assert.ok(!aiCalled, 'axis (ก)/(ข) never needed to call the LLM query-writer — the closeup pass alone already satisfied hero-grade≥2 for this fixture');
  assert.match(result.summary, /ครบทั้ง 2 แกน/, `axis (ก)/(ข) sees the freshly-added closeup images in the SAME pass (got "${result.summary}")`);
});

console.log(`\n# hero-gap-closeup: ${passed}/${passed + failed} passed`);
console.log(`1..${passed + failed}`);
if (failed) process.exitCode = 1;
