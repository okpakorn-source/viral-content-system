// ============================================================
// 🧪 เทสตำราจำลิงก์ seenLinkBook (2 ส.ค. 69) — offline ล้วน ห้ามแตะคลังจริง
// stub '@/lib/persistStore' ด้วย register-hook เก็บข้อมูลใน globalThis.__SEENBOOK (รีเซ็ตทุกเคส)
// แพทเทิร์นเดียวกับ tests/desk-pipeline-gate-reopen.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

const _mod = (src) => 'data:text/javascript,' + encodeURIComponent(src);

// in-memory store คุมผ่าน globalThis.__SEENBOOK = { data, writes, failReads, failWrites }
const STUB_PERSIST = _mod(`
export function createStore() {
  const G = globalThis.__SEENBOOK;
  if (!G) throw new Error('TEST_HARNESS_MISSING: __SEENBOOK');
  // ★ 2 ส.ค. 69 (ผู้ตรวจไขว้ชี้ mutation รอด): failStoreInit จำลอง "คลังพังตั้งแต่ตอนสร้าง"
  //   = ทางเดียวที่ทะลุ try ชั้นในทั้งหมดไปถึง catch ชั้นนอกสุดของ markSeen — ใช้ปักหมุด fail-open ชั้นสุดท้าย
  if (G.failStoreInit) throw new Error('STORE_INIT_DOWN');
  return {
    async getAll() { if (G.failReads) throw new Error('STORE_DOWN_READ'); return G.data.map(x => ({ ...x })); },
    async add(item) { G.writes++; if (G.failWrites) throw new Error('STORE_DOWN_WRITE'); G.data.push(item); return item; },
    async addMany(items) { G.writes += items.length; if (G.failWrites) throw new Error('STORE_DOWN_WRITE'); G.data.push(...items); return items; },
    async update(id, fn) { G.writes++; if (G.failWrites) throw new Error('STORE_DOWN_WRITE'); const i = G.data.findIndex(x => x.id === id); if (i < 0) throw new Error('ไม่พบ id: ' + id); G.data[i] = typeof fn === 'function' ? fn(G.data[i]) : { ...G.data[i], ...fn }; return G.data[i]; },
    async remove(id) { G.writes++; if (G.failWrites) throw new Error('STORE_DOWN_WRITE'); G.data = G.data.filter(x => x.id !== id); return { removed: true }; },
    async removeAll() { G.writes++; G.data = []; return { removedAll: true }; },
    async findById(id) { return G.data.find(x => x.id === id) || null; },
    async count() { return G.data.length; },
  };
}
`);

const hook = `
export async function resolve(specifier, ctx, next) {
  if (specifier === '@/lib/persistStore') return { url: ${JSON.stringify(STUB_PERSIST)}, shortCircuit: true };
  if (specifier.startsWith('@/')) throw new Error('UNSTUBBED_IMPORT_FORBIDDEN: ' + specifier);
  return next(specifier, ctx);
}
`;
register(_mod(hook));

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };

const { normalizeUrl, linkKey, filterUnseen, markSeen } = await import('../src/lib/services/newsDesk/seenLinkBook.js');

const DAY = 86400e3;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const rec = (url, msAgo = 0) => ({ id: linkKey(url), url: normalizeUrl(url), firstSeenAt: iso(msAgo), lastSeenAt: iso(msAgo), hits: 1 });
const seed = (r) => globalThis.__SEENBOOK.data.push(r);

const ENV_KEYS = ['DESK_SEEN_BOOK', 'DESK_SEEN_DAYS', 'DESK_SEEN_MAX'];
function seen(env, fn) {
  return async () => {
    const saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    globalThis.__SEENBOOK = { data: [], writes: 0, failReads: false, failWrites: false, failStoreInit: false };
    try { return await fn(); } finally {
      for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      delete globalThis.__SEENBOOK;
    }
  };
}

