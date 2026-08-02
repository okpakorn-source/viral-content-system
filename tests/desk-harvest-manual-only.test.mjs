// ============================================================
// 🧪 เทส P2 (2 ส.ค. 69 — เจ้าของสั่ง): "หยุดลบข่าวที่ยังไม่ได้ใช้ + หยุดทำงานเองโดยไม่ได้สั่ง"
// ------------------------------------------------------------
// พิสูจน์ "พฤติกรรมจริง" ของ harvester.js (ไม่ใช่ presence test):
//   จุด A — auto-purge: default ไม่ลบของเกินอายุ/เกินเพดาน (นับ purgeSkipped แจ้งไว้เฉยๆ)
//           · safety re-check (ผิดกฎ/สถาบันแง่ลบ) ยังลบต่อเหมือนเดิม
//           · DESK_AUTO_PURGE=1 กลับมาลบเหมือนเดิม · DESK_PURGE_HOURS / DESK_MAX_ITEMS ปรับได้
//           · หมุดปัก F4: สวิตช์เข้มเฉพาะ '1' ('0'/'true' = ปิด) · ตัวคูณอายุ 9+→1.5× / focusTag→3.5× ห้ามเพี้ยน
//   จุด B — AutoPilot: default ปิด (ไม่ enqueue) · DESK_AUTOPILOT=1 เปิดได้ · record desk-settings override ได้
//           · หมุดปัก F4: เข้มเฉพาะ '1' ('true' = ปิด)
//   จุด C — auto deepResearch / auto mineclip: default ข้าม (+log เหตุผล) · env เปิดได้
//   จุด D — pruneOldItems (F1): อยู่ใต้สวิตช์ DESK_AUTO_PURGE เดียวกับจุด A (ปิด=คืน 0 + log นับ)
//           · shortlisted/used/sent/claimed ห้ามถูกลบทั้งตอนเปิดและปิด
// offline ล้วน — stub ทุกอย่างที่แตะเน็ต/AI/คลัง (แพทเทิร์น register-hook เดียวกับ
//   tests/desk-seen-link-book.test.mjs · loader โยนถ้าเจอ import ที่ไม่ได้ stub ตาม tests/desk-pipeline-gate-reopen.test.mjs)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (src) => 'data:text/javascript,' + encodeURIComponent(src);

// ── in-memory persistStore: แยก bucket ตามชื่อเล่ม ข้อมูลอยู่ใน globalThis.__DESK.stores ──
const STUB_PERSIST = _mod(`
export function createStore(name) {
  const G = globalThis.__DESK;
  if (!G) throw new Error('TEST_HARNESS_MISSING: __DESK');
  if (!G.stores[name]) G.stores[name] = [];
  const bucket = () => G.stores[name];
  return {
    async getAll() { return bucket().map(x => ({ ...x })); },
    async add(item) { bucket().push(item); return item; },
    async addMany(items) { bucket().push(...items); return items; },
    async update(id, fn) {
      const i = bucket().findIndex(x => x.id === id);
      if (i < 0) throw new Error('ไม่พบ id: ' + id);
      G.stores[name][i] = typeof fn === 'function' ? fn(G.stores[name][i]) : { ...G.stores[name][i], ...fn };
      return G.stores[name][i];
    },
    async remove(id) { G.stores[name] = bucket().filter(x => x.id !== id); return { removed: true }; },
    async removeAll() { G.stores[name] = []; return { removedAll: true }; },
    async findById(id) { return bucket().find(x => x.id === id) || null; },
    async count() { return bucket().length; },
  };
}
`);

// ── deskBrain stub: ผ่านทุกด่าน (เว้น _gateFail) · ให้คะแนนคุมได้ผ่าน _judge ──
const STUB_BRAIN = _mod(`
export function gateKeywords(it) { return it._gateFail ? { pass: false, reason: 'test-gate' } : { pass: true }; }
export async function classifyBatch(items) { return items.map(i => ({ ...i, toxicity: i.toxicity ?? 0, fbRisk: i.fbRisk ?? 0, category: i.category || 'กระแส' })); }
export function fitScore() { return 5; }
export function freshScore() { return 5; }
export async function loadArchiveTitles() { return []; }
export function isDuplicateOfArchive() { return false; }
export async function editorialJudge(items) { return items.map(i => ({ ...i, judgeScore: i._judge ?? 9, judgeReason: 'test-judge' })); }
export function finalScore(it) { return (it.judgeScore ?? 5) * 10; }
export async function getCategoryPerformance() { return {}; }
export function keywordCategorize() { return 'กระแส'; }
export function keywordGore() { return false; }
export function specialistForLane(lane) { return { name: 'บกทดสอบ', icon: '🧪', lanes: [lane] }; }
export const SPECIALIST_EDITORS = {};
`);

