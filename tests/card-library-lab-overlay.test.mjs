// ★ 3 ก.ย. 69 — F2 ห้องแล็บ overlay คลังการ์ด (CARD_LIBRARY_LAB + CARD_LIBRARY_OVERLAY_FILE) ใน persistStore.js
//   โหลด source จริงแบบอ่านข้อความแล้วแทน import ด้วยตัวปลอม (แบบเดียวกับ tests/bot-tracking-route.test.mjs)
//   รันได้โดยไม่ต้องตั้ง env: node --test tests/card-library-lab-overlay.test.mjs
//
//   ชุด snapshot "ปิด = พฤติกรรมเดิม": โหลด persistStore ของ HEAD (git show) เทียบกับ worktree
//   แล้วรันสคริปต์ op เดียวกันผ่านสตับ supabase/console/fs เดียวกัน — ผลลัพธ์ + ลำดับ call supabase +
//   ไบต์ไฟล์ mirror + ข้อความ log ต้องตรงกันทุกไบต์ (timestamp ถูก normalize เป็น <ts>)
//   หมายเหตุ: หลัง merge งานนี้เข้า HEAD ชุดนี้จะเทียบตัวเองกับตัวเอง (ผ่านเสมอ) — คุณค่าอยู่ช่วงก่อน merge
//   และใช้จับ regression รอบแก้ไฟล์นี้ครั้งถัดไป (HEAD ใหม่ = พฤติกรรมอ้างอิงใหม่)
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนไฟล์ byte-exact (ยิงจริง 3 ก.ย. 69):
//   M1 ตัดบล็อก short-circuit ใน createStore (สวิตช์เปิดแต่ไม่เข้าห้องแล็บ) → แดง: 'เปิดแล็บ: getAll อ่านจากไฟล์ overlay ...' (+ชุดแล็บทั้งแผง)
//   M2 ตัดเงื่อนไข name === LAB_STORE_NAME (แล็บกินทุก store) → แดง: 'เปิดแล็บ: store ชื่ออื่นไม่ถูกแตะ ...'
//   M3 JSON พังแล้วกลืนเงียบ (คืน [] แทน throw) → แดง: 'เปิดแล็บ: ไฟล์หาย/JSON พัง/ไม่ใช่ array ต้อง throw ชัด'
//   M4 ตัดด่าน Vercel → แดง: 'เปิดแล็บบน Vercel: เพิกเฉยสวิตช์ + console.error + ใช้เส้นทางเดิม'
//   M5 เขียนทะลุ (add เรียก supabase จริง) → แดง: 'เปิดแล็บ: ทุก op เขียนเป็น no-op ...'
//   M6 warn ทุกครั้งแทนครั้งแรก → แดง 2: 'เปิดแล็บ: no-op เตือนครั้งแรกครั้งเดียวต่อ method' + 'เปิดแล็บบน Vercel: ...' (log ซ้ำ)
//   M7 แก้พฤติกรรมสายเดิม (ตัด sync mirror ใน getAll ฝั่ง Supabase) ทั้งที่สวิตช์ปิด → แดง: snapshot 'ปิดสวิตช์ = พฤติกรรมเดิม (โหมด Supabase ...)'
//   M8 ตัด console.error ใน _labFail (อ่านพังเหลือแค่ throw) → แดง: 'เปิดแล็บ: อ่านพังต้อง console.error เองทุกครั้ง ...'
//      (เหตุ — ผู้ตรวจไขว้ 3 ก.ย.: ผู้เรียกล็อกครอบ getAll ด้วย catch ว่าง `catch (e) { }` ใน getTopPrompts
//       ของ summarizeServiceText/summarizeService แล้ว fallback อ่าน data/prompt-library.json ตรง —
//       ถ้าแล็บไม่ส่งเสียงเอง แขนทดลองวิ่งด้วยการ์ด prod ทั้งรอบแบบไร้ร่องรอยใน log)
//   M9 ตัดบรรทัดประกาศตัวตอนสร้าง lab store → แดง: 'เปิดแล็บ: ประกาศตัวครั้งเดียวตอนสร้าง store ...'
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SRC_PATH = join(REPO, 'src', 'lib', 'persistStore.js');

