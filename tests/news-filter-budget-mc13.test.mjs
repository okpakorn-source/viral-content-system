// 🔏 ข้อสอบงบเวลาต่อ request ของหน้า /news-filter (MC-13) — src/lib/services/newsFilterService.js + src/app/api/news-filter/route.js + split/route.js
// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ)
//
// บั๊กที่ปิด (ผู้ตรวจยืนยัน 2 คน): route รอคิวได้ ~40.8s + Claude เพดานคงที่ 100s + ถอย luna ไม่มีเพดาน (callAI ไม่ส่ง signal → SDK 600s)
//   > maxDuration 180 → Vercel ตัดฟังก์ชันกลางทาง ผู้ใช้ไม่ได้ทั้งผล luna และผล regex สำรอง
// สิ่งที่ล็อกไว้:
//   A. สวิตช์ NEWS_FILTER_BUDGET_LEGACY (1/true/on/yes/legacy = เส้นเดิม) · NEWS_FILTER_FALLBACK_MS (ไม่ตั้ง/เพี้ยน/≤0 = 30000)
//      · สูตร planNewsFilterBudget: งบ = maxDuration − 10s · Claude = min(100s, งบ − ใช้ไปแล้ว − luna) · < 15s = ข้าม · luna = min(เพดาน, งบที่เหลือ)
//   B. ค่าเริ่มต้น (route จริง + คิวเต็มจริงในลูป 40.8s + นาฬิกาเสมือน): Claude ค้าง + luna ค้าง → ตอบที่ 170.0s (≤ งบ < 180) ด้วยผล regex สำรอง
//      · luna ได้ signal และถูกยกเลิก HTTP จริง · luna ตอบ 20s → ผล luna ที่ 160s · Claude ตอบ 45s → ผล Claude (ไม่แตะ luna) · classify ก็ทันงบ ·
//      split: Claude ค้าง + luna ค้าง → ตอบที่ 130s · งบเหลือน้อย → ข้าม Claude ไป luna ทันที · งบหมด → regex ทันทีไม่เรียก AI
//   C. โหมดถอย NEWS_FILTER_BUDGET_LEGACY=1 = เดิมทุกไบต์: args เดิม (luna ไม่มี signal) · คิวเต็ม + Claude ค้าง + luna ค้าง → 180s ยังไม่ตอบ (Vercel ตัด)
//      · luna 60s → ตอบที่ 200.8s (เกิน 180 = บั๊กเดิม) · split ค้างเกิน 180s
// เวลา: ห้ามรอ timer จริง — setTimeout/Date ใช้ mock.timers ของ node:test (ขยับทีละ 200ms + flush ด้วย setImmediate จริงที่ ref อยู่)
//   · รอผลท้ายข้อผ่าน settleWithin (tests/helpers/fake-deadline.mjs) หลังคืน timer จริง (แดงข้อเดียว ไม่ลามทั้งไฟล์ · node 22) · ไม่มี unref
//   · ไม่มี API/network/DB: stub callClaude/callAI/modelConfig/NextResponse/persistStore (คิวในหน่วยความจำ — ไม่เขียน data/)
//
// วิธีรัน:  node --test tests/news-filter-budget-mc13.test.mjs
// โหมดกลายพันธุ์ (พิสูจน์ว่าข้อสอบกัดจริง — เทสต้องแดง · แก้เฉพาะสำเนาในหน่วยความจำ):
//   NF_BUDGET_TEST_MUTATION=no-luna-cap        luna เรียกตรงไม่มีเพดาน (บั๊กเดิมฝั่ง luna)
//   NF_BUDGET_TEST_MUTATION=no-luna-signal     luna มีเพดานแต่ไม่ส่ง signal (เลิกรอแต่ไม่ยกเลิก HTTP จริง = จ่ายเงินค้าง)
//   NF_BUDGET_TEST_MUTATION=fixed-claude-cap   Claude เพดานคงที่ 100s ไม่หักเวลารอคิว
//   NF_BUDGET_TEST_MUTATION=route-start-late   route เริ่มนับงบหลังรอคิว (ไม่รวมเวลารอคิว)
//   NF_BUDGET_TEST_MUTATION=no-legacy-switch   NEWS_FILTER_BUDGET_LEGACY=1 ไม่ได้เส้นเดิม
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importPatchedGraph } from './helpers/temp-module.mjs';
import { settleWithin } from './helpers/fake-deadline.mjs';