const STUB_METRICS = _mod(`export function computeQueryYield() { return { deadQueries: [] }; }`);
const STUB_SAGA = _mod(`
export async function updateSagaActivity() {}
export async function detectSagas() {}
export async function getSagaQueries() { return []; }
`);
// ── ตัวนับงานเสียเงิน — ทุก stub รายงานเข้า globalThis.__DESK.calls ──
const STUB_RESEARCH = _mod(`
export async function deepResearch(item) { globalThis.__DESK.calls.deepResearch++; return { ok: true, readyScore: 8, summary: 'test', of: item.id }; }
`);
const STUB_MINER = _mod(`
export async function mineClip() { globalThis.__DESK.calls.mineClip++; return { fullText: 'บทถอดเสียงทดสอบ', goldenMoments: [], captionSkeleton: 'x', judgeScore: 9, judgeReason: 'm' }; }
`);
const STUB_REFRAME = _mod(`
export async function reframeNews() { globalThis.__DESK.calls.reframe = (globalThis.__DESK.calls.reframe || 0) + 1; return { ok: true }; }
export function isReframeCandidate() { return false; }
`);
const STUB_QUEUE = _mod(`
export async function enqueueJob(payload, userId) { globalThis.__DESK.calls.enqueue++; globalThis.__DESK.calls.enqueueArgs = { payload, userId }; return { jobId: 'QJTEST123456' }; }
`);

const hook = `
export async function resolve(specifier, ctx, next) {
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STUB_PERSIST)}, shortCircuit: true };
  if (specifier === './deskBrain') return { url: ${JSON.stringify(STUB_BRAIN)}, shortCircuit: true };
  if (specifier === './deskMetrics') return { url: ${JSON.stringify(STUB_METRICS)}, shortCircuit: true };
  if (specifier === './sagaTracker') return { url: ${JSON.stringify(STUB_SAGA)}, shortCircuit: true };
  if (specifier === './researchAgent') return { url: ${JSON.stringify(STUB_RESEARCH)}, shortCircuit: true };
  if (specifier === './interviewMiner') return { url: ${JSON.stringify(STUB_MINER)}, shortCircuit: true };
  if (specifier === './reframeEngine') return { url: ${JSON.stringify(STUB_REFRAME)}, shortCircuit: true };
  if (specifier === '@/lib/services/queueService') return { url: ${JSON.stringify(STUB_QUEUE)}, shortCircuit: true };
  if (specifier.startsWith('@/')) throw new Error('UNSTUBBED_IMPORT_FORBIDDEN: ' + specifier);
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    // อนุญาตเฉพาะตัวเทสโหลด harvester ของจริง — นอกนั้น relative import ทุกตัวต้องถูก stub เท่านั้น
    if (specifier.includes('harvester')) return next(specifier, ctx);
    throw new Error('UNSTUBBED_IMPORT_FORBIDDEN: ' + specifier);
  }
  return next(specifier, ctx);
}
`;
register(_mod(hook));

// ── fetch stub: ตอบเฉพาะ Serper /news ด้วยของปลอม · ที่เหลือโยน (กันเน็ตจริง 100%) ──
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://google.serper.dev/news')) {
    return { ok: true, status: 200, json: async () => ({ news: (globalThis.__DESK && globalThis.__DESK.serperItems) || [] }) };
  }
  throw new Error('NETWORK_FORBIDDEN: ' + u.slice(0, 80));
};

const { runHarvest, pruneOldItems } = await import('../src/lib/services/newsDesk/harvester.js');

// ── ตัวช่วย ──
const H = 3600e3;
const isoAgo = (hr) => new Date(Date.now() - hr * H).toISOString();
const seedDesk = (items) => { globalThis.__DESK.stores['news-desk'] = items; };
const deskItems = () => globalThis.__DESK.stores['news-desk'] || [];
const byId = (id) => deskItems().find(x => x.id === id);
const run = (opts = {}) => runHarvest({ lanes: [], judgeTop: 24, ...opts });

// การ์ดเก่าในคลัง (อยู่บนโต๊ะก่อนรอบล่า)
const oldItem = (id, over) => ({ id, title: `การ์ด ${id} เรื่องราวทดสอบที่ยาวพอ`, url: `https://news.test/${id}`, status: 'new', harvestedAt: isoAgo(over.hr ?? 1), judgeScore: over.judge ?? 5, ...over });
// ผลค้น Serper ปลอม (ของใหม่ที่จะไหลเข้าโต๊ะในรอบนี้)
const sItem = (n, extra = {}) => ({ title: `ข่าวทดสอบหมายเลข ${n} เรื่องราวน้ำดีของชาวบ้าน`, snippet: 'x', link: `https://news.test/story/${n}`, source: 'test', date: '3 ชั่วโมงที่ผ่านมา', imageUrl: '', ...extra });

