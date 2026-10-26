/**
 * ★ 26 ต.ค. 69 เฟส 3 — หน้าจอถอดคลิปแบบ "เนื้อข่าวช่องเดียว" (เจ้าของสั่ง "พัฒนาตัวหลักพอ" · /m ไม่ใช้แล้ว)
 *   P12 ติดตามงาน: ผูกเลขงาน · อ่านพลาดไม่ใช่งานล้ม · ไม่พบงาน 2 ครั้งติดจึงจบ
 *   P10 ปักหมุดไปถูกคลัง · P13 ข้อความตรงความจริง · P20 จำงานของฉัน/ปุ่มดูผลในแถวเพิ่งจบ
 *   ลูปติดตามรันของจริงจากซอร์สหน้า (ตัดฟังก์ชันออกมารันกับ fetch ปลอม) ไม่ใช่แค่ค้นคำ
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const status = await import('../src/app/clip-transcript/ui/statusMeta.js');

// ขึ้นบรรทัดแบบ LF เสมอ (เครื่อง Windows checkout เป็น CRLF · repo เก็บ LF)
const PAGE = readFileSync(new URL('../src/app/clip-transcript/page.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => {
  const i = PAGE.indexOf(a), j = PAGE.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `หาช่วง ${a} … ${b} ไม่เจอ`);
  return PAGE.slice(i, j);
};

/** ตัด pollJob จากหน้าจริงมารันกับสถานะปลอม — คืนตัวคุม */
function makePoller(responses, { onFetch } = {}) {
  const src = between('  const pollJob = async', '  // ★ P20: งานที่ส่งไว้ก่อนรีเฟรช');
  const state = { job: null, insight: null, titles: [], removed: [], fetches: 0, loaded: 0 };
  const deps = {
    aliveRef: { current: true },
    activeJobRef: { current: null },
    setQueueJob: (v) => { state.job = typeof v === 'function' ? v(state.job) : v; },
    setInsight: (v) => { state.insight = typeof v === 'function' ? v(state.insight) : v; },
    loadInsightCases: () => { state.loaded += 1; },
    markTitle: (s) => state.titles.push(s),
    safeJson: async (r) => r.json(),
    resultToRec: status.resultToRec,
    localStorage: { removeItem: (k) => state.removed.push(k) },
    MY_JOB_KEY: 'clip_my_job',
    fetch: async (url) => {
      state.fetches += 1;
      onFetch?.(state.fetches, deps, url);
      const r = responses.shift() || { status: 200, body: { success: true, status: 'processing' } };
      return { status: r.status, json: async () => r.body };
    },
    setTimeout: (fn) => fn(),
  };
  const pollJob = new Function('deps', `const { aliveRef, activeJobRef, setQueueJob, setInsight, loadInsightCases, markTitle, safeJson, resultToRec, localStorage, MY_JOB_KEY, fetch, setTimeout } = deps;\n${src}\nreturn pollJob;`)(deps);
  return { pollJob, state, deps };
}
const ok = (body) => ({ status: 200, body: { success: true, ...body } });
const down = { status: 503, body: { success: false, error: 'อ่านสถานะงานไม่สำเร็จชั่วคราว', errorType: 'JOB_STATUS_TEMPORARILY_UNAVAILABLE' } };
const gone = { status: 404, body: { success: false, error: 'ไม่พบงานในคิว', errorType: 'JOB_NOT_FOUND' } };

test('P12: ฐานสะดุด (503) สองครั้งไม่ใช่งานล้ม — ติดตามต่อจนได้ผล · การ์ดใช้ลิงก์ของใบงาน ไม่ใช่ช่องกรอก', async () => {
  const { pollJob, state } = makePoller([down, down, ok({ status: 'processing' }),
    ok({ status: 'done', result: { id: 'c1', platform: 'tiktok', headline: 'พาดหัว', body: 'เนื้อ', engine: 'clip-single' } })]);
  state.job = { jobId: 'J1', status: 'pending' };
  await pollJob('J1', 'https://www.tiktok.com/@a/video/1');
  assert.equal(state.job.status, 'done');
  assert.equal(state.job.connWarn, false);
  assert.equal(state.insight.url, 'https://www.tiktok.com/@a/video/1');
  assert.equal(status.cardView(state.insight).headline, 'พาดหัว');
  assert.deepEqual(state.titles, ['done']);
  assert.equal(state.loaded, 1);
});