const MUTATION = process.env.NF_BUDGET_TEST_MUTATION || '';
const KNOWN_MUTATIONS = ['no-luna-cap', 'no-luna-signal', 'fixed-claude-cap', 'route-start-late', 'no-legacy-switch'];
if (MUTATION && !KNOWN_MUTATIONS.includes(MUTATION)) throw new Error('ไม่รู้จัก mutation: ' + MUTATION);
if (MUTATION) console.log(`🧬 MUTATION ACTIVE: ${MUTATION} — ข้อสอบชุดนี้ต้องแดงจึงจะถือว่ากัดจริง`);

const srcUrl = (rel) => new URL(rel, import.meta.url);
const readSrc = (rel) => readFileSync(srcUrl(rel), 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (src, from, to, label) => {
  const out = src.replace(from, to);
  if (out === src) throw new Error('replace ไม่เกิดผล: ' + label);
  return out;
};

// ── ซอร์สจริง 3 ไฟล์ + stub เฉพาะขอบนอก (AI · modelConfig · NextResponse · persistStore) ──
let serviceSource = readSrc('../src/lib/services/newsFilterService.js');
serviceSource = mustReplace(serviceSource, "import { callAI } from '@/lib/ai/openai';",
  "const callAI = (args) => globalThis.__NF_AI__('openai', args);", 'stub openai');
serviceSource = mustReplace(serviceSource, "import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'gpt-5.6-luna';", 'stub modelConfig');
serviceSource = mustReplace(serviceSource, "import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient';",
  "const callClaude = (args) => globalThis.__NF_AI__('claude', args); const isClaudeAvailable = () => globalThis.__NF_CLAUDE_KEY__ !== false;", 'stub claudeClient');
const ROUTE_STUBS = [
  ["import { NextResponse } from 'next/server';", 'const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };'],
  ["import { createStore } from '@/lib/persistStore';", 'const createStore = (name) => globalThis.__NF_STORE__(name);'],
];
let routeSource = readSrc('../src/app/api/news-filter/route.js');
let splitSource = readSrc('../src/app/api/news-filter/split/route.js');
for (const [from, to] of ROUTE_STUBS) {
  routeSource = mustReplace(routeSource, from, to, `route ${from}`);
  if (splitSource.includes(from)) splitSource = mustReplace(splitSource, from, to, `split ${from}`);
}

if (MUTATION === 'no-luna-cap') {
  serviceSource = mustReplace(serviceSource,
    'const result = await runNewsFilterCapped((signal) => callAI({ prompt, model, temperature, maxTokens, signal }),\n    lunaMs, `news_filter_fallback:${label}`);',
    'const result = await callAI({ prompt, model, temperature, maxTokens });', 'mutation no-luna-cap');
} else if (MUTATION === 'no-luna-signal') {
  serviceSource = mustReplace(serviceSource, '(signal) => callAI({ prompt, model, temperature, maxTokens, signal })',
    '() => callAI({ prompt, model, temperature, maxTokens })', 'mutation no-luna-signal');
} else if (MUTATION === 'fixed-claude-cap') {
  serviceSource = mustReplace(serviceSource, '}), plan.claudeMs, `news_filter_claude:${label}`);',
    '}), NEWS_FILTER_TIMEOUT_MS, `news_filter_claude:${label}`);', 'mutation fixed-claude-cap');
} else if (MUTATION === 'route-start-late') {
  routeSource = mustReplace(routeSource, 'newsFilterBudget(_reqStartedAt, maxDuration)', 'newsFilterBudget(Date.now(), maxDuration)', 'mutation route-start-late');
} else if (MUTATION === 'no-legacy-switch') {
  serviceSource = mustReplace(serviceSource, 'if (!isNewsFilterBudgetLegacy()) return callNewsFilterAIBudgeted(',
    'if (true) return callNewsFilterAIBudgeted(', 'mutation no-legacy-switch');
}

delete process.env.NEWS_FILTER_MODEL; // NEWS_FILTER_MODEL อ่านตอน import → ค่าเริ่มต้น claude-opus-5-5
const SERVICE_LINK = { '@/lib/services/newsFilterService': 'service' };
const graph = await importPatchedGraph({
  service: { source: serviceSource, originalUrl: srcUrl('../src/lib/services/newsFilterService.js') },
  route: { source: routeSource, originalUrl: srcUrl('../src/app/api/news-filter/route.js'), links: SERVICE_LINK },
  split: { source: splitSource, originalUrl: srcUrl('../src/app/api/news-filter/split/route.js'), links: SERVICE_LINK },
});
const svc = graph.service;
assert.equal(graph.route.maxDuration, 180, 'route /api/news-filter maxDuration ต้องเป็น 180 (สมมติฐานของงบ)');
assert.equal(graph.split.maxDuration, 180, 'route /split maxDuration ต้องเป็น 180');

// ── คลังในหน่วยความจำแทน persistStore (คิว/คลังเคส) — ไม่มี I/O ──
const stores = new Map();
globalThis.__NF_STORE__ = (name) => {
  if (!stores.has(name)) stores.set(name, []);
  const rows = stores.get(name);
  return {
    getAll: async () => rows.map((r) => ({ ...r })),
    add: async (row) => { rows.push({ ...row }); return row; },
    update: async (id, fn) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows[i] = fn(rows[i]); return rows[i]; },
    remove: async (id) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
  };
};
const fillQueue = (n) => {
  const rows = [];
  for (let i = 0; i < n; i += 1) rows.push({ id: `busy-${i}`, status: 'processing', queuedAt: new Date().toISOString(), startedAt: new Date().toISOString() });
  stores.set('news-filter-queue', rows);
};