const ENV_KEYS = ['DESK_AUTO_PURGE', 'DESK_PURGE_HOURS', 'DESK_MAX_ITEMS', 'DESK_AUTOPILOT', 'DESK_AUTO_RESEARCH', 'DESK_AUTO_MINECLIP', 'DESK_JUNK_MAX', 'SERPER_API_KEY'];
function desk(env, fn) {
  return async () => {
    const saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    if (env.SERPER_API_KEY === undefined) process.env.SERPER_API_KEY = 'test-key'; // serperNews ต้องมีคีย์ (fetch ถูก stub อยู่แล้ว)
    globalThis.__DESK = { stores: {}, calls: { deepResearch: 0, mineClip: 0, enqueue: 0 }, serperItems: [] };
    const _log = console.log, _warn = console.warn;
    const logs = [];
    console.log = (...a) => { logs.push(a.join(' ')); };
    console.warn = (...a) => { logs.push(a.join(' ')); };
    const G = globalThis.__DESK;
    G.logs = logs;
    try { return await fn(); } finally {
      console.log = _log; console.warn = _warn;
      for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      delete globalThis.__DESK;
    }
  };
}

// ════════════════════════════════════════════════════
// จุด A — auto-purge
// ════════════════════════════════════════════════════

// ★ 2 ส.ค. 69 (ผู้ตรวจไขว้ชี้): ถังขยะ news-desk-junk เคยตัดเหลือ 400 ใบ "เงียบ ไม่มีสวิตช์"
//   ของในถังกู้คืนขึ้นโต๊ะได้ (ปุ่ม restoreJunk) → เกินเพดาน = ของกู้คืนได้หายถาวร
//   หมุดนี้อ่านซอร์สจริง (การตัดถังเกิดใน runHarvest เฉพาะรอบที่มีของถูกคัดออก จำลองครบยาก)
//   ถ้าใครถอดสวิตช์/เปลี่ยน default/ถอด log → แดงทันทีพร้อมบอกว่าต้องกลับมาแก้
test('J1 · ถังขยะต้องมีเพดานปรับได้ (DESK_JUNK_MAX) — default 400 เท่าเดิม · 0=ไม่ตัด · มี log ตอนตัด', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(join(ROOT, 'src/lib/services/newsDesk/harvester.js'), 'utf8');
  assert.match(src, /DESK_JUNK_MAX/, 'ต้องมีสวิตช์เพดานถังขยะ');
  assert.match(src, /junkMax\s*>\s*0\s*&&\s*jall\.length\s*>\s*junkMax/, 'ตัดเฉพาะเมื่อเพดาน > 0 และเกินจริง (0 = ไม่ตัดเลย)');
  assert.match(src, /if \(raw === ''\) return 400;/, 'ไม่ตั้ง env = 400 เท่าเดิม (ห้ามเปลี่ยนพฤติกรรมเดิมโดยไม่ตั้งใจ)');
  assert.match(src, /ถังขยะเกินเพดาน/, 'ต้อง log ตอนตัด — ของกู้คืนได้ห้ามหายเงียบ');
  assert.doesNotMatch(src, /jall\.length > 400\)\s*\{\s*\n\s*const old = jall\.sort/, 'ต้องไม่เหลือเพดาน 400 แบบฮาร์ดโค้ดเดิม');
  // ★ ผู้ตรวจไขว้จับได้: เดิมนับ old.length ทั้งที่ remove() ถูกกลืน error → รายงานสำเร็จทั้งที่ลบไม่ได้
  assert.doesNotMatch(src, /stats\.junkTrimmed = old\.length/, 'ห้ามนับจากจำนวนที่ "ตั้งใจลบ" — ต้องนับที่ลบสำเร็จจริง');
  assert.match(src, /stats\.junkTrimmed = trimmed/, 'ต้องนับเฉพาะที่ลบสำเร็จจริง');
  assert.match(src, /if \(failed\) stats\.junkTrimFailed = failed/, 'ต้องรายงานจำนวนที่ลบไม่สำเร็จด้วย ไม่กลืนเงียบ');
});