test('normalizeUrl: ตัด utm/fbclid/gclid + www + trailing slash + lowercase host', seen({}, async () => {
  assert.equal(
    normalizeUrl('HTTPS://WWW.Example.com/Path/Article/?utm_source=fb&fbclid=XYZ&gclid=ABC&id=123'),
    'https://example.com/Path/Article?id=123'
  );
  assert.equal(normalizeUrl('https://www.example.com/'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com', 'root ไม่มี slash ต้องเท่ากับแบบมี');
  // query ที่มีนัยต้องอยู่ครบ ห้ามตัดเกิน
  assert.equal(normalizeUrl('https://news.co.th/a/b?x=1&utm_medium=z&y=2'), 'https://news.co.th/a/b?x=1&y=2');
}));

test('linkKey: ลิงก์ต่างกันแค่ query ขยะ/www/slash = คีย์เดียวกัน · รูปแบบ md5 12 หลัก', seen({}, async () => {
  const a = 'https://news.com/story/100?utm_campaign=x&fbclid=AAA';
  const b = 'https://www.news.com/story/100/?gclid=BBB&utm_source=t';
  assert.equal(linkKey(a), linkKey(b), 'ลิงก์เรื่องเดียวกันคนละสี ต้องคีย์เดียวกัน');
  assert.match(linkKey(a), /^[0-9a-f]{12}$/);
  // query ที่มีนัยต่างกัน = ต้องคนละคีย์ (กันเหมารวมข่าวคนละเรื่อง)
  assert.notEqual(linkKey(a), linkKey('https://news.com/story/100?id=7'));
}));

test('filterUnseen: แยก fresh/skipped ถูก + stats ตรง', seen({}, async () => {
  const A = { url: 'https://news.com/a?utm_source=fb' };
  const B = { url: 'https://news.com/b' };
  seed(rec('https://news.com/a')); // เคยเจอ A แล้ว (ตำราเก็บรูปที่ล้างแล้ว)
  const { fresh, skipped, stats } = await filterUnseen([A, B]);
  assert.deepEqual(fresh, [B]);
  assert.deepEqual(skipped, [A]);
  assert.equal(stats.total, 2);
  assert.equal(stats.fresh, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.book, 1);
  assert.equal(stats.disabled, false);
}));

test('markSeen: จารึกแล้วรอบสอง skip ทั้งที่ลิงก์เปลี่ยนสี (utm ใหม่)', seen({}, async () => {
  const A = { url: 'https://news.com/a' };
  const B = { url: 'https://news.com/b' };
  const r1 = await filterUnseen([A, B]);
  assert.equal(r1.fresh.length, 2, 'ตำราว่าง ต้อง fresh ทั้งคู่');
  const w = await markSeen(r1.fresh, { round: 1 });
  assert.equal(w.added, 2);
  assert.equal(w.errors, 0);
  const r2 = await filterUnseen([{ url: 'https://news.com/a?fbclid=ZZZ' }, B, { url: 'https://news.com/c' }]);
  assert.equal(r2.skipped.length, 2, 'A(เปลี่ยนสี)+B ต้องโดน skip');
  assert.equal(r2.fresh.length, 1);
  assert.equal(r2.fresh[0].url, 'https://news.com/c');
}));

test('kill-switch DESK_SEEN_BOOK=0: ทุกใบ fresh + markSeen ไม่เขียนเล่มแม้แต่ครั้งเดียว', seen({ DESK_SEEN_BOOK: '0' }, async () => {
  seed(rec('https://news.com/a'));
  const { fresh, skipped, stats } = await filterUnseen([{ url: 'https://news.com/a' }, { url: 'https://news.com/b' }]);
  assert.equal(fresh.length, 2, 'ปิดตำรา = ทุกใบต้อง fresh แม้เคยจารึกไว้');
  assert.equal(skipped.length, 0);
  assert.equal(stats.disabled, true);
  const w = await markSeen([{ url: 'https://news.com/c' }]);
  assert.equal(w.disabled, true);
  assert.equal(w.marked, 0);
  assert.equal(globalThis.__SEENBOOK.writes, 0, 'kill-switch ต้องไม่เขียนคลังเลย');
  assert.equal(globalThis.__SEENBOOK.data.length, 1, 'คลังต้องเหมือนเดิมเป๊ะ');
}));

test('fail-open: คลังอ่านพัง = ทุกใบ fresh ไม่ throw · คลังเขียนพัง = markSeen ไม่ throw', seen({}, async () => {
  globalThis.__SEENBOOK.failReads = true;
  const { fresh, skipped } = await filterUnseen([{ url: 'https://news.com/a' }]);
  assert.equal(fresh.length, 1, 'คลังพังต้องถือว่ายังไม่เคยเจอ');
  assert.equal(skipped.length, 0);
  globalThis.__SEENBOOK.failWrites = true;
  const w = await markSeen([{ url: 'https://news.com/a' }]);
  assert.equal(w.added, 0, 'เขียนไม่สำเร็จห้ามนับว่าเขียน');
  assert.ok(w.errors >= 1, 'ต้องรายงาน error ในผลลัพธ์ ไม่ใช่ throw');
  assert.equal(globalThis.__SEENBOOK.data.length, 0, 'เขียนพังห้ามมีข้อมูลค้าง');
}));

// ★ 2 ส.ค. 69 (หมุดที่ผู้ตรวจไขว้ชี้ว่าขาด — mutation ทำให้ catch ชั้นนอกสุดโยน แล้วเทสยังเขียว)
test('fail-open ชั้นนอกสุด: คลังพังตั้งแต่สร้าง (ทะลุ try ชั้นใน) → markSeen/filterUnseen ต้องไม่ throw', seen({}, async () => {
  globalThis.__SEENBOOK.failStoreInit = true;
  const items = [{ url: 'https://a.com/x' }, { url: 'https://b.com/y' }];
  // markSeen: ต้องกลืน error แล้วคืนผลสรุป ไม่ลากงานโต๊ะข่าวพัง
  const r = await markSeen(items);
  assert.ok(r && typeof r === 'object', 'markSeen ต้องคืนผลสรุป ไม่ throw');
  assert.ok((r.errors ?? 0) >= 1, 'ต้องนับ error ไว้ ไม่กลืนเงียบ');
  // filterUnseen: ต้องถือว่าทุกใบยังไม่เคยเจอ (ปล่อยผ่าน ดีกว่าบล็อกงานทั้งรอบ)
  const f = await filterUnseen(items);
  assert.equal(f.fresh.length, 2, 'คลังพัง = ทุกใบต้องผ่านเป็น fresh');
  assert.equal(f.skipped.length, 0);
}));

test('อายุเกิน DESK_SEEN_DAYS (default 30 วัน) = ถือว่าไม่เคยเจอ เข้าใหม่ได้', seen({}, async () => {
  seed(rec('https://news.com/old', 31 * DAY)); // เก่า 31 วัน > อายุความจำ
  seed(rec('https://news.com/new', 2 * DAY));
  const { fresh, skipped } = await filterUnseen([{ url: 'https://news.com/old' }, { url: 'https://news.com/new' }]);
  assert.deepEqual(fresh.map(x => x.url), ['https://news.com/old'], 'ใบหมดอายุต้องกลับมาเป็น fresh');
  assert.deepEqual(skipped.map(x => x.url), ['https://news.com/new']);
}));

test('เกินเพดาน DESK_SEEN_MAX: ตัดใบเก่าสุดออก + ลบออกจากคลังจริง', seen({ DESK_SEEN_MAX: '3' }, async () => {
  seed(rec('https://news.com/1', 3 * DAY));
  seed(rec('https://news.com/2', 2 * DAY));
  seed(rec('https://news.com/3', 1 * DAY));
  const w = await markSeen([{ url: 'https://news.com/4' }]);
  assert.equal(w.evicted, 1, 'ต้องไล่ใบเก่าสุดออก 1 ใบ');
  assert.equal(w.errors, 0);
  assert.equal(globalThis.__SEENBOOK.data.length, 3, 'คลังต้องไม่เกินเพดาน');
  assert.equal(globalThis.__SEENBOOK.data.some(x => x.url === 'https://news.com/1'), false, 'ใบเก่าสุดต้องหลุดจากคลัง');
  const { fresh } = await filterUnseen([{ url: 'https://news.com/1' }, { url: 'https://news.com/4' }]);
  assert.deepEqual(fresh.map(x => x.url), ['https://news.com/1'], 'ใบที่โดนไล่ออกต้องกลับมาเป็น fresh');
}));

test('ลิงก์พัง/ไม่มีลิงก์: ไม่ throw และส่งต่อเป็น fresh (ห้ามทิ้งข่าว)', seen({}, async () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl('not a url'), 'not a url', 'ลิงก์พังต้อง fail-open คืนของเดิม');
  const { fresh, skipped } = await filterUnseen([{ title: 'ไม่มีลิงก์' }, 'not a url', null]);
  assert.equal(skipped.length, 0);
  assert.equal(fresh.length, 3);
}));