// ── AI ปลอม: จดคำขอ + เวลาเสมือน · เคารพ signal (abort → reject) · แผนต่อชนิด { mode: 'hang' | 'ok' | 'throw', after, answer } ──
const calls = [];
let plan = {};
let T0 = 0;
const vnow = () => Date.now() - T0;
const kindOf = (fn, args) => (fn === 'claude' ? 'claude' : args.model === 'gpt-5.6-terra' ? 'terra' : 'luna');
const reasonOf = (sig) => (sig.reason instanceof Error ? sig.reason : Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }));
const FACT_CORE = { factCore: 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้าน ยึดของกลาง 12 รายการ มูลค่า 350,000 บาท', removed: ['สำนวนเกริ่น'] };
globalThis.__NF_AI__ = (fn, args) => {
  const kind = kindOf(fn, args);
  const call = { kind, args, keys: Object.keys(args), signal: args.signal, at: vnow(), abortedAt: null };
  calls.push(call);
  const sig = args.signal;
  if (sig && typeof sig.addEventListener === 'function') sig.addEventListener('abort', () => { call.abortedAt = vnow(); }, { once: true });
  const p = plan[kind] || { mode: 'throw' };
  if (p.mode === 'throw') return Promise.reject(new Error(`mock-${kind}-down`));
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => { if (timer) clearTimeout(timer); timer = null; reject(reasonOf(sig)); };
    if (sig && typeof sig.addEventListener === 'function') {
      if (sig.aborted) { onAbort(); return; }
      sig.addEventListener('abort', onAbort, { once: true });
    }
    const answer = () => { timer = null; sig?.removeEventListener?.('abort', onAbort); resolve(structuredClone(p.answer || FACT_CORE)); };
    if (p.mode === 'ok') { if (p.after > 0) timer = setTimeout(answer, p.after); else answer(); }
    // 'hang' = ไม่ตอบจนกว่าจะถูกยกเลิก (ไม่มี timer/handle)
  });
};
const byKind = (kind) => calls.filter((c) => c.kind === kind);