test('P12: อ่านพลาด 3 ครั้งติด = เตือน "เชื่อมต่อไม่ได้ งานอาจยังทำอยู่" แต่ยังติดตามต่อ · กลับมาได้แล้วป้ายหาย', async () => {
  const seen = [];
  const { pollJob, state } = makePoller([down, down, down, ok({ status: 'processing' }), ok({ status: 'error', error: 'ดูคลิปไม่สำเร็จ' })],
    { onFetch: (n) => seen.push(n) });
  state.job = { jobId: 'J2', status: 'pending' };
  const run = pollJob('J2', 'u');
  await run;
  assert.equal(state.job.status, 'error', 'งานล้มจริงต้องแสดงตามที่หลังบ้านบอก');
  assert.equal(state.job.connWarn, false);
  assert.equal(seen.length, 5, 'ต้องเช็คต่อหลังพลาด 3 ครั้ง ไม่เลิกกลางทาง');
});

test('P12: ป้ายเตือนเชื่อมต่อขึ้นจริงเมื่อพลาดครบ 3 ครั้ง', async () => {
  let snapshot = null;
  const { pollJob, state } = makePoller([down, down, down, ok({ status: 'done', result: { headline: 'h', body: 'b' } })],
    { onFetch: (n, deps) => { if (n === 4) snapshot = { ...state.job }; } });
  state.job = { jobId: 'J3', status: 'pending' };
  await pollJob('J3', 'u');
  assert.equal(snapshot.connWarn, true);
  assert.equal(snapshot.status, 'pending', 'ระหว่างเชื่อมต่อไม่ได้ ห้ามเปลี่ยนเป็นไม่สำเร็จ');
});

test('P12: "ไม่พบงาน" ครั้งเดียวยังติดตามต่อ · สองครั้งติดจึงจบเป็นไม่สำเร็จและลืมงานที่จำไว้', async () => {
  const a = makePoller([gone, ok({ status: 'done', result: { headline: 'h', body: 'b' } })]);
  a.state.job = { jobId: 'J4', status: 'pending' };
  await a.pollJob('J4', 'u');
  assert.equal(a.state.job.status, 'done');

  const b = makePoller([gone, gone]);
  b.state.job = { jobId: 'J5', status: 'pending' };
  await b.pollJob('J5', 'u');
  assert.equal(b.state.job.status, 'error');
  assert.match(b.state.job.error, /ไม่พบงาน/);
  assert.deepEqual(b.state.removed, ['clip_my_job']);
});

test('P12: ส่งงานใหม่ระหว่างติดตาม — ลูปงานเก่าเลิกเอง ไม่เขียนทับการ์ดงานใหม่', async () => {
  const { pollJob, state } = makePoller([ok({ status: 'processing' }), ok({ status: 'processing' }), ok({ status: 'done', result: { headline: 'ของงานเก่า', body: 'x' } })], {
    onFetch: (n, deps) => { if (n === 2) { deps.activeJobRef.current = 'NEW'; state.job = { jobId: 'NEW', status: 'pending' }; } },
  });
  state.job = { jobId: 'OLD', status: 'pending' };
  await pollJob('OLD', 'u-old');
  assert.equal(state.fetches, 2, 'ลูปเก่าต้องหยุดทันทีที่มีงานใหม่');
  assert.deepEqual(state.job, { jobId: 'NEW', status: 'pending' });
  assert.equal(state.insight, null, 'ผลของงานเก่าต้องไม่โผล่ทับ');
});