// ★ 2 ส.ค. 69 (ผู้ตรวจไขว้รอบยืนยันชี้): ใบที่ "AI ยังไม่ได้ตรวจ" (fail-closed ของ deskBrain) ถูกกันออกถูกแล้ว
//   แต่ตอนบันทึกลงถังขยะ ร่องรอยสาเหตุถูกทิ้ง → ในถังเห็นแค่ "ทำใหม่ไม่ได้..." แยกไม่ออกจากใบที่ AI ตัดสินจริง
// ⚠️ ตามตรง: เป็นหมุด "อ่านซอร์ส" ไม่ใช่เทสพฤติกรรม — harness ชุดนี้ยิงถึงเส้น persist ถังขยะไม่ได้
//    (ต้องมีของถูกคัดออกจริงในรอบล่า ซึ่งต้องต่อ lane/ผลค้นครบชุด) จึงปักที่ mapper แทน + ให้ผู้ตรวจไล่พฤติกรรมด้วยโพรบ
test('J2 · mapper ถังขยะต้องพาร่องรอย "ยังไม่ผ่านการคัดกรอง" ไปด้วย (แยกจากใบที่ AI ตัดสินจริง)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(join(ROOT, 'src/lib/services/newsDesk/harvester.js'), 'utf8');
  // เหตุผลพิเศษเมื่อ AI ยังไม่ได้ตรวจใบนั้น (ห้ามใช้เหตุผลทั่วไป "ทำใหม่ไม่ได้..." ซึ่งแปลว่า AI ตัดสินแล้ว)
  assert.match(src, /j\.classifyMissing[\s\S]{0,120}ยังไม่ผ่านการคัดกรอง/, 'junkReason ต้องแยกกรณี "ยังไม่ได้ตรวจ" ออกจาก "AI ตัดสินแล้ว"');
  // ร่องรอยต้องถูก persist ลงถัง ไม่ถูก mapper ตัดทิ้ง
  assert.match(src, /classifyMissing: true, classifyNote:/, 'ต้อง persist classifyMissing + classifyNote ลงถังขยะ');
  // ใบปกติต้องคงเหตุผลเดิม
  assert.match(src, /\(j\.junkReason \|\| 'ตัดออก'\)/, 'ใบที่ AI ตัดสินจริงต้องคงเหตุผลเดิมไว้');
});

test('A1 · default (ปิด): ไม่ลบของเกินอายุ — นับ purgeSkipped + log บอก แล้วเก็บไว้รอเจ้าของสั่งเคลียร์', desk({}, async () => {
  seedDesk([
    oldItem('old-new', { hr: 100, judge: 5 }),      // new เกิน 48 ชม. → เดิมโดนลบ
    oldItem('old-dismissed', { hr: 30, status: 'dismissed' }), // dismissed เกิน 24 ชม. → เดิมโดนลบ
    oldItem('fresh-new', { hr: 1 }),                // ของสด → ต้องอยู่เสมอ
  ]);
  const stats = await run();
  assert.equal(stats.autoPurged, 0, 'ปิดอยู่ ห้ามลบตามอายุ');
  assert.equal(stats.purgeSkipped, 2, 'ต้องนับว่าถ้าเปิดจะลบ 2 ใบ');
  assert.ok(byId('old-new'), 'ของเกินอายุต้องยังอยู่');
  assert.ok(byId('old-dismissed'), 'dismissed เกินอายุต้องยังอยู่');
  assert.ok(byId('fresh-new'), 'ของสดต้องอยู่');
  assert.ok(globalThis.__DESK.logs.some(l => l.includes('auto-purge ปิดอยู่ — ของเก่าเกินเกณฑ์ 2 ใบ (เก็บไว้รอเจ้าของสั่งเคลียร์)')), 'ต้อง log บอกจำนวนที่จะถูกลบถ้าเปิด');
}));

test('A2 · default (ปิด): safety re-check ยังลบของผิดกฎ/สถาบันแง่ลบเหมือนเดิม · ของทีมห้ามแตะ', desk({}, async () => {
  seedDesk([
    oldItem('royal-neg', { hr: 1, royalNegative: true }),
    oldItem('gate-fail', { hr: 1, _gateFail: true }),
    oldItem('team-keep', { hr: 1, royalNegative: true, shortlisted: true }), // ของทีม — ถึงผิดกฎก็ห้ามแตะ (เช็ค protected ก่อน)
    oldItem('fresh-ok', { hr: 1 }),
  ]);
  const stats = await run();
  assert.equal(byId('royal-neg'), undefined, 'สถาบันแง่ลบต้องโดนลบแม้ปิด purge');
  assert.equal(byId('gate-fail'), undefined, 'ของผิดกฎต้องโดนลบแม้ปิด purge');
  assert.ok(byId('team-keep'), 'ของทีม (shortlisted) ห้ามโดนลบ');
  assert.ok(byId('fresh-ok'), 'ของปกติต้องอยู่');
  assert.equal(stats.safetyPurged, 2);
  assert.equal(stats.autoPurged, 0, 'ลบ safety ไม่นับเป็น auto-purge ตามอายุ');
  assert.equal(stats.purgeSkipped, 0);
}));