const withEnv = async (pairs, fn) => {
  const prior = {};
  for (const [k, v] of Object.entries(pairs)) { prior[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
const quietConsole = () => {
  const prior = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return () => { console.log = prior.log; console.warn = prior.warn; console.error = prior.error; };
};
const flush = () => new Promise((resolve) => setImmediate(resolve)); // setImmediate จริง (ไม่ mock) = handle ที่ ref ค้ำ loop ระหว่างรอ
const STEP = 200;
const advance = async (timers, ms) => {
  await flush();
  let left = ms;
  while (left > 0) {
    const d = Math.min(STEP, left);
    timers.tick(d);
    left -= d;
    await flush();
  }
};
const capture = (promise) => {
  const box = { state: 'pending', value: undefined, error: undefined, at: null };
  box.done = promise.then(
    (value) => { box.state = 'resolved'; box.value = value; box.at = vnow(); return box; },
    (error) => { box.state = 'rejected'; box.error = error; box.at = vnow(); return box; },
  );
  return box;
};
/** เปิดนาฬิกาเสมือน (setTimeout+Date) ตลอด body → คืน timer จริง · body คืน box ที่ต้องรอผลท้ายข้อ (หรือ null) */
const virtualCase = async (t, env, body) => withEnv({ NEWS_FILTER_BUDGET_LEGACY: undefined, NEWS_FILTER_FALLBACK_MS: undefined, ...env }, async () => {
  calls.length = 0;
  plan = {};
  stores.clear();
  globalThis.__NF_CLAUDE_KEY__ = true;
  const restoreConsole = quietConsole();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
  T0 = Date.now();
  try {
    return await body(t.mock.timers);
  } finally {
    t.mock.timers.reset();
    restoreConsole();
  }
});
const NEWS = 'ตำรวจ สน.บางนา จับกุมชายวัย 34 ปี ผู้ต้องสงสัยชิงทรัพย์ร้านทอง 3 ร้านภายใน 2 สัปดาห์ ได้ที่บ้านพักย่านบางนา เจ้าหน้าที่ยึดของกลางได้ 12 รายการ มูลค่ารวม 350,000 บาท ทำเอาชาวเน็ตใจหาย';
const postFilter = (body) => graph.route.POST({ json: async () => body });
const postSplit = (text) => graph.split.POST({ json: async () => ({ text }) });

// ═══ A) สวิตช์ + สูตรงบ ═══
test('A1 NEWS_FILTER_BUDGET_LEGACY: 1/true/on/yes/legacy = เส้นเดิม · อื่นๆ = ค่าเริ่มต้นใหม่ · NEWS_FILTER_FALLBACK_MS ไม่ตั้ง/เพี้ยน/≤0 = 30000', async () => {
  for (const v of ['1', 'true', 'on', 'yes', 'legacy', ' "1" ', 'TRUE']) {
    await withEnv({ NEWS_FILTER_BUDGET_LEGACY: v }, () => assert.equal(svc.isNewsFilterBudgetLegacy(), true, JSON.stringify(v)));
  }
  for (const v of [undefined, '', '0', 'no', 'off', 'false']) {
    await withEnv({ NEWS_FILTER_BUDGET_LEGACY: v }, () => assert.equal(svc.isNewsFilterBudgetLegacy(), false, JSON.stringify(v)));
  }
  assert.equal(svc.NEWS_FILTER_FALLBACK_DEFAULT_MS, 30_000);
  for (const v of [undefined, '', 'abc', '-1', '0']) {
    await withEnv({ NEWS_FILTER_FALLBACK_MS: v }, () => assert.equal(svc.newsFilterFallbackMs(), 30_000, JSON.stringify(v)));
  }
  await withEnv({ NEWS_FILTER_FALLBACK_MS: '20000' }, () => assert.equal(svc.newsFilterFallbackMs(), 20_000));
});

test('A2 สูตรงบ: งบ = maxDuration−10s · Claude = min(100s, งบ − ใช้ไป − luna) · <15s = ข้าม · luna = min(เพดาน, งบที่เหลือ)', async () => {
  await withEnv({ NEWS_FILTER_FALLBACK_MS: undefined }, () => {
    const T = 5_000_000;
    const b = svc.newsFilterBudget(T, 180);
    assert.deepEqual(b, { startedAt: T, totalMs: 170_000 });
    const at = (ms) => svc.planNewsFilterBudget(b, T + ms);
    assert.deepEqual([at(0).claudeMs, at(0).lunaMs], [100_000, 30_000], 'ไม่มีคิว: Claude 100s เต็ม');
    assert.deepEqual([at(40_800).claudeMs, at(40_800).lunaMs], [99_200, 30_000], 'รอคิว 40.8s: Claude 99.2s');
    assert.deepEqual([at(125_000).claudeMs, at(125_000).lunaMs], [15_000, 30_000], 'เหลือพอดีขั้นต่ำ 15s');
    assert.deepEqual([at(130_000).claudeMs, at(130_000).lunaMs], [0, 30_000], 'เหลือ 40s: Claude ไม่พอ → luna ทันที');
    assert.deepEqual([at(160_000).claudeMs, at(160_000).lunaMs], [0, 10_000], 'luna ไม่เกินงบที่เหลือ');
    assert.deepEqual([at(175_000).claudeMs, at(175_000).lunaMs], [0, 0], 'งบหมด');
  });
  await withEnv({ NEWS_FILTER_FALLBACK_MS: '45000' }, () => {
    const p = svc.planNewsFilterBudget(svc.newsFilterBudget(0, 180), 40_800);
    assert.equal(p.claudeMs, 84_200, 'เพดาน luna มากขึ้น → Claude ได้น้อยลง');
    assert.equal(p.lunaMs, 45_000);
  });
});

// ═══ B) ค่าเริ่มต้น — route จริง + นาฬิกาเสมือน ═══
test('B1 คิวเต็ม (รอ 40.8s) + Claude ค้าง + luna ค้าง → ตอบที่ 170.0s (≤ งบ 170s < maxDuration 180) ด้วย regex สำรอง · ยกเลิก HTTP จริงทั้งคู่', async (t) => {
  const box = await virtualCase(t, {}, async (timers) => {
    fillQueue(3);
    plan = { claude: { mode: 'hang' }, luna: { mode: 'hang' } };
    const b = capture(postFilter({ text: NEWS, useAI: true, save: false }));
    await advance(timers, 170_000);
    return b;
  });
  await settleWithin(box.done, 'B1 route ไม่คืนผล');
  assert.equal(box.state, 'resolved', `route ต้องตอบก่อนหมดงบ (ได้ ${box.error?.message})`);
  assert.ok(box.at <= 170_000, `ตอบที่ ${box.at}ms ต้อง ≤ 170000 (maxDuration 180 − 10)`);
  assert.equal(box.at, 170_000);
  assert.equal(box.value.status, 200);
  assert.equal(box.value.body.success, true);
  assert.equal(box.value.body.data.engine, 'rule-based/fallback', 'ได้ผล regex สำรองแทนการโดน Vercel ตัด');
  const [claude] = byKind('claude');
  const [luna] = byKind('luna');
  assert.equal(claude.at, 40_800, 'Claude เริ่มหลังรอคิว 40.8s');
  assert.equal(claude.abortedAt, 140_000, 'Claude ถูกตัดที่ 99.2s (= 170 − 40.8 − 30)');
  assert.equal(luna.at, 140_000);
  assert.ok(luna.signal instanceof AbortSignal, 'luna ต้องได้ signal (ยกเลิก HTTP จริงได้)');
  assert.equal(luna.abortedAt, 170_000, 'luna ถูกยกเลิกจริงที่เพดาน 30s');
  assert.deepEqual(stores.get('news-filter-queue').map((j) => j.id), ['busy-0', 'busy-1', 'busy-2'], 'งานนี้ต้องออกจากคิว (finally เดิม)');
});

test('B2 คิวเต็ม + Claude ค้าง + luna ตอบใน 20s → ผล luna ที่ 160s', async (t) => {
  const box = await virtualCase(t, {}, async (timers) => {
    fillQueue(3);
    plan = { claude: { mode: 'hang' }, luna: { mode: 'ok', after: 20_000 } };
    const b = capture(postFilter({ text: NEWS, useAI: true, save: false }));
    await advance(timers, 170_000);
    return b;
  });
  await settleWithin(box.done, 'B2 route ไม่คืนผล');
  assert.equal(box.state, 'resolved');
  assert.equal(box.at, 160_000);
  assert.equal(box.value.body.data.engine, 'fact-core/gpt-5.6-luna');
  assert.match(box.value.body.data.cleanText, /สน\.บางนา/u);
});

test('B3 ไม่มีคิว + Claude ตอบใน 45s → ผล Claude (ไม่แตะ luna) · signal ของ Claude ไม่ถูกยกเลิกย้อนหลัง', async (t) => {
  const box = await virtualCase(t, {}, async (timers) => {
    plan = { claude: { mode: 'ok', after: 45_000 }, luna: { mode: 'ok', after: 0 } };
    const b = capture(postFilter({ text: NEWS, useAI: true, save: false }));
    await advance(timers, 200_000);
    return b;
  });
  await settleWithin(box.done, 'B3 route ไม่คืนผล');
  assert.equal(box.at, 45_000);
  assert.equal(box.value.body.data.engine, 'fact-core/claude-opus-5-5');
  assert.equal(byKind('luna').length, 0);
  assert.equal(byKind('claude')[0].abortedAt, null, 'timer เพดาน Claude ต้องถูกเก็บหลังได้ผล');
  assert.equal(byKind('claude')[0].args.maxRetries, 1, 'args Claude เดิม (maxRetries 1)');
  assert.equal(byKind('claude')[0].args.maxTokens, 6000, 'args Claude เดิม (max(3000, 6000))');
});

test('B4 classify (useAI=classify) คิวเต็ม + Claude ค้าง + luna ค้าง → ตอบทันงบ 170s (regex)', async (t) => {
  const box = await virtualCase(t, {}, async (timers) => {
    fillQueue(3);
    plan = { claude: { mode: 'hang' }, luna: { mode: 'hang' } };
    const b = capture(postFilter({ text: NEWS, useAI: 'classify', save: false }));
    await advance(timers, 170_000);
    return b;
  });
  await settleWithin(box.done, 'B4 route ไม่คืนผล');
  assert.equal(box.state, 'resolved');
  assert.equal(box.at, 170_000);
  assert.equal(box.value.body.success, true);
});

test('B5 split: Claude ค้าง + luna ค้าง → ตอบที่ 130s (100 + 30) engine failed เดิม · luna ถูกยกเลิกจริง', async (t) => {
  const box = await virtualCase(t, {}, async (timers) => {
    plan = { claude: { mode: 'hang' }, luna: { mode: 'hang' } };
    const b = capture(postSplit(NEWS));
    await advance(timers, 170_000);
    return b;
  });
  await settleWithin(box.done, 'B5 split ไม่คืนผล');
  assert.equal(box.state, 'resolved');
  assert.equal(box.at, 130_000);
  assert.equal(box.value.body.success, true);
  assert.equal(box.value.body.data.engine, 'failed');
  assert.equal(byKind('luna')[0].abortedAt, 130_000);
});

test('B6 งบเหลือน้อย (ใช้ไปแล้ว 130s) → ไม่เรียก Claude · luna ทันทีพร้อมเพดาน 30s · งบหมด → regex ทันทีไม่เรียก AI', async (t) => {
  const boxes = await virtualCase(t, {}, async (timers) => {
    plan = { claude: { mode: 'ok', after: 0 }, luna: { mode: 'ok', after: 5_000 } };
    const low = capture(svc.extractFactCore(NEWS, { budget: { startedAt: Date.now() - 130_000, totalMs: 170_000 } }));
    await advance(timers, 5_000);
    const gone = capture(svc.extractFactCore(NEWS, { budget: { startedAt: Date.now() - 175_000, totalMs: 170_000 } }));
    await flush();
    return { low, gone };
  });
  // รอผลหลังคืน timer จริง (settleWithin ใช้ timer จริงที่ ref) — ทั้งสองงานต้องจบแล้วในนาฬิกาเสมือน
  const low = await settleWithin(boxes.low.done, 'B6 extractFactCore (งบน้อย) ไม่คืนผล');
  const gone = await settleWithin(boxes.gone.done, 'B6 extractFactCore (งบหมด) ไม่คืนผล');
  assert.equal(low.value.engine, 'fact-core/gpt-5.6-luna');
  assert.equal(low.at, 5_000, 'luna ตอบใน 5s');
  assert.equal(gone.value.engine, 'rule-based/fallback', 'งบหมด → regex สำรองทันที');
  assert.equal(gone.at, 5_000, 'งบหมด → จบทันที (ไม่รอ AI)');
  assert.deepEqual(calls.map((c) => [c.kind, c.at]), [['luna', 0]], 'งบน้อย: ไม่เริ่ม Claude (เสียเงินฟรี) luna เริ่มทันที · งบหมด: ไม่เรียก AI เลย');
});

// ═══ C) โหมดถอย NEWS_FILTER_BUDGET_LEGACY=1 — เดิมทุกไบต์ (ทำซ้ำบั๊ก) ═══
test('C1 โหมดถอย: คิวเต็ม + Claude ค้าง + luna ค้าง → 180s ยังไม่ตอบ (Vercel ตัด) · Claude ตัดที่ 100s คงที่ · luna ไม่มี signal · args เดิม', async (t) => {
  const box = await virtualCase(t, { NEWS_FILTER_BUDGET_LEGACY: '1' }, async (timers) => {
    fillQueue(3);
    plan = { claude: { mode: 'hang' }, luna: { mode: 'hang' } };
    const b = capture(postFilter({ text: NEWS, useAI: true, save: false }));
    await advance(timers, 180_000);
    return b;
  });
  assert.equal(box.state, 'pending', 'โหมดถอย: เกิน maxDuration 180 แล้วยังไม่ตอบ = บั๊กเดิม');
  const [claude] = byKind('claude');
  const [luna] = byKind('luna');
  assert.equal(claude.at, 40_800);
  assert.equal(claude.abortedAt, 140_800, 'โหมดถอย: Claude 100s คงที่ ไม่หักเวลารอคิว');
  assert.deepEqual(claude.keys, ['prompt', 'systemPrompt', 'model', 'temperature', 'maxTokens', 'effort', 'signal', 'maxRetries'], 'args Claude เดิมทุกตัว');
  assert.equal(luna.at, 140_800);
  assert.deepEqual(luna.keys, ['prompt', 'model', 'temperature', 'maxTokens'], 'โหมดถอย: callAI args เดิม (ไม่มี signal)');
  // route ปลอมค้างถาวร (luna ปลอมไม่มี timer/handle) — ไม่ await
});

test('C2 โหมดถอย: คิวเต็ม + Claude ค้าง + luna ตอบใน 60s → ตอบที่ 200.8s (เกิน maxDuration 180 = บั๊กเดิมที่ผู้ตรวจวัดได้)', async (t) => {
  const box = await virtualCase(t, { NEWS_FILTER_BUDGET_LEGACY: 'legacy' }, async (timers) => {
    fillQueue(3);
    plan = { claude: { mode: 'hang' }, luna: { mode: 'ok', after: 60_000 } };
    const b = capture(postFilter({ text: NEWS, useAI: true, save: false }));
    await advance(timers, 201_000);
    return b;
  });
  await settleWithin(box.done, 'C2 route ไม่คืนผล');
  assert.equal(box.at, 200_800);
  assert.ok(box.at > 180_000, 'โหมดถอย: เกิน maxDuration');
  assert.equal(box.value.body.data.engine, 'fact-core/gpt-5.6-luna');
});

test('C3 โหมดถอย split: Claude ค้าง + luna ค้าง → 180s ยังไม่ตอบ · luna ไม่มี signal', async (t) => {
  const box = await virtualCase(t, { NEWS_FILTER_BUDGET_LEGACY: 'true' }, async (timers) => {
    plan = { claude: { mode: 'hang' }, luna: { mode: 'hang' } };
    const b = capture(postSplit(NEWS));
    await advance(timers, 180_000);
    return b;
  });
  assert.equal(box.state, 'pending');
  assert.equal(byKind('claude')[0].abortedAt, 100_000);
  assert.deepEqual(byKind('luna')[0].keys, ['prompt', 'model', 'temperature', 'maxTokens']);
});