test('P10: ปักหมุดส่งไปคลังผลถอดคลิป (kind=insight) และบอกผลทั้งสำเร็จ/ไม่สำเร็จ', () => {
  const fn = between('const pinInsightCase', 'const gotoPage');
  assert.match(fn, /\/api\/clip-transcript\/cases\?kind=insight/);
  assert.match(fn, /setErr\(d\.error \|\| 'ปักหมุดไม่สำเร็จ'\)/);
  assert.match(fn, /setNotice\(d\.warning \|\|/);
  assert.doesNotMatch(fn, /catch \{\}/, 'ห้ามกลืน error เงียบ');
  // ลบ: ยืนยันชั้นเดียว (ในการ์ด) และบอกผล
  const del = between('const deleteInsightCase', 'const pinInsightCase');
  assert.doesNotMatch(del, /confirm\(/);
  assert.match(del, /setErr\(d\.error \|\| 'ลบไม่สำเร็จ'\)/);
});

test('P13: ข้อความ "เครื่องแอดมินดับ" ตั้งหลังส่งงานสำเร็จ (เดิมถูกล้างทันที) · ยกเลิกบอกตามจริงเมื่อเครื่องกำลังถอด', () => {
  const submit = between('const submitToQueue', 'const pollJob');
  const clear = submit.indexOf("setNotice('')");
  const set = submit.indexOf('setNotice(opts.notice)');
  assert.ok(clear >= 0 && set > clear, 'ต้องล้างก่อน แล้วค่อยตั้งข้อความหลังส่งสำเร็จ');
  assert.match(between('const runPrimary', 'const runBackup'), /notice: '🔴 เครื่องแอดมินดับอยู่/);
  const cancel = between('const onCancel', 'const onRetry');
  assert.match(cancel, /\(d\.previousStatus \|\| status\) === 'processing'/);
  assert.match(cancel, /ทำต่อจนจบ/);
  // การ์ด "งานของฉัน" เปลี่ยนเป็นยกเลิกทันที ไม่ต้องรอรอบเช็คถัดไป (เฉพาะใบเดียวกัน)
  assert.match(cancel, /if \(d\.success\) setQueueJob\(j => \(j && j\.jobId === jobId \? \{ \.\.\.j, status: 'cancelled' \} : j\)\);/);
  const route = readFileSync(new URL('../src/app/api/clip-transcript/cancel/route.js', import.meta.url), 'utf8');
  assert.match(route, /previousStatus: job\.status/);
  // นาฬิกา "ถอดมาแล้ว" เดินระหว่างงานของฉันกำลังถอด
  assert.match(PAGE, /queueJob\.status === 'processing'\)\) \|\|/);
  // ช่องติ๊ก "เรียบเรียงให้อ่านลื่น" ไม่มีผลใดๆ → เอาออก
  assert.doesNotMatch(PAGE, /เรียบเรียงให้อ่านลื่น|setTidy/);
  // ไฟ Gemini: ตอบปกติเร็ว = เขียว (เดิมเหลืองตลอดบน Vercel)
  const health = readFileSync(new URL('../src/app/api/clip-transcript/gemini-health/route.js', import.meta.url), 'utf8');
  assert.match(health, /light: 'green', ok: true, ms, src: 'text'/);
});

test('P20: ต้องมีชื่อผู้ส่งก่อนยิงงาน · จำงานของฉันไว้ 6 ชม. รีเฟรชแล้วติดตามต่อ', () => {
  for (const name of ['const submitToQueue', 'const extractInsight']) {
    const fn = PAGE.slice(PAGE.indexOf(name), PAGE.indexOf('fetch(', PAGE.indexOf(name)));
    assert.match(fn, /if \(needUser\(\)\) return;/, `${name} ต้องเช็คชื่อก่อนยิงคำขอ`);
  }
  assert.match(PAGE, /MY_JOB_TTL_MS = 6 \* 60 \* 60 \* 1000/);
  const mount = between('  // ★ P20: งานที่ส่งไว้ก่อนรีเฟรช', '  // ── handlers ให้ JobBoard ──');
  assert.match(mount, /localStorage\.getItem\(MY_JOB_KEY\)/);
  assert.match(mount, /pollJob\(mine\.jobId, mine\.url \|\| ''\)/);
  assert.match(between('const submitToQueue', 'const pollJob'), /rememberJob\(d\.jobId, target\)/);
});

// ── บอร์ดงาน (เรนเดอร์จริง) ──
function loadJobBoard() {
  const code = readFileSync(new URL('../src/app/clip-transcript/ui/JobBoard.js', import.meta.url), 'utf8');
  const out = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mods = { react: React, './statusMeta': status, './StatusPill': { __esModule: true, default: ({ status: s }) => React.createElement('span', null, `[${s}]`) } };
  const m = { exports: {} };
  new Function('require', 'module', 'exports', 'React', out)((n) => mods[n], m, m.exports, React);
  return m.exports.default;
}
function find(el, pred, out = []) {
  if (!el || typeof el !== 'object') return out;
  if (Array.isArray(el)) { el.forEach((e) => find(e, pred, out)); return out; }
  if (typeof el.type === 'function') return find(el.type(el.props), pred, out);
  if (pred(el)) out.push(el);
  find(el.props?.children, pred, out);
  return out;
}
const textOf = (el) => el == null || typeof el === 'boolean' ? '' : typeof el !== 'object' ? String(el) : Array.isArray(el) ? el.map(textOf).join('') : textOf(el.props?.children);

test('P20/P13: แถวเพิ่งจบที่เสร็จแล้วมีปุ่มดูผล · ปุ่มยกเลิกงานที่กำลังถอดเตือนตามจริง · ป้ายเชื่อมต่อไม่ได้', () => {
  const JobBoard = loadJobBoard();
  const viewed = [];
  const cancelled = [];
  const queue = { counts: { processing: 1 }, active: [{ id: 'A1', url: 'https://youtu.be/x', platform: 'youtube', status: 'processing', attempts: 0 }],
    recent: [{ id: 'D1', url: 'https://youtu.be/done', status: 'done', user: 'บี' }, { id: 'E1', url: 'https://youtu.be/err', status: 'error', error: 'ล้ม' }] };
  const tree = React.createElement(JobBoard, { queue, myJob: { jobId: 'A1', status: 'processing', connWarn: true, url: 'https://youtu.be/x' }, nowMs: Date.now(), onViewResult: (j) => viewed.push(j.id), onCancel: (id, s) => cancelled.push([id, s]) });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /เช็คสถานะไม่ได้ชั่วคราว — งานอาจยังทำอยู่/);
  assert.match(html, /👤 บี · youtu\.be\/done/);
  const viewBtns = find(tree, (e) => e.type === 'button' && /ดูผล/.test(textOf(e)));
  assert.equal(viewBtns.length, 1, 'ปุ่มดูผลเฉพาะใบที่เสร็จ (ใบล้มไม่มี)');
  viewBtns[0].props.onClick();
  assert.deepEqual(viewed, ['D1']);

  const asked = [];
  globalThis.window = { confirm: (m) => { asked.push(m); return true; } };
  try {
    const cancelBtns = find(tree, (e) => e.type === 'button' && /ยกเลิก/.test(textOf(e)));
    assert.ok(cancelBtns.length >= 1);
    cancelBtns[0].props.onClick();
  } finally { delete globalThis.window; }
  assert.match(asked[0], /รอบนี้จะทำต่อจนจบ/);
  assert.deepEqual(cancelled[0], ['A1', 'processing']);
});