// ── โหลด source สองรุ่น: worktree (ของใหม่) กับ HEAD (พฤติกรรมอ้างอิง) ──
function compile(src) {
  const body = src
    .replace(/^import .*$/mg, '')
    .replace(/^export function createStore/m, 'function createStore');
  // สร้าง module state ใหม่ทุกครั้งที่เรียก factory (memCache/warn-set ไม่ปนข้ามเคส)
  return new Function(
    'getSupabase', 'isSupabaseReady', 'readFile', 'writeFile', 'mkdir', 'rename', 'unlink', 'join',
    'process', 'console', 'Buffer',
    `${body}\nreturn { createStore };`
  );
}

const newFactory = compile(readFileSync(SRC_PATH, 'utf8'));
const headFactory = compile(
  execFileSync('git', ['-C', REPO, 'show', 'HEAD:src/lib/persistStore.js'], { encoding: 'utf8' })
);

// ── เครื่องมือ ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cap = (p) => Promise.resolve(p).then(
  (v) => ({ ok: true, v }),
  (e) => ({ ok: false, err: String(e && e.message || e), code: e && e.code })
);
// timestamp เกิดตอนรัน (updatedAt/created_at/updated_at) เทียบข้ามรุ่นไม่ได้ — แทนด้วย <ts>
const TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const normalize = (x) => JSON.parse(JSON.stringify(x === undefined ? '<undefined>' : x,
  (k, v) => (typeof v === 'string' ? v.replace(TS_RE, '<ts>') : v)));

const _tmpDirs = [];
function makeTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
test.after(() => { for (const d of _tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* เก็บกวาดพลาดไม่ทำเทสพัง */ } } });

function makeConsole() {
  const rec = { log: [], warn: [], error: [] };
  const toLine = (args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  return {
    rec,
    console: {
      log: (...a) => rec.log.push(toLine(a)),
      warn: (...a) => rec.warn.push(toLine(a)),
      error: (...a) => rec.error.push(toLine(a)),
    },
  };
}

// สตับ supabase: builder จดทุก chain ที่ถูก await + ตอบจากคิวตามลำดับ (คิวหมด = ตอบ error ให้เห็นความต่าง)
function makeSb(responses) {
  const calls = [];
  const queue = [...responses];
  const makeBuilder = (chain) => new Proxy(() => {}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve, reject) => {
          calls.push(chain);
          const res = queue.length ? queue.shift() : { data: null, error: { message: 'STUB-QUEUE-EMPTY' }, count: null };
          if (res && res.__throw) reject(new Error(res.__throw));
          else resolve(res);
        };
      }
      if (typeof prop === 'symbol') return undefined;
      return (...args) => makeBuilder(chain.concat([[prop, args]]));
    },
  });
  return { calls, sb: { from: (...args) => makeBuilder([['from', args]]) } };
}

function loadModule(factory, { env = {}, dir, sbResponses = [], supabaseReady = true, fs = {} } = {}) {
  const { calls, sb } = makeSb(sbResponses);
  let readyCalls = 0;
  const con = makeConsole();
  const writeCalls = [];
  const readCalls = [];
  const readFileSpy = (...a) => { readCalls.push(String(a[0])); return (fs.readFile || readFile)(...a); };
  const writeFileSpy = (...a) => { writeCalls.push(String(a[0])); return (fs.writeFile || writeFile)(...a); };
  const proc = { env: { ...env }, cwd: () => dir, pid: 4242 };
  const mod = factory(
    () => sb,
    () => { readyCalls++; return supabaseReady; },
    readFileSpy, writeFileSpy, mkdir, rename, unlink, join,
    proc, con.console, Buffer
  );
  return { createStore: mod.createStore, calls, con, writeCalls, readCalls, proc, readyCalls: () => readyCalls };
}

const mirrorPath = (dir) => join(dir, 'data', 'prompt-library.json');
const readMirror = (dir) => (existsSync(mirrorPath(dir)) ? readFileSync(mirrorPath(dir), 'utf8') : null);

// ═══════════════════════════════════════════════════════════════════════
// ชุดที่ 1 — snapshot "ปิดสวิตช์ = พฤติกรรมเดิม" เทียบ HEAD (โหมด Supabase)
// ═══════════════════════════════════════════════════════════════════════