test('A3 · DESK_AUTO_PURGE=1: กลับมาลบตามอายุเหมือนเดิม (safety + เกินอายุรวมใน autoPurged)', desk({ DESK_AUTO_PURGE: '1' }, async () => {
  seedDesk([
    oldItem('old-new', { hr: 100, judge: 5 }),
    oldItem('old-dismissed', { hr: 30, status: 'dismissed' }),
    oldItem('royal-neg', { hr: 1, royalNegative: true }),
    oldItem('fresh-new', { hr: 1 }),
  ]);
  const stats = await run();
  assert.equal(byId('old-new'), undefined, 'เปิดแล้วต้องลบ new เกิน 48 ชม.');
  assert.equal(byId('old-dismissed'), undefined, 'เปิดแล้วต้องลบ dismissed เกิน 24 ชม.');
  assert.equal(byId('royal-neg'), undefined, 'safety ต้องโดนลบ');
  assert.ok(byId('fresh-new'), 'ของสดต้องอยู่');
  assert.equal(stats.autoPurged, 3, 'ต้องนับรวม safety(1)+เกินอายุ(2) เหมือนโค้ดเดิม');
  assert.equal(stats.purgeSkipped, 0);
  assert.ok(globalThis.__DESK.logs.some(l => l.includes('ลบของเก่าจริงออกจาก DB: 3 ใบ (เกิน 48 ชม./เกินเพดาน 800/ผิดกฎ)')), 'ข้อความ log ต้องเหมือนเดิมตอนค่า default');
}));

test('A4a · DESK_AUTO_PURGE=1 (default 48 ชม.): ของอายุ 60 ชม. โดนลบ', desk({ DESK_AUTO_PURGE: '1' }, async () => {
  seedDesk([oldItem('age-60', { hr: 60, judge: 5 })]);
  const stats = await run();
  assert.equal(byId('age-60'), undefined, '60 > 48 ต้องโดนลบ');
  assert.equal(stats.autoPurged, 1);
}));

test('A4b · DESK_PURGE_HOURS=72 ปรับเกณฑ์ได้: ของอายุ 60 ชม. รอด', desk({ DESK_AUTO_PURGE: '1', DESK_PURGE_HOURS: '72' }, async () => {
  seedDesk([oldItem('age-60', { hr: 60, judge: 5 })]);
  const stats = await run();
  assert.ok(byId('age-60'), '60 < 72 ต้องไม่โดนลบ');
  assert.equal(stats.autoPurged, 0);
}));

const seed805 = () => seedDesk(Array.from({ length: 805 }, (_, i) => oldItem(`st${i + 1}`, { hr: 1, finalScore: i + 1 })));

test('A5a · เพดาน 800 ไม่ทำงานตอนปิด: 805 ใบอยู่ครบ นับ purgeSkipped=5', desk({}, async () => {
  seed805();
  const stats = await run();
  assert.equal(deskItems().length, 805, 'ปิดอยู่ห้ามตัดเพดาน');
  assert.equal(stats.autoPurged, 0);
  assert.equal(stats.purgeSkipped, 5, 'ต้องนับส่วนเกินเพดานแจ้งไว้');
}));

test('A5b · DESK_AUTO_PURGE=1: เพดาน 800 ตัดใบคะแนนต่ำสุดออก 5 ใบ', desk({ DESK_AUTO_PURGE: '1' }, async () => {
  seed805();
  const stats = await run();
  assert.equal(deskItems().length, 800);
  assert.equal(stats.autoPurged, 5);
  assert.equal(byId('st1'), undefined, 'คะแนนต่ำสุดต้องหลุด');
  assert.ok(byId('st805'), 'คะแนนสูงสุดต้องอยู่');
}));

test('A5c · DESK_MAX_ITEMS=810 ปรับเพดานได้: 805 ใบอยู่ครบ', desk({ DESK_AUTO_PURGE: '1', DESK_MAX_ITEMS: '810' }, async () => {
  seed805();
  const stats = await run();
  assert.equal(deskItems().length, 805, '805 < 810 ต้องไม่ตัด');
  assert.equal(stats.autoPurged, 0);
}));

// ════════════════════════════════════════════════════
// จุด B — AutoPilot
// ════════════════════════════════════════════════════

const seedFreshForPilot = () => {
  globalThis.__DESK.serperItems = [sItem(1)];
};