// ── ผู้ตรวจอิสระรอบ 1 (26 ต.ค.) ──
function makeSubmitter({ response, user = 'บี' } = {}) {
  const src = between('  const submitToQueue = async', '  /**\n   * ติดตามงาน');
  const st = { calls: [], err: '', notice: '', submitting: null, polled: [], remembered: [], titles: [] };
  const deps = {
    url: 'https://www.tiktok.com/@a/video/9', currentUser: user,
    needUser: () => !user,
    setSubmitting: (v) => { st.submitting = v; }, setErr: (v) => { st.err = v; }, setNotice: (v) => { st.notice = v; },
    safeJson: async (r) => r.json(),
    fetch: async () => ({ status: response.status, json: async () => response.body }),
    aliveRef: { current: true }, baseTitleRef: { current: 'หน้าเดิม' },
    setTabTitle: (t) => st.titles.push(t),
    setQueueJob: (v) => st.calls.push(v),
    rememberJob: (...a) => st.remembered.push(a), loadQueueList: () => {}, pollJob: (...a) => st.polled.push(a),
  };
  const fn = new Function('deps', `const { url, currentUser, needUser, setSubmitting, setErr, setNotice, safeJson, fetch, aliveRef, baseTitleRef, setTabTitle, setQueueJob, rememberJob, loadQueueList, pollJob } = deps;\n${src}\nreturn submitToQueue;`)(deps);
  return { submit: fn, st };
}

test('รอบ 2: ส่งงานใหม่ไม่สำเร็จ — การ์ด/ลูปของงานที่กำลังถอดอยู่ต้องไม่หาย', async () => {
  const { submit, st } = makeSubmitter({ response: { status: 500, body: { success: false, error: 'คิวเต็มชั่วคราว' } } });
  await submit('https://www.tiktok.com/@a/video/2', true);
  assert.equal(st.err, 'คิวเต็มชั่วคราว');
  assert.deepEqual(st.calls, [], 'ห้ามล้างการ์ดงานเดิมเมื่อส่งไม่สำเร็จ');
  assert.deepEqual(st.polled, []);
  assert.deepEqual(st.titles, [], 'ชื่อแท็บของงานเดิมยังอยู่');
  assert.equal(st.submitting, false);
});