function supabaseQueue() {
  const bigPage = Array.from({ length: 1000 }, (_, i) => ({ data: { id: `p${i}`, n: i } }));
  return [
    { data: [{ data: { id: 'a', title: 'à¸ªà¸§à¸¢' } }, { data: { id: 'k', clean: 'ปกติ' } }], error: null }, // getAll หน้าเดียว (มี mojibake ให้ _decodeValue ทำงาน)
    { error: null },                                                       // add → insert
    { data: { data: { id: 'b', v: 1 } }, error: null },                    // update → read single
    { error: null },                                                       // update → write
    { data: null, error: { message: 'not found' } },                       // update id หาย → read single พัง
    { data: { data: { id: 'b', v: 2 } }, error: null },                    // findById
    { count: 7, error: null },                                             // count
    { data: [{ id: 'a' }], error: null },                                  // addMany → select in (a ซ้ำ)
    { error: null },                                                       // addMany → insert c
    { data: [], error: null },                                             // addMany รอบ 2 → select in
    { error: { message: 'duplicate key value violates unique constraint store_items_pkey (23505)' } }, // addMany insert ชน race
    { error: null },                                                       // remove
    { error: null },                                                       // removeAll
    { data: [{ data: { id: 'z', zz: 1 } }], error: null },                 // getAll authoritative
    { data: null, error: { message: 'boom' } },                            // getAll พังหน้าแรก → fallback local
    { data: bigPage, error: null },                                        // getAll partial หน้า 1 เต็ม 1000
    { data: null, error: { message: 'page2 down' } },                      //   หน้า 2 พัง → partialError
    { __throw: 'network down' },                                           // getAll โยนกลางคัน → fallback local
  ];
}

async function runSupabaseScenario(factory, env) {
  const dir = makeTmp('cardlab-sb-');
  const m = loadModule(factory, { env, dir, sbResponses: supabaseQueue(), supabaseReady: true });
  const store = m.createStore('prompt-library');
  const out = [];
  const step = async (label, fn) => {
    out.push([label, await cap(fn())]);
    await sleep(15); // รอ sync mirror แบบ fire-and-forget ให้จบก่อนอ่านไฟล์
    out.push([`${label}:mirror`, readMirror(dir)]);
  };
  await step('getAll', () => store.getAll());
  await step('add', () => store.add({ id: 'b', v: 1, createdAt: '2026-09-01T00:00:00.000Z' }));
  await step('update-obj', () => store.update('b', { v: 2 }));
  await step('update-missing', () => store.update('missing', { v: 3 }));
  await step('findById', () => store.findById('b'));
  await step('count', () => store.count());
  await step('addMany', () => store.addMany([{ id: 'c', createdAt: '2026-09-01T00:00:00.000Z' }, { id: 'a' }]));
  await step('addMany-dup-race', () => store.addMany([{ id: 'd', createdAt: '2026-09-01T00:00:00.000Z' }]));
  await step('remove', () => store.remove('a'));
  await step('removeAll', () => store.removeAll());
  await step('getAll-authoritative', () => store.getAll({ authoritative: true }));
  await step('getAll-error-fallback', () => store.getAll());
  await step('getAll-partial', () => store.getAll());
  await step('getAll-throw-fallback', () => store.getAll());
  return { out, calls: m.calls, console: m.con.rec, ready: m.readyCalls() };
}

test('ปิดสวิตช์ = พฤติกรรมเดิม (โหมด Supabase เทียบ HEAD: ผลลัพธ์/ลำดับ call/ไฟล์ mirror/log)', async () => {
  for (const env of [{}, { CARD_LIBRARY_LAB: '0', CARD_LIBRARY_OVERLAY_FILE: join(tmpdir(), 'no-such-overlay.json') }]) {
    const a = await runSupabaseScenario(newFactory, env);
    const b = await runSupabaseScenario(headFactory, env);
    assert.deepEqual(normalize(a.out), normalize(b.out), `ผลลัพธ์ op ต่างจาก HEAD (env=${JSON.stringify(env)})`);
    assert.deepEqual(normalize(a.calls), normalize(b.calls), 'ลำดับ/เนื้อ call ไป Supabase ต่างจาก HEAD');
    assert.deepEqual(normalize(a.console), normalize(b.console), 'ข้อความ log ต่างจาก HEAD');
    assert.equal(a.ready, b.ready, 'จำนวนครั้งที่ปรึกษา isSupabaseReady ต่างจาก HEAD');
  }
});