test('B1 · AutoPilot default ปิด: ข่าวถึงเกณฑ์ก็ไม่ส่งเจนเอง (ไม่ enqueue)', desk({}, async () => {
  seedFreshForPilot();
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'good' }] });
  assert.equal(stats.added, 1, 'ข่าวต้องเข้าโต๊ะปกติ');
  assert.equal(stats.autoPicked, 0, 'default ต้องไม่ส่งเจนเอง');
  assert.equal(globalThis.__DESK.calls.enqueue, 0, 'ห้ามยิงงานเข้าคิว (งานเสียเงินต้องเกิดจากการกดสั่งเท่านั้น)');
  const it = deskItems().find(x => x.url === 'https://news.test/story/1');
  assert.equal(it.status, 'new', 'การ์ดต้องยังเป็น new รอคนตัดสิน');
}));

test('B2 · DESK_AUTOPILOT=1 เปิดได้: ส่งเจนเองตามเดิม', desk({ DESK_AUTOPILOT: '1' }, async () => {
  seedFreshForPilot();
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'good' }] });
  assert.equal(stats.autoPicked, 1);
  assert.equal(globalThis.__DESK.calls.enqueue, 1, 'เปิดแล้วต้อง enqueue ตามพฤติกรรมเดิม');
  const it = deskItems().find(x => x.url === 'https://news.test/story/1');
  assert.equal(it.status, 'sent');
  assert.equal(it.autoPicked, true);
}));

test('B3 · record desk-settings override ได้เหมือนเดิม: enabled:true เปิดโดยไม่ต้องตั้ง env', desk({}, async () => {
  globalThis.__DESK.stores['desk-settings'] = [{ id: 'autopilot', enabled: true }];
  seedFreshForPilot();
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'good' }] });
  assert.equal(stats.autoPicked, 1, 'record enabled:true ต้องเปิด autopilot ได้เหมือนเดิม');
  assert.equal(globalThis.__DESK.calls.enqueue, 1);
}));

test('B4 · record override ชนะ env: DESK_AUTOPILOT=1 แต่ record enabled:false → ยังปิด', desk({ DESK_AUTOPILOT: '1' }, async () => {
  globalThis.__DESK.stores['desk-settings'] = [{ id: 'autopilot', enabled: false }];
  seedFreshForPilot();
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'good' }] });
  assert.equal(stats.autoPicked, 0, 'record enabled:false ต้อง override env (เหมือนเดิม)');
  assert.equal(globalThis.__DESK.calls.enqueue, 0);
}));

// ════════════════════════════════════════════════════
// จุด C — งานอัตโนมัติที่พ่วงทุกรอบล่า
// ════════════════════════════════════════════════════

test('C1 · auto deepResearch default ข้าม: ไม่เรียก AI + log เหตุผล 1 บรรทัด', desk({}, async () => {
  globalThis.__DESK.serperItems = [sItem(1)];
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'good' }] });
  assert.equal(stats.added, 1);
  assert.equal(globalThis.__DESK.calls.deepResearch, 0, 'default ห้าม research อัตโนมัติ');
  assert.equal(stats.researched, undefined);
  assert.ok(globalThis.__DESK.logs.some(l => l.includes('ข้าม auto-research')), 'ต้อง log เหตุผลที่ข้าม');
}));

test('C2 · DESK_AUTO_RESEARCH=1 เปิดได้: research ทำงาน + ผลลงการ์ดเหมือนเดิม', desk({ DESK_AUTO_RESEARCH: '1' }, async () => {
  globalThis.__DESK.serperItems = [sItem(1)];
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'good' }] });
  assert.equal(globalThis.__DESK.calls.deepResearch, 1, 'เปิดแล้วต้อง research ตามเดิม');
  assert.equal(stats.researched, 1);
  const it = deskItems().find(x => x.url === 'https://news.test/story/1');
  assert.ok(it.research, 'ผล research ต้องลงการ์ด');
  assert.equal(it.finalScore, 96, 'บูสต์คะแนนตามสูตรเดิม: min(100, 90 + (8-5)*2)');
}));

test('C3 · auto mineclip default ข้าม: ไม่ถอดคลิปเอง + log เหตุผล 1 บรรทัด', desk({}, async () => {
  globalThis.__DESK.serperItems = [sItem(1, { link: 'https://youtube.com/watch?v=x1' })];
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'clip' }] });
  assert.equal(stats.added, 1);
  assert.equal(globalThis.__DESK.calls.mineClip, 0, 'default ห้ามถอดคลิปอัตโนมัติ');
  assert.equal(stats.mined, undefined);
  assert.ok(globalThis.__DESK.logs.some(l => l.includes('ข้าม auto-mineclip')), 'ต้อง log เหตุผลที่ข้าม');
}));