test('รอบ 2: ส่งสำเร็จ — ตั้งการ์ดใบใหม่ จำงาน เริ่มติดตาม และข้อความแจ้งขึ้นหลังส่ง', async () => {
  const { submit, st } = makeSubmitter({ response: { status: 200, body: { success: true, jobId: 'N1', status: 'pending', position: 2, platform: 'tiktok' } } });
  await submit(null, false, { notice: '🔴 เครื่องแอดมินดับอยู่' });
  assert.equal(st.calls.length, 1);
  assert.equal(st.calls[0].jobId, 'N1');
  assert.equal(st.calls[0].url, 'https://www.tiktok.com/@a/video/9');
  assert.deepEqual(st.polled, [['N1', 'https://www.tiktok.com/@a/video/9']]);
  assert.deepEqual(st.remembered, [['N1', 'https://www.tiktok.com/@a/video/9']]);
  assert.equal(st.notice, '🔴 เครื่องแอดมินดับอยู่');
  // ไม่มีชื่อ = ไม่ยิงคำขอเลย
  const noName = makeSubmitter({ user: '', response: { status: 200, body: { success: true, jobId: 'X' } } });
  await noName.submit();
  assert.deepEqual(noName.st.calls, []);
  assert.deepEqual(noName.st.polled, []);
});

test('รอบ 2: เรียกติดตามซ้ำด้วยเลขงานเดิม (ส่งลิงก์ซ้ำได้ dup) — ลูปเก่าเลิก ไม่ยิงซ้อนสองลูป', async () => {
  const { pollJob, state } = makePoller([ok({ status: 'processing' }), ok({ status: 'processing' }), ok({ status: 'done', result: { headline: 'h', body: 'b' } })], {
    onFetch: (n, deps) => { if (n === 2) deps.activeJobRef.current = { jobId: 'SAME' }; },
  });
  state.job = { jobId: 'SAME', status: 'pending' };
  await pollJob('SAME', 'u');
  assert.equal(state.fetches, 2, 'ตั๋วใหม่ของเลขงานเดิมต้องทำให้ลูปเก่าเลิก');
  assert.equal(state.insight, null);
});

test('รอบ 2: รีเฟรชหน้า — งานที่จำไว้ไม่เกิน 6 ชม. ติดตามต่อจริง · เกินแล้วลืม (รันโค้ดจริงของหน้า)', () => {
  const src = between('  // ★ P20: งานที่ส่งไว้ก่อนรีเฟรช', '  // ── handlers ให้ JobBoard ──');
  const run = (saved, now) => {
    const st = { jobs: [], polled: [], removed: [] };
    const deps = {
      useEffect: (fn) => fn(), queueMicrotask: (fn) => fn(), aliveRef: { current: true },
      localStorage: { getItem: () => saved, removeItem: (k) => st.removed.push(k) },
      setQueueJob: (v) => st.jobs.push(v), pollJob: (...a) => st.polled.push(a),
      MY_JOB_KEY: 'clip_my_job', MY_JOB_TTL_MS: 6 * 3600e3, Date: { now: () => now },
    };
    new Function('deps', `const { useEffect, queueMicrotask, aliveRef, localStorage, setQueueJob, pollJob, MY_JOB_KEY, MY_JOB_TTL_MS, Date } = deps;\n${src}`)(deps);
    return st;
  };
  const t0 = 1_000_000_000_000;
  const fresh = run(JSON.stringify({ jobId: 'R1', url: 'https://youtu.be/r', at: t0 }), t0 + 5 * 3600e3);
  assert.deepEqual(fresh.polled, [['R1', 'https://youtu.be/r']]);
  assert.equal(fresh.jobs[0].jobId, 'R1');
  const stale = run(JSON.stringify({ jobId: 'R2', url: 'u', at: t0 }), t0 + 7 * 3600e3);
  assert.deepEqual(stale.polled, []);
  assert.deepEqual(stale.removed, ['clip_my_job']);
  assert.deepEqual(run(null, t0).polled, []);
  assert.deepEqual(run('{พัง', t0).polled, [], 'ข้อมูลในเครื่องเสียต้องไม่ทำหน้าพัง');
});

test('รอบ 2: ติดตามครบเพดานแล้วหยุด — การ์ดบอกว่าหยุดเช็คอัตโนมัติ (เดิมค้างเงียบ)', () => {
  const JobBoard = loadJobBoard();
  const html = renderToStaticMarkup(React.createElement(JobBoard, { myJob: { jobId: 'P', status: 'processing', _pollEnded: true, connWarn: true }, nowMs: Date.now() }));
  assert.match(html, /หยุดเช็คสถานะอัตโนมัติแล้ว/);
  assert.doesNotMatch(html, /ระบบเช็คต่อให้เอง/, 'หยุดแล้วห้ามบอกว่ายังเช็คต่อ');
});