test('leaf module: ห้าม import โมดูลโต๊ะข่าวอื่น / ห้าม network / ห้าม AI (กัน import วน)', seen({}, async () => {
  const src = readFileSync(new URL('../src/lib/services/newsDesk/seenLinkBook.js', import.meta.url), 'utf8');
  assert.ok(!/harvester|deskBrain/i.test(src), 'ห้ามอ้าง harvester/deskBrain');
  assert.ok(!/fetch\(|axios|openai|aiRouter/i.test(src), 'ห้ามมี network/AI');
  assert.ok(/STORE_NAME = ['"]news-desk-seen['"]/.test(src), 'ต้องกำหนดเล่มชื่อ news-desk-seen');
  assert.ok(/createStore\(STORE_NAME\)/.test(src), 'ต้องเปิดเล่มผ่าน createStore(STORE_NAME)');
}));

test('kill-switch รับคำสั่งปิดกว้าง (F5): 0/false/off/no ตัวพิมพ์เล็ก-ใหญ่ไม่สำคัญ → ทุกใบ fresh + markSeen ไม่เขียน', async () => {
  for (const v of ['0', 'false', 'off', 'no', 'FALSE', 'Off', 'NO', ' False ']) {
    await seen({ DESK_SEEN_BOOK: v }, async () => {
      seed(rec('https://news.com/a'));
      const { fresh, skipped, stats } = await filterUnseen([{ url: 'https://news.com/a' }]);
      assert.equal(fresh.length, 1, `DESK_SEEN_BOOK=${JSON.stringify(v)} ต้องถือว่าปิด`);
      assert.equal(skipped.length, 0);
      assert.equal(stats.disabled, true);
      const w = await markSeen([{ url: 'https://news.com/b' }]);
      assert.equal(w.disabled, true);
      assert.equal(w.marked, 0);
      assert.equal(globalThis.__SEENBOOK.writes, 0, `DESK_SEEN_BOOK=${JSON.stringify(v)} ห้ามเขียนคลัง`);
      assert.equal(globalThis.__SEENBOOK.data.length, 1, 'คลังต้องเหมือนเดิมเป๊ะ');
    })();
  }
});

test('ค่าที่ไม่ใช่คำสั่งปิด (F5): 1/true/on/yes → ตำรายังเปิด skip ใบซ้ำ + จารึกตามปกติ', async () => {
  for (const v of ['1', 'true', 'on', 'yes']) {
    await seen({ DESK_SEEN_BOOK: v }, async () => {
      seed(rec('https://news.com/a'));
      const { fresh, skipped, stats } = await filterUnseen([{ url: 'https://news.com/a' }, { url: 'https://news.com/b' }]);
      assert.equal(stats.disabled, false, `DESK_SEEN_BOOK=${v} ต้องไม่ปิดตำรา`);
      assert.equal(skipped.length, 1, 'ใบซ้ำต้องถูก skip ตามเดิม');
      assert.equal(fresh.length, 1);
      const w = await markSeen([{ url: 'https://news.com/b' }]);
      assert.equal(w.added, 1, 'ต้องจารึกลงตำราตามปกติ');
      assert.equal(w.errors, 0);
    })();
  }
});