test('C4 · DESK_AUTO_MINECLIP=1 เปิดได้: ถอดคลิป + ผลลงการ์ดเหมือนเดิม', desk({ DESK_AUTO_MINECLIP: '1' }, async () => {
  globalThis.__DESK.serperItems = [sItem(1, { link: 'https://youtube.com/watch?v=x1' })];
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'clip' }] });
  assert.equal(globalThis.__DESK.calls.mineClip, 1, 'เปิดแล้วต้องถอดตามเดิม');
  assert.equal(stats.mined, 1);
  const it = deskItems().find(x => x.url === 'https://youtube.com/watch?v=x1');
  assert.equal(it.fullText, 'บทถอดเสียงทดสอบ', 'บทถอดต้องลงการ์ด');
  assert.equal(it.mined, true);
}));

// ════════════════════════════════════════════════════
// จุด A (F4) — หมุดปัก mutation: สวิตช์เข้มเฉพาะ '1' · ตัวคูณอายุห้ามเพี้ยน
// ════════════════════════════════════════════════════

test('A6a · DESK_AUTO_PURGE=0: ต้อง "ปิด" (เข้มเฉพาะ 1) — ของเกินอายุอยู่ครบ + นับ purgeSkipped', desk({ DESK_AUTO_PURGE: '0' }, async () => {
  seedDesk([oldItem('old-new', { hr: 100, judge: 5 })]);
  const stats = await run();
  assert.equal(stats.autoPurged, 0, "AUTO_PURGE='0' ต้องไม่ลบ");
  assert.equal(stats.purgeSkipped, 1);
  assert.ok(byId('old-new'), 'ของเกินอายุต้องยังอยู่');
}));

test('A6b · DESK_AUTO_PURGE=true: ต้อง "ปิด" (เข้มเฉพาะ 1) — ของเกินอายุอยู่ครบ + นับ purgeSkipped', desk({ DESK_AUTO_PURGE: 'true' }, async () => {
  seedDesk([oldItem('old-new', { hr: 100, judge: 5 })]);
  const stats = await run();
  assert.equal(stats.autoPurged, 0, "AUTO_PURGE='true' ต้องไม่ลบ");
  assert.equal(stats.purgeSkipped, 1);
  assert.ok(byId('old-new'), 'ของเกินอายุต้องยังอยู่');
}));

test('A7 · purge เปิด: การ์ด judgeScore=9 อายุ 60 ชม. รอด (เกณฑ์ 72 ชม. = 48×1.5 ห้ามเพี้ยน)', desk({ DESK_AUTO_PURGE: '1' }, async () => {
  seedDesk([oldItem('ace-60', { hr: 60, judge: 9 })]);
  const stats = await run();
  assert.ok(byId('ace-60'), 'บก.ให้ 9+ ยืดเป็น 72 ชม. — อายุ 60 ชม. ต้องรอด');
  assert.equal(stats.autoPurged, 0);
}));

test('A8 · purge เปิด: การ์ด focusTag อายุ 100 ชม. รอด (เกณฑ์ 168 ชม. = 48×3.5 ห้ามเพี้ยน)', desk({ DESK_AUTO_PURGE: '1' }, async () => {
  seedDesk([oldItem('focus-100', { hr: 100, judge: 5, focusTag: 'ผลค้นเฉพาะแนว' })]);
  const stats = await run();
  assert.ok(byId('focus-100'), 'focusTag ยืดเป็น 168 ชม. — อายุ 100 ชม. ต้องรอด');
  assert.equal(stats.autoPurged, 0);
}));

// ════════════════════════════════════════════════════
// จุด B (F4) — หมุดปัก mutation: AutoPilot เข้มเฉพาะ '1'
// ════════════════════════════════════════════════════

test('B5 · DESK_AUTOPILOT=true: ต้อง "ปิด" (เข้มเฉพาะ 1) — ไม่ enqueue แม้ข่าวถึงเกณฑ์', desk({ DESK_AUTOPILOT: 'true' }, async () => {
  seedFreshForPilot();
  const stats = await run({ extraQueries: [{ q: 'ทดสอบ', lane: 'good' }] });
  assert.equal(stats.added, 1, 'ข่าวต้องเข้าโต๊ะปกติ');
  assert.equal(stats.autoPicked, 0, "AUTOPILOT='true' ต้องไม่เปิด (เข้มเฉพาะ '1')");
  assert.equal(globalThis.__DESK.calls.enqueue, 0, 'ห้ามยิงงานเข้าคิว');
  const it = deskItems().find(x => x.url === 'https://news.test/story/1');
  assert.equal(it.status, 'new', 'การ์ดต้องยังเป็น new รอคนตัดสิน');
}));

// ════════════════════════════════════════════════════
// จุด D (F1) — pruneOldItems: ทางลบข่าวเงียบอีกเส้น (route ล่าข่าวเก็บ 12 วัน · เมนูเช้าเก็บ 3 วัน)
//   ต้องอยู่ใต้สวิตช์ DESK_AUTO_PURGE เดียวกับด่าน A + shortlisted/used ห้ามถูกลบทั้งตอนเปิดและปิด
// ════════════════════════════════════════════════════