// ── ผู้ตรวจอิสระรอบ 2 (26 ต.ค.) ──
test('รอบ 3: อ่านคิว — รู้สถานะเครื่องล้างตัวนับ · ไม่มีชีพจร/อ่านไม่ได้เริ่มนับครั้งเดียว ไม่รีเซ็ตทุกรอบ (รันโค้ดจริง)', async () => {
  const src = between('  const loadQueueList = async', '  useEffect(() => {');
  const run = async (fetchImpl, prev) => {
    let since = prev; let list = null;
    const deps = {
      fetch: fetchImpl, aliveRef: { current: true },
      setQueueList: (v) => { list = v; }, setUnknownSince: (fn) => { since = fn(since); },
      Date: { now: () => 5000 },
    };
    const fn = new Function('deps', `const { fetch, aliveRef, setQueueList, setUnknownSince, Date } = deps;\n${src}\nreturn loadQueueList;`)(deps);
    await fn();
    return { since, list };
  };
  const okKnown = async () => ({ json: async () => ({ success: true, worker: { known: true, alive: true } }) });
  const okUnknown = async () => ({ json: async () => ({ success: true, worker: { known: false } }) });
  const boom = async () => { throw new Error('net'); };
  assert.equal((await run(okKnown, 1234)).since, 0);
  assert.equal((await run(okUnknown, 0)).since, 5000);
  assert.equal((await run(okUnknown, 1234)).since, 1234, 'ไม่รีเซ็ตเวลาเริ่มนับทุกรอบ');
  const failed = await run(boom, 0);
  assert.equal(failed.since, 5000, 'อ่านคิวไม่ได้ = ไม่รู้สถานะ (ไม่เชื่อภาพเก่า)');
  assert.equal(failed.list, null);
});

test('รอบ 3: ถอดสำรองไม่แตะการ์ด/ลูปของงานในคิว (ล้มแล้วงานในคิวยังติดตามต่อ)', () => {
  const fn = between('const extractInsight', 'const rememberJob');
  assert.doesNotMatch(fn, /setQueueJob\(null\)/);
  assert.doesNotMatch(fn, /activeJobRef\.current = null/);
  assert.match(fn, /if \(needUser\(\)\) return;/);
});

// ── ผู้ตรวจอิสระรอบ 3 (ข้อเล็ก) ──
test('รอบ 4: ผลงานคิวไม่ทับการ์ดผลถอดสำรองของคลิปอื่นที่เปิดดูอยู่ · คลิปเดียวกันอัปเดตตามปกติ', async () => {
  const done = ok({ status: 'done', result: { headline: 'ผลจากคิว', body: 'b' } });
  const other = makePoller([done]);
  other.state.job = { jobId: 'Q1', status: 'processing' };
  other.state.insight = { url: 'https://youtu.be/backup', _from: 'backup', insight: { headline: 'ผลสำรอง' } };
  await other.pollJob('Q1', 'https://youtu.be/queue');
  assert.equal(other.state.insight.url, 'https://youtu.be/backup', 'การ์ดสำรองของคลิปอื่นต้องอยู่');
  assert.equal(other.state.job.status, 'done', 'การ์ดงานของฉันยังบอกว่าเสร็จ (กดดูผลได้)');
  const same = makePoller([done]);
  same.state.job = { jobId: 'Q2', status: 'processing' };
  same.state.insight = { url: 'https://youtu.be/queue', _from: 'backup' };
  await same.pollJob('Q2', 'https://youtu.be/queue');
  assert.equal(status.cardView(same.state.insight).headline, 'ผลจากคิว');
  // ชิปสถานะเครื่องไม่ค้างภาพเก่าเมื่ออ่านคิวไม่ได้
  assert.match(PAGE, /const wchip = workerChip\(unknownSince \? null : worker\);/);
});

test('รอบ 5: การ์ดที่เปิดจากปุ่ม "ดูผล" ของงานอื่น ไม่ถูกผลงานของฉันทับ', async () => {
  const p = makePoller([ok({ status: 'done', result: { headline: 'งานของฉัน', body: 'b' } })]);
  p.state.job = { jobId: 'M1', status: 'processing' };
  p.state.insight = { url: 'https://youtu.be/viewed', _from: 'view' };
  await p.pollJob('M1', 'https://youtu.be/mine');
  assert.equal(p.state.insight.url, 'https://youtu.be/viewed');
  assert.match(between('const onViewResult', 'const deleteInsightCase'), /_from: 'view'/);
});