test('ปิดสวิตช์: ค่า 0 กับไม่ตั้งเลย ให้ผลเหมือนกันทุกไบต์ (รุ่นใหม่)', async () => {
  const a = await runSupabaseScenario(newFactory, {});
  const b = await runSupabaseScenario(newFactory, { CARD_LIBRARY_LAB: '0', CARD_LIBRARY_OVERLAY_FILE: 'x.json' });
  assert.deepEqual(normalize(a.out), normalize(b.out));
  assert.deepEqual(normalize(a.calls), normalize(b.calls));
});

// ═══════════════════════════════════════════════════════════════════════
// ชุดที่ 2 — snapshot "ปิดสวิตช์ = พฤติกรรมเดิม" เทียบ HEAD (โหมด file fallback)
// ═══════════════════════════════════════════════════════════════════════

async function runFileScenario(factory, env) {
  const dir = makeTmp('cardlab-file-');
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(mirrorPath(dir), JSON.stringify([{ id: 'a', name: 'à¸ªà¸§à¸¢' }, { id: 'k', n: 1 }]), 'utf8');
  const m = loadModule(factory, { env, dir, supabaseReady: false });
  const store = m.createStore('prompt-library');
  const out = [];
  const step = async (label, fn) => {
    out.push([label, await cap(fn())]);
    out.push([`${label}:mirror`, readMirror(dir)]);
  };
  await step('getAll', () => store.getAll());
  await step('findById', () => store.findById('a'));
  await step('count', () => store.count());
  await step('add', () => store.add({ id: 'b', v: 1 }));
  await step('add-dup', () => store.add({ id: 'b' }));
  await step('addMany', () => store.addMany([{ id: 'm' }]));
  await step('update-fn', () => store.update('b', (i) => ({ ...i, up: 1 })));
  await step('update-obj', () => store.update('b', { up: 2 }));
  await step('update-missing', () => store.update('nope', { up: 3 }));
  await step('remove', () => store.remove('a'));
  await step('remove-missing', () => store.remove('nope'));
  await step('removeAll', () => store.removeAll());
  await step('getAll-authoritative', () => store.getAll({ authoritative: true }));
  writeFileSync(mirrorPath(dir), '{oops', 'utf8');
  await step('getAll-cached-after-break', () => store.getAll());
  await step('getAll-authoritative-broken', () => store.getAll({ authoritative: true }));
  writeFileSync(mirrorPath(dir), JSON.stringify({ not: 'array' }), 'utf8');
  await step('getAll-authoritative-not-array', () => store.getAll({ authoritative: true }));
  unlinkSync(mirrorPath(dir));
  await step('getAll-authoritative-enoent', () => store.getAll({ authoritative: true }));
  return { out, console: m.con.rec, ready: m.readyCalls() };
}