// การ์ดอายุเป็นวัน — pruneOldItems วัด harvestedAt เทียบ cutoff = now - N วัน
const agedItem = (id, days, over = {}) => oldItem(id, { hr: days * 24, ...over });

test('D1 · ปิด purge (default): pruneOldItems ไม่ลบของอายุ 20 วัน — คืน 0 + log บอกจำนวนที่จะลบถ้าเปิด (แบบด่าน A)', desk({}, async () => {
  seedDesk([
    agedItem('very-old', 20, { judge: 5 }),
    agedItem('fresh', 1),
  ]);
  const removed = await pruneOldItems(12); // เส้น route ล่าข่าว = เก็บ 12 วัน
  assert.equal(removed, 0, 'ปิดอยู่ห้ามลบแม้แต่ใบเดียว');
  assert.ok(byId('very-old'), 'ของอายุ 20 วันต้องยังอยู่รอเจ้าของสั่งเคลียร์');
  assert.ok(byId('fresh'), 'ของสดต้องอยู่');
  assert.ok(globalThis.__DESK.logs.some(l => l.includes('auto-purge ปิดอยู่ — ของเก่าเกิน 12 วัน 1 ใบ (เก็บไว้รอเจ้าของสั่งเคลียร์)')), 'ต้อง log บอกจำนวนที่จะลบถ้าเปิด แบบด่าน A');
}));

test('D2 · ปิด purge: shortlisted/used/sent/claimed อยู่ครบ และไม่ถูกนับว่าจะลบ', desk({}, async () => {
  seedDesk([
    agedItem('old-shortlisted', 20, { shortlisted: true }),
    agedItem('old-used', 20, { used: true }),
    agedItem('old-sent', 20, { status: 'sent' }),
    agedItem('old-claimed', 20, { status: 'claimed' }),
  ]);
  const removed = await pruneOldItems(3); // เส้นเมนูเช้า = เก็บ 3 วัน
  assert.equal(removed, 0);
  assert.equal(deskItems().length, 4, 'ของทีมทุกสถานะต้องอยู่ครบ');
  assert.ok(!globalThis.__DESK.logs.some(l => l.includes('auto-purge ปิดอยู่')), 'ไม่มีใบที่จะถูกลบ → ต้องไม่ log นับ');
}));

test('D3 · DESK_AUTO_PURGE=true: pruneOldItems ต้อง "ปิด" (เข้มเฉพาะ 1)', desk({ DESK_AUTO_PURGE: 'true' }, async () => {
  seedDesk([agedItem('very-old', 20, { judge: 5 })]);
  const removed = await pruneOldItems(12);
  assert.equal(removed, 0, "AUTO_PURGE='true' ต้องไม่ลบ (เข้มเฉพาะ '1')");
  assert.ok(byId('very-old'), 'ของอายุ 20 วันต้องยังอยู่');
}));

test('D4 · เปิด purge: พฤติกรรมเดิมเป๊ะ — ลบของเกินกำหนดจริง แต่ shortlisted/used รอดเด็ดขาด', desk({ DESK_AUTO_PURGE: '1' }, async () => {
  seedDesk([
    agedItem('very-old', 20, { judge: 5 }),
    agedItem('old-dismissed', 20, { status: 'dismissed' }),
    agedItem('old-shortlisted', 20, { shortlisted: true }),
    agedItem('old-used', 20, { used: true }),
    agedItem('old-sent', 20, { status: 'sent' }),
    agedItem('old-claimed', 20, { status: 'claimed' }),
    agedItem('fresh', 1),
  ]);
  const removed = await pruneOldItems(12);
  assert.equal(removed, 2, 'ลบ very-old + dismissed ตามพฤติกรรมเดิม');
  assert.equal(byId('very-old'), undefined);
  assert.equal(byId('old-dismissed'), undefined);
  assert.ok(byId('old-shortlisted'), 'shortlisted ห้ามถูกลบแม้เปิด purge');
  assert.ok(byId('old-used'), 'used ห้ามถูกลบแม้เปิด purge');
  assert.ok(byId('old-sent'), 'sent เก็บไว้เหมือนเดิม');
  assert.ok(byId('old-claimed'), 'claimed เก็บไว้เหมือนเดิม');
  assert.ok(byId('fresh'), 'ของสดต้องอยู่');
  assert.ok(globalThis.__DESK.logs.some(l => l.includes('pruned 2 old items')), 'ตอนเปิดต้อง log แบบเดิม');
}));