test('ปิดสวิตช์ = พฤติกรรมเดิม (โหมด file fallback เทียบ HEAD)', async () => {
  for (const env of [{}, { CARD_LIBRARY_LAB: '0', CARD_LIBRARY_OVERLAY_FILE: join(tmpdir(), 'no-such-overlay.json') }]) {
    const a = await runFileScenario(newFactory, env);
    const b = await runFileScenario(headFactory, env);
    assert.deepEqual(normalize(a.out), normalize(b.out), `ผลลัพธ์ op ต่างจาก HEAD (env=${JSON.stringify(env)})`);
    assert.deepEqual(normalize(a.console), normalize(b.console), 'ข้อความ log ต่างจาก HEAD');
    assert.equal(a.ready, b.ready);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ชุดที่ 3 — เปิดแล็บ (CARD_LIBRARY_LAB=1) : อ่านจากไฟล์ overlay · เขียนเป็น no-op
// ═══════════════════════════════════════════════════════════════════════

const OVERLAY_CARDS = [
  { id: 'card1', title: '[คดีความ-เดือด] ทดสอบ', viralScore: 83, frequency: 2 },
  { id: 'card2', promptText: 'สั้นๆ', status: 'active' },
];

function makeOverlay(dir, content = JSON.stringify(OVERLAY_CARDS, null, 2)) {
  const p = join(dir, 'overlay-arm-B.json');
  writeFileSync(p, content, 'utf8');
  return p;
}

function loadLab({ overlayPath, extraEnv = {}, sbResponses = [], supabaseReady = true } = {}) {
  const dir = makeTmp('cardlab-lab-');
  const env = { CARD_LIBRARY_LAB: '1', ...extraEnv };
  if (overlayPath !== undefined) env.CARD_LIBRARY_OVERLAY_FILE = overlayPath;
  return { dir, m: loadModule(newFactory, { env, dir, sbResponses, supabaseReady }) };
}

test('เปิดแล็บ: getAll อ่านจากไฟล์ overlay ก่อนถึงสาย Supabase (ไม่ปรึกษา isSupabaseReady ไม่ยิง Supabase ไม่เขียน mirror)', async () => {
  const dir = makeTmp('cardlab-ov-');
  const overlayPath = makeOverlay(dir);
  const { dir: cwd, m } = loadLab({ overlayPath });
  const store = m.createStore('prompt-library');
  const items = await store.getAll();
  assert.deepEqual(items, OVERLAY_CARDS, 'ต้องเห็นการ์ดตามไฟล์แขนทดลอง');
  assert.equal(m.calls.length, 0, 'ห้ามยิง Supabase แม้แต่ครั้งเดียว');
  assert.equal(m.readyCalls(), 0, 'ต้อง short-circuit ก่อนเช็ค isSupabaseReady (มาก่อนสาย Supabase จริงๆ)');
  assert.equal(m.writeCalls.length, 0, 'ห้ามเขียนไฟล์ใดๆ (mirror data/ ต้องไม่ถูก sync ทับ)');
  assert.equal(existsSync(join(cwd, 'data')), false, 'โฟลเดอร์ data/ ต้องไม่ถูกสร้าง');
  assert.ok(m.readCalls.includes(overlayPath), 'ต้องอ่านไฟล์ overlay จริง');
  // getAll({authoritative:true}) ก็ต้องมาจากไฟล์เดียวกัน
  assert.deepEqual(await store.getAll({ authoritative: true }), OVERLAY_CARDS);
});

test('เปิดแล็บ: findById/count มาจากไฟล์ overlay และผลอ่านเป็นสำเนา (แก้ค่าที่คืนแล้วไฟล์/รอบถัดไปไม่เปลี่ยน)', async () => {
  const dir = makeTmp('cardlab-ov-');
  const overlayPath = makeOverlay(dir);
  const before = readFileSync(overlayPath, 'utf8');
  const { m } = loadLab({ overlayPath });
  const store = m.createStore('prompt-library');
  assert.deepEqual(await store.findById('card2'), OVERLAY_CARDS[1]);
  assert.equal(await store.findById('no-such-id'), null);
  assert.equal(await store.count(), 2);
  const got = await store.getAll();
  got[0].title = 'HACK';
  got.push({ id: 'junk' });
  assert.deepEqual(await store.getAll(), OVERLAY_CARDS, 'อ่านรอบใหม่ต้องสะอาดเสมอ');
  assert.equal(readFileSync(overlayPath, 'utf8'), before, 'ไฟล์ overlay ต้องไม่ถูกแตะ');
});

test('เปิดแล็บ: ทุก op เขียนเป็น no-op คืนค่าเหมือนสำเร็จ — ไม่ทะลุ Supabase/ไฟล์ overlay/mirror', async () => {
  const dir = makeTmp('cardlab-ov-');
  const overlayPath = makeOverlay(dir);
  const before = readFileSync(overlayPath, 'utf8');
  const { dir: cwd, m } = loadLab({ overlayPath });
  const store = m.createStore('prompt-library');

  const item = { id: 'newcard', title: 'ใบใหม่' };
  assert.deepEqual(await store.add(item), item, 'add ต้องคืน item เหมือนสำเร็จ');
  assert.deepEqual(await store.addMany([{ id: 'x1' }, { id: 'x2' }]), [{ id: 'x1' }, { id: 'x2' }]);
  assert.deepEqual(await store.addMany(undefined), [], 'addMany ว่าง = [] แบบ store จริง');

  const upd = await store.update('card1', { frequency: 99 });
  assert.equal(upd.frequency, 99, 'update ต้องคืนค่าที่ merge แล้ว (สัญญาเดิม)');
  assert.equal(upd.viralScore, 83);
  assert.ok(typeof upd.updatedAt === 'string' && upd.updatedAt.length > 0, 'update ต้องประทับ updatedAt แบบ store จริง');
  const updFn = await store.update('card1', (i) => ({ ...i, frequency: (i.frequency || 0) + 1 }));
  assert.equal(updFn.frequency, 3, 'update แบบ function ต้องเห็นค่าเดิมจากไฟล์ (ไม่ใช่ค่าที่ no-op รอบก่อน)');
  const updMissing = await cap(store.update('no-such-id', { a: 1 }));
  assert.equal(updMissing.ok, false);
  assert.match(updMissing.err, /ไม่พบ id: no-such-id/, 'update id หาย ต้องโยนแบบ store จริง');

  assert.deepEqual(await store.remove('card1'), { removed: true });
  assert.deepEqual(await store.removeAll(), { removedAll: true });

  assert.deepEqual(await store.getAll(), OVERLAY_CARDS, 'หลังเขียนทุกแบบ ข้อมูลต้องยังตรงไฟล์ overlay (ไม่มีอะไรถูกเขียนจริง)');
  assert.equal(readFileSync(overlayPath, 'utf8'), before, 'ไฟล์ overlay ต้องไบต์เดิม');
  assert.equal(m.calls.length, 0, 'ห้ามมี call ไป Supabase เลย');
  assert.equal(m.writeCalls.length, 0, 'ห้ามเขียนไฟล์ใดๆ');
  assert.equal(existsSync(join(cwd, 'data')), false, 'mirror data/ ต้องไม่ถูกสร้าง');
});

test('เปิดแล็บ: no-op เตือนครั้งแรกครั้งเดียวต่อ method (console.warn)', async () => {
  const dir = makeTmp('cardlab-ov-');
  const overlayPath = makeOverlay(dir);
  const { m } = loadLab({ overlayPath });
  const store = m.createStore('prompt-library');
  await store.add({ id: 'w1' });
  await store.add({ id: 'w2' });
  await store.add({ id: 'w3' });
  const addWarns = m.con.rec.warn.filter((w) => w.includes('no-op') && w.includes('add()'));
  assert.equal(addWarns.length, 1, `add สามครั้งต้องเตือนครั้งเดียว (ได้ ${addWarns.length})`);
  await store.remove('card1');
  await store.remove('card2');
  const removeWarns = m.con.rec.warn.filter((w) => w.includes('no-op') && w.includes('remove()'));
  assert.equal(removeWarns.length, 1, 'remove สองครั้งต้องเตือนครั้งเดียว');
});

test('เปิดแล็บ: ไฟล์หาย/JSON พัง/ไม่ใช่ array/ไม่ตั้งพาธ ต้อง throw ชัด (ห้องแล็บห้ามเงียบ)', async () => {
  const dir = makeTmp('cardlab-ov-');

  // ไม่ตั้ง CARD_LIBRARY_OVERLAY_FILE
  {
    const { m } = loadLab({ overlayPath: undefined });
    const r = await cap(m.createStore('prompt-library').getAll());
    assert.equal(r.ok, false);
    assert.match(r.err, /CARD_LIBRARY_OVERLAY_FILE/);
  }
  // ไฟล์หาย
  {
    const { m } = loadLab({ overlayPath: join(dir, 'no-such-file.json') });
    const r = await cap(m.createStore('prompt-library').getAll());
    assert.equal(r.ok, false);
    assert.match(r.err, /อ่านไฟล์ overlay ไม่ได้/);
    // ต้องพังทุกทางอ่าน ไม่ใช่แค่ getAll
    assert.equal((await cap(m.createStore('prompt-library').findById('a'))).ok, false);
    assert.equal((await cap(m.createStore('prompt-library').count())).ok, false);
    assert.equal((await cap(m.createStore('prompt-library').update('a', {}))).ok, false);
  }
  // JSON พัง
  {
    const p = join(dir, 'broken.json');
    writeFileSync(p, '{oops', 'utf8');
    const { m } = loadLab({ overlayPath: p });
    const r = await cap(m.createStore('prompt-library').getAll());
    assert.equal(r.ok, false);
    assert.match(r.err, /ไม่ใช่ JSON ที่อ่านได้/);
  }
  // ไม่ใช่ array
  {
    const p = join(dir, 'not-array.json');
    writeFileSync(p, JSON.stringify({ cards: [] }), 'utf8');
    const { m } = loadLab({ overlayPath: p });
    const r = await cap(m.createStore('prompt-library').getAll());
    assert.equal(r.ok, false);
    assert.match(r.err, /JSON array/);
  }
});

// ★ ผู้ตรวจไขว้ 3 ก.ย. (medium): ผู้เรียกหลักของ store นี้ (summarizeServiceText/summarizeService — ไฟล์ล็อก)
//   ครอบ getAll ด้วย try/catch แล้ว fallback อ่าน data/prompt-library.json ตรง และใน getTopPrompts เป็น
//   `catch (e) { }` ว่างเปล่า → throw ของแล็บหายเงียบสนิท ไม่เหลือแม้ e.message ใน log
//   ทางแก้ฝั่งไฟล์นี้: แล็บส่งเสียงเอง — อ่านพัง console.error ทุกครั้งก่อน throw + ประกาศตัวตอนสร้าง store
//   (พรีเช็คต่อแขนเทียบจำนวน+ชุด id ก่อนเชื่อผล Gate เป็นงานสาย F ใน run-dir — นอกไฟล์ของสายนี้)
test('เปิดแล็บ: อ่านพังต้อง console.error เองทุกครั้ง — เสียงรอดแม้ผู้เรียกกลืน throw ด้วย catch ว่าง', async () => {
  const dir = makeTmp('cardlab-ov-');
  // เลียนแบบผู้เรียกจริง: `try { await store.getAll(); } catch (e) { }` — กลืนเงียบทุกอย่าง
  const swallow = async (p) => { try { await p; } catch { /* ผู้เรียกล็อกกลืนแบบนี้จริง */ } };
  const failLines = (m) => m.con.rec.error.filter((e) => e.includes('[CardLibraryLab:prompt-library]'));

  // ไม่ตั้งพาธ
  {
    const { m } = loadLab({ overlayPath: undefined });
    await swallow(m.createStore('prompt-library').getAll());
    assert.equal(failLines(m).length, 1, 'ไม่ตั้งพาธ: ต้องมี console.error จากในแล็บเองแม้ throw ถูกกลืน');
    assert.match(failLines(m)[0], /CARD_LIBRARY_OVERLAY_FILE/);
  }
  // ไฟล์หาย — ทุกทางอ่านส่งเสียง และไม่กดเงียบ (แต่ละบรรทัดคือหลักฐานหนึ่ง op ที่ไถลไปใช้การ์ด prod)
  {
    const { m } = loadLab({ overlayPath: join(dir, 'no-such-file.json') });
    const store = m.createStore('prompt-library');
    await swallow(store.getAll());
    await swallow(store.findById('a'));
    await swallow(store.count());
    await swallow(store.update('a', {}));
    const lines = failLines(m).filter((e) => e.includes('อ่านไฟล์ overlay ไม่ได้'));
    assert.equal(lines.length, 4, `ทุกทางอ่านต้องส่งเสียงทุกครั้ง ห้าม dedup (ได้ ${lines.length}/4)`);
  }
  // JSON พัง / ไม่ใช่ array
  {
    const p = join(dir, 'broken.json');
    writeFileSync(p, '{oops', 'utf8');
    const { m } = loadLab({ overlayPath: p });
    await swallow(m.createStore('prompt-library').getAll());
    assert.match(failLines(m).at(-1) || '', /ไม่ใช่ JSON ที่อ่านได้/);
  }
  {
    const p = join(dir, 'not-array.json');
    writeFileSync(p, JSON.stringify({ cards: [] }), 'utf8');
    const { m } = loadLab({ overlayPath: p });
    await swallow(m.createStore('prompt-library').getAll());
    assert.match(failLines(m).at(-1) || '', /JSON array/);
  }
});

test('เปิดแล็บ: ประกาศตัวครั้งเดียวตอนสร้าง store — log ป้าย CardLibraryLab + พาธไฟล์แขน (ไม่มีบรรทัดนี้ = แล็บไม่ได้ทำงาน)', async () => {
  const dir = makeTmp('cardlab-ov-');
  const overlayPath = makeOverlay(dir);
  const { m } = loadLab({ overlayPath });
  m.createStore('prompt-library');
  m.createStore('prompt-library'); // เรียกซ้ำต้องไม่ spam
  m.createStore('viral-library');  // store อื่นต้องไม่ประกาศ (ไม่เข้าโหมดแล็บ)
  const lines = m.con.rec.warn.filter((w) => w.includes('โหมดแล็บทำงาน'));
  assert.equal(lines.length, 1, `ประกาศตัวครั้งเดียวต่อ process (ได้ ${lines.length})`);
  assert.ok(lines[0].includes('[CardLibraryLab:prompt-library]'), 'ต้องติดป้าย [CardLibraryLab ให้ runbook grep เจอ');
  assert.ok(lines[0].includes(overlayPath), 'ต้องระบุพาธไฟล์แขนที่ใช้จริง (ตรวจว่ารันถูกแขน)');
  // ไม่ตั้งพาธ: ประกาศตัวต้องบอกชัดว่ายังไม่ตั้ง (การอ่านทุกครั้งจะ throw+error อยู่แล้ว)
  const { m: m2 } = loadLab({ overlayPath: undefined });
  m2.createStore('prompt-library');
  const l2 = m2.con.rec.warn.filter((w) => w.includes('โหมดแล็บทำงาน'));
  assert.equal(l2.length, 1);
  assert.match(l2[0], /ยังไม่ตั้ง/);
});

test('เปิดแล็บ: store ชื่ออื่นไม่ถูกแตะ — วิ่งสาย Supabase ตามปกติ ไม่อ่านไฟล์ overlay', async () => {
  const dir = makeTmp('cardlab-ov-');
  const overlayPath = join(dir, 'no-such-overlay.json'); // ถ้าหลงไปอ่านจะ throw ให้เห็น
  const { m } = loadLab({
    overlayPath,
    sbResponses: [{ data: [{ data: { id: 'v1' } }], error: null }],
  });
  const store = m.createStore('viral-library');
  assert.deepEqual(await store.getAll(), [{ id: 'v1' }], 'store อื่นต้องได้ข้อมูลจากสาย Supabase เดิม');
  assert.ok(m.calls.length > 0, 'store อื่นต้องยิง Supabase ตามปกติ');
  assert.equal(m.readCalls.includes(overlayPath), false, 'ห้ามอ่านไฟล์ overlay ให้ store อื่น');
});

test('เปิดแล็บบน Vercel: เพิกเฉยสวิตช์ + console.error + ใช้เส้นทางเดิม (ทั้ง VERCEL และ VERCEL_ENV)', async () => {
  for (const vercelEnv of [{ VERCEL: '1' }, { VERCEL_ENV: 'production' }]) {
    const dir = makeTmp('cardlab-ov-');
    const overlayPath = makeOverlay(dir);
    const { m } = loadLab({
      overlayPath,
      extraEnv: vercelEnv,
      sbResponses: [{ data: [{ data: { id: 'sb1' } }], error: null }],
    });
    const store = m.createStore('prompt-library');
    const items = await store.getAll();
    assert.deepEqual(items, [{ id: 'sb1' }], `บน Vercel ต้องอ่านจากสาย Supabase เดิม (${JSON.stringify(vercelEnv)})`);
    assert.ok(m.calls.length > 0, 'บน Vercel ต้องวิ่งสาย Supabase');
    assert.equal(m.readCalls.includes(overlayPath), false, 'บน Vercel ห้ามอ่านไฟล์ overlay');
    const errs = m.con.rec.error.filter((e) => e.includes('CARD_LIBRARY_LAB') && e.includes('เพิกเฉย'));
    assert.equal(errs.length, 1, 'ต้องบันทึกเตือน (console.error) ว่าเพิกเฉยสวิตช์');
    m.createStore('prompt-library'); // เรียกซ้ำต้องไม่ spam log
    assert.equal(m.con.rec.error.filter((e) => e.includes('เพิกเฉย')).length, 1, 'เตือนครั้งเดียวพอ');
  }
});

test('เปิดแล็บ: เนื้อการ์ดผ่าน _decodeValue เหมือนสาย store จริง (mojibake ถูกแปลง)', async () => {
  const dir = makeTmp('cardlab-ov-');
  // 'สวย' ที่ถูกอ่านผิดเป็น latin1 — สาย store จริงทุกเส้นทางแปลงคืนก่อนคืนค่า ห้องแล็บต้องเท่ากัน
  const p = join(dir, 'moji.json');
  writeFileSync(p, JSON.stringify([{ id: 'mj', name: 'à¸ªà¸§à¸¢' }]), 'utf8');
  const { m } = loadLab({ overlayPath: p });
  const items = await m.createStore('prompt-library').getAll();
  assert.equal(items[0].name, 'สวย', 'ต้องถอดรหัส mojibake แบบเดียวกับ store จริง');
});
