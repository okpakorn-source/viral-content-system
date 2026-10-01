// ============================================================
// 🧪 tests/research-agent-tools.test.mjs — เข็มขัดเครื่องมือ + บัญชี/โควตา + สมองสำรอง API (SPEC-v2 ส่วน 4 · 5 · 8)
// ★ 1 ต.ค. 69 (research agent v2 เลน A) — ไม่ยิงเน็ตจริง: fetch ปลอมทุกข้อ · service เดิมฉีดตัวปลอม
// ตรวจ: argv/--input · คีย์อ่านเฉพาะชื่อที่ขอจาก .env.local · คีย์ไม่อยู่ใน URL/ผล · fallback ของ fetch-page/wiki/youtube-meta ·
//       preset ของ apify · ถอดคลิปผ่าน service เดิม · โควตาฟรี (wham/usage) + เลือก/สลับบัญชี · เขียน .env.local ไม่ทำลายบรรทัดอื่น ·
//       โหมด API: tool_log + ค่าเงินจากโทเคน + ปิดคีย์ใน error · exit code ของ CLI (2 = ใช้ผิด)
// กลายพันธุ์ 4 แบบ (_common ensureKeys · apify token ใน URL · accounts สลับบัญชี · apiFallback ปิดคีย์)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importPatchedModule } from './helpers/temp-module.mjs';
import * as common from '../scripts/research-tools/_common.mjs';
import * as serper from '../scripts/research-tools/serper.mjs';
import * as fetchPage from '../scripts/research-tools/fetch-page.mjs';
import * as apify from '../scripts/research-tools/apify.mjs';
import * as webAgent from '../scripts/research-tools/web-agent.mjs';
import * as transcribe from '../scripts/research-tools/transcribe.mjs';
import * as geminiVideo from '../scripts/research-tools/gemini-video.mjs';
import * as ytMeta from '../scripts/research-tools/youtube-meta.mjs';
import * as ocr from '../scripts/research-tools/ocr.mjs';
import * as reverseImage from '../scripts/research-tools/reverse-image.mjs';
import * as wiki from '../scripts/research-tools/wiki.mjs';
import * as rss from '../scripts/research-tools/rss-news.mjs';
import * as quotaTool from '../scripts/research-tools/quota.mjs';
import * as accounts from '../scripts/research-agent/accounts.mjs';
import * as api from '../scripts/research-agent/apiFallback.mjs';
import { buildChildEnv } from '../scripts/research-agent/codexRunner.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const url = (rel) => new URL(`../${rel}`, import.meta.url);
const src = (rel) => readFileSync(url(rel), 'utf8');
/** โหลดสำเนา patch (ซอร์สที่มี import.meta.url → แทนด้วย URL จริงก่อน เพราะย้ายโฟลเดอร์แล้วจะชี้ผิดที่) */
async function mutantOf(rel, find, replace, name) {
  const s = src(rel);
  assert.ok(s.includes(find), `ไม่พบจุดกลายพันธุ์ ${name}`);
  const patched = s.replace(find, replace).split('import.meta.url').join(JSON.stringify(url(rel).href));
  return importPatchedModule(patched, url(rel), `ra-tools-${name}`);
}

/** fetch ปลอม: routes = [{match: RegExp|fn, status, json|text, headers}] · เก็บทุกคำขอ */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (u, init = {}) => {
    calls.push({ url: String(u), init });
    const r = routes.find((x) => (typeof x.match === 'function' ? x.match(String(u), init) : x.match.test(String(u))));
    if (!r) throw new Error(`no route ${u}`);
    if (r.throws) throw r.throws;
    const body = r.json !== undefined ? JSON.stringify(r.json) : (r.text || '');
    const status = r.status || 200;
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => JSON.parse(body), text: async () => body,
      arrayBuffer: async () => Buffer.from(body),
      headers: { get: (k) => (r.headers || {})[String(k).toLowerCase()] || null },
    };
  };
  return { impl, calls };
}
function tempRoot(envText = '') {
  const dir = mkdtempSync(join(tmpdir(), 'ra-tools-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  if (envText) writeFileSync(join(dir, '.env.local'), envText);
  return dir;
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (claims) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;

// ── ข้อตรวจที่ใช้ซ้ำ ──
function checkEnsureKeysOnlyNamed(c) {
  const root = tempRoot('SERPER_API_KEY=serper-from-file-123\nSUPABASE_SERVICE_ROLE_KEY=svc-should-not-load\nOPENAI_API_KEY="sk-file-0123456789"\n');
  try {
    const env = { RESEARCH_TOOLS_REPO_ROOT: root };
    const missing = c.ensureKeys(['SERPER_API_KEY', 'GEMINI_API_KEY'], { env });
    assert.deepEqual(missing, ['GEMINI_API_KEY']);
    assert.equal(env.SERPER_API_KEY, 'serper-from-file-123');
    assert.ok(!('SUPABASE_SERVICE_ROLE_KEY' in env), 'ห้ามยกทั้งไฟล์เข้า env');
    assert.ok(!('OPENAI_API_KEY' in env));
    const env2 = { RESEARCH_TOOLS_REPO_ROOT: root, SERPER_API_KEY: 'already' };
    c.ensureKeys(['SERPER_API_KEY'], { env: env2 });
    assert.equal(env2.SERPER_API_KEY, 'already', 'ค่าใน env ชนะไฟล์');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
async function checkApifyTokenInHeader(mod) {
  const f = fakeFetch([{ match: /api\.apify\.com/, json: [{ text: 'โพสต์', time: '2026-10-01T05:51:22.000Z', likes: 31 }] }]);
  const res = await mod.run(['--preset', 'facebook-posts', '--url', 'https://www.facebook.com/x/posts/1', '--limit', '3'], { fetchImpl: f.impl, env: { APIFY_API_TOKEN: 'apify_api_SECRETTOKEN123456' } });
  assert.equal(res.ok, true);
  const call = f.calls[0];
  assert.ok(!call.url.includes('SECRETTOKEN'), 'โทเคนห้ามอยู่ใน URL');
  assert.ok(!/token=/i.test(call.url));
  assert.equal(call.init.headers.Authorization, 'Bearer apify_api_SECRETTOKEN123456');
  assert.match(call.url, /acts\/apify~facebook-posts-scraper\/run-sync-get-dataset-items\?timeout=90&clean=true&limit=3$/);
  assert.deepEqual(JSON.parse(call.init.body), { startUrls: [{ url: 'https://www.facebook.com/x/posts/1' }], resultsLimit: 3 });
}
function checkChooseAccount(m) {
  const order = ['main', 'b', 'c'];
  const pick1 = m.chooseAccount(order, { main: { status: 'OK', remainingPct: 4 }, b: { status: 'OK', remainingPct: 40 } });
  assert.equal(pick1.account, 'b', 'เหลือ ≤5% ต้องข้ามไปบัญชีถัดไป');
  assert.equal(pick1.quotaLow, false);
  const pick2 = m.chooseAccount(order, { main: { status: 'OK', remainingPct: 12 } });
  assert.equal(pick2.account, 'main');
  assert.equal(pick2.quotaLow, true, '≤15% = เตือน');
  const pick3 = m.chooseAccount(['main', 'b'], { main: { status: 'FULL', remainingPct: 0 }, b: { status: 'OK', remainingPct: 5 } });
  assert.equal(pick3.useApi, true, 'ทุกบัญชี ≤5%/เต็ม → โหมด API');
  const pick4 = m.chooseAccount(['main'], { main: { status: 'TOKEN_STALE', remainingPct: null } });
  assert.equal(pick4.account, 'main', 'ไม่รู้โควตา = ใช้ได้ (ไม่เดาว่าหมด)');
  assert.equal(pick4.quotaLow, false);
}
/**
 * ทางของ OPENAI_API_KEY ถึง web-agent (ยืนยัน 1 ต.ค. 69): worker ไม่ส่งคีย์นี้ให้ Codex (buildChildEnv ตัดทิ้ง) →
 * เครื่องมือ ensureKeys อ่านเฉพาะชื่อนี้จาก <RESEARCH_TOOLS_REPO_ROOT>/.env.local เอง (ไม่ใช่คีย์ของโปรเซส worker)
 */
async function checkWebAgentKeyFromEnvLocal(wa) {
  const root = tempRoot('OPENAI_API_KEY=sk-from-env-local-0123456789\nSUPABASE_SERVICE_ROLE_KEY=svc-must-not-load\n');
  const root2 = tempRoot('SERPER_API_KEY=serper-only-0123456789\n');
  try {
    const workerEnv = { PATH: process.env.PATH || '', OPENAI_API_KEY: 'sk-worker-process-0123456789' };
    const childEnv = buildChildEnv({ baseEnv: workerEnv, repoRoot: root });
    assert.ok(!('OPENAI_API_KEY' in childEnv), 'worker ไม่ส่ง OPENAI_API_KEY ให้ Codex');
    assert.equal(childEnv.RESEARCH_TOOLS_REPO_ROOT, root);
    const f = fakeFetch([{ match: /api\.openai\.com\/v1\/responses/, json: { output: [], usage: {} } }]);
    const env = { ...childEnv };
    const r = await wa.run(['หาต้นทาง'], { fetchImpl: f.impl, env });
    assert.equal(r.ok, true, `ต้องหาคีย์เจอจาก .env.local: ${r.error || ''}`);
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer sk-from-env-local-0123456789', 'คีย์มาจาก .env.local ของ repo ไม่ใช่ของโปรเซส worker');
    assert.ok(!('SUPABASE_SERVICE_ROLE_KEY' in env), 'อ่านเฉพาะชื่อที่ต้องใช้');
    const r2 = await wa.run(['x'], { fetchImpl: f.impl, env: buildChildEnv({ baseEnv: workerEnv, repoRoot: root2 }) });
    assert.equal(r2.errorType, 'NO_KEY', '.env.local ไม่มีคีย์ = NO_KEY (ไม่หยิบคีย์ของ worker)');
    assert.equal(f.calls.length, 1, 'ไม่มีคีย์ = ไม่ยิง');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(root2, { recursive: true, force: true });
  }
}

/** fetch ปลอมที่โหลดก่อนเครื่องมือด้วย --import (โหลดไม่ได้ = node หยุดก่อนรันเครื่องมือ → ไม่มีทางยิงเน็ตจริง) */
const STUB_FETCH_SOURCE = `import { writeFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const h = (init && init.headers) || {};
  writeFileSync(process.env.RA_STUB_FETCH_OUT, JSON.stringify({ url: String(url), auth: h.Authorization || null }));
  const body = JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1 } });
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
};
`;
/**
 * โปรเซสจริงแบบที่เอเจนต์เรียก: cwd = โฟลเดอร์งาน · tools/ = junction ไป scripts/research-tools · env = buildChildEnv
 * แล้วตัด RESEARCH_TOOLS_REPO_ROOT ทิ้ง (จำลองเชลล์ Codex ที่กรอง env) → เครื่องมือต้องหา .env.local จากตำแหน่งจริงของ
 * _common.mjs (realpath ผ่าน junction = สองชั้นเหนือ) เอง · fetch ปลอมผ่าน --import (ไม่มีเน็ตจริง)
 */
function checkWebAgentJunctionProcess(commonSource = src('scripts/research-tools/_common.mjs')) {
  const base = mkdtempSync(join(tmpdir(), 'ra-wa-proc-'));
  try {
    const repo = join(base, 'repo');
    const toolsReal = join(repo, 'scripts', 'research-tools');
    mkdirSync(toolsReal, { recursive: true });
    writeFileSync(join(repo, 'package.json'), '{}');
    writeFileSync(join(repo, '.env.local'), 'OPENAI_API_KEY=sk-junction-env-local-0123456789\n');
    writeFileSync(join(toolsReal, '_common.mjs'), commonSource);
    for (const f of ['_alias-hooks.mjs', 'web-agent.mjs']) writeFileSync(join(toolsReal, f), src(`scripts/research-tools/${f}`));
    const work = join(base, 'work', 'q_proc');
    mkdirSync(join(work, 'out'), { recursive: true });
    symlinkSync(toolsReal, join(work, 'tools'), 'junction');
    const stub = join(base, 'stub-fetch.mjs');
    const seenFile = join(base, 'seen.json');
    writeFileSync(stub, STUB_FETCH_SOURCE);
    const osEnv = Object.fromEntries(['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'HOME'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    const env = { ...buildChildEnv({ baseEnv: { ...osEnv, OPENAI_API_KEY: 'sk-worker-process-0123456789' }, repoRoot: repo }), RA_STUB_FETCH_OUT: seenFile };
    delete env.RESEARCH_TOOLS_REPO_ROOT;
    assert.ok(!('OPENAI_API_KEY' in env));
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, join('tools', 'web-agent.mjs'), 'find the origin post'], {
      cwd: work, env, encoding: 'utf8', timeout: 20_000,
    });
    const lastLine = String(r.stdout || '').trim().split(/\r?\n/).pop() || '{}';
    let out = {};
    try { out = JSON.parse(lastLine); } catch { out = {}; }
    assert.equal(out.ok, true, `web-agent ผ่าน junction ต้องหาคีย์จาก .env.local เอง (exit ${r.status}): ${lastLine.slice(0, 200)} ${String(r.stderr || '').slice(0, 200)}`);
    const seen = JSON.parse(readFileSync(seenFile, 'utf8'));
    assert.match(seen.url, /^https:\/\/api\.openai\.com\/v1\/responses$/);
    assert.equal(seen.auth, 'Bearer sk-junction-env-local-0123456789');
  } finally { rmSync(base, { recursive: true, force: true }); }
}
async function checkApiRedaction(mod) {
  const key = 'sk-proj-REALKEYVALUE0123456789';
  const f = fakeFetch([{ match: /api\.openai\.com/, throws: new Error(`connect failed for key ${key}`) }]);
  const r = await mod.runApiFallback({ prompt: 'x', apiKey: key, timeoutMs: 30_000 }, { fetchImpl: f.impl });
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes(key), 'คีย์รั่วในข้อความ error');
  assert.match(r.error, /\[REDACTED\]/);
}

test('1. parseArgs: ตำแหน่ง/ธง/ตัวเลือก/ซ้ำได้ · --input JSON (ไทย) · ตัวเลือกไม่รู้จัก = UsageError', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-args-'));
  try {
    writeFileSync(join(dir, 'q.json'), '\uFEFF{"q":"ขาเทียม ราชบุรี","num":5}', 'utf8');
    const a = common.parseArgs(['--news', 'x', '--num', '3', '--input', join(dir, 'q.json')], { flags: ['news'], options: ['num', 'q'] });
    assert.equal(a.news, true);
    assert.deepEqual(a._, ['x']);
    assert.equal(a.q, 'ขาเทียม ราชบุรี');
    assert.equal(a.num, 5, '--input มาทีหลังทับค่า');
    const b = common.parseArgs(['--image', 'a.png', '--image', 'b.png'], { multi: ['image'] });
    assert.deepEqual(b.image, ['a.png', 'b.png']);
    assert.throws(() => common.parseArgs(['--nope'], {}), common.UsageError);
    assert.throws(() => common.parseArgs(['--num'], { options: ['num'] }), common.UsageError);
    writeFileSync(join(dir, 'bad.json'), '{oops', 'utf8');
    assert.throws(() => common.parseArgs(['--input', join(dir, 'bad.json')], {}), common.UsageError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('2. ensureKeys อ่านเฉพาะชื่อที่ขอจาก .env.local ของ repo (ไม่ยกทั้งไฟล์) · ค่าใน env ชนะ', () => checkEnsureKeysOnlyNamed(common));

test('2b. รากโปรเจกต์: env → ไฟล์ .repo-root ข้างเครื่องมือ (โหมดสำเนา) → สองชั้นเหนือไฟล์', async () => {
  const root = tempRoot('SERPER_API_KEY=from-marker-root-123\n');
  const copyDir = mkdtempSync(join(tmpdir(), 'ra-copy-'));
  try {
    assert.equal(common.repoRoot({ RESEARCH_TOOLS_REPO_ROOT: root }), root);
    assert.equal(common.repoRoot({ RESEARCH_TOOLS_REPO_ROOT: join(root, 'ไม่มีจริง') }), ROOT.replace(/[\\/]+$/, ''), 'env ชี้ที่ไม่มี package.json = ไม่เชื่อ');
    // สำเนา _common.mjs ไว้นอก repo + ไฟล์ .repo-root → ต้องหาราก + .env.local ได้แม้ไม่มี env
    writeFileSync(join(copyDir, '_common.mjs'), src('scripts/research-tools/_common.mjs'));
    writeFileSync(join(copyDir, '_alias-hooks.mjs'), src('scripts/research-tools/_alias-hooks.mjs'));
    writeFileSync(join(copyDir, common.REPO_ROOT_MARKER), root);
    const copied = await import(pathToFileURL(join(copyDir, '_common.mjs')).href);
    assert.equal(copied.repoRoot({}), root);
    const env = {};
    copied.ensureKeys(['SERPER_API_KEY'], { env });
    assert.equal(env.SERPER_API_KEY, 'from-marker-root-123');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(copyDir, { recursive: true, force: true });
  }
});

test('3. redact ปิดค่าคีย์ที่โหลด + รูปแบบโทเคนทั่วไป', () => {
  const root = tempRoot('SERPER_API_KEY=serper-secret-value-999\n');
  try {
    common.ensureKeys(['SERPER_API_KEY'], { env: { RESEARCH_TOOLS_REPO_ROOT: root } });
    const s = common.redact('failed serper-secret-value-999 url?token=abcdefghijk&x=1 Bearer abcdefghijklmnopqrstuv');
    assert.ok(!s.includes('serper-secret-value-999'));
    assert.ok(!s.includes('abcdefghijk&'));
    assert.ok(!s.includes('abcdefghijklmnopqrstuv'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('4. serper: ประเภท/ช่วงเวลา → endpoint + body ถูก · คีย์ทาง header · แปลงผล', async () => {
  const f = fakeFetch([{ match: /google\.serper\.dev\/news/, json: { news: [{ title: 'ข่าว', snippet: 's', link: 'https://a.com/1', source: 'A', date: '1 วันที่แล้ว' }] } }]);
  const r = await serper.run(['ขาเทียม ราชบุรี', '--news', '--num', '5', '--tbs', 'qdr:m'], { fetchImpl: f.impl, env: { SERPER_API_KEY: 'k-1234567890' } });
  assert.equal(r.ok, true);
  assert.equal(r.type, 'news');
  assert.deepEqual(r.results[0], { title: 'ข่าว', snippet: 's', link: 'https://a.com/1', source: 'A', date: '1 วันที่แล้ว' });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { q: 'ขาเทียม ราชบุรี', gl: 'th', hl: 'th', num: 5, tbs: 'qdr:m' });
  assert.equal(f.calls[0].init.headers['X-API-KEY'], 'k-1234567890');
  await assert.rejects(() => serper.run([], { fetchImpl: f.impl, env: {} }), common.UsageError);
  await assert.rejects(() => serper.run(['x', '--tbs', 'bad;rm'], { fetchImpl: f.impl, env: {} }), common.UsageError);
  const root = tempRoot('');
  try {
    const nokey = await serper.run(['x'], { fetchImpl: f.impl, env: { RESEARCH_TOOLS_REPO_ROOT: root } });
    assert.equal(nokey.errorType, 'NO_KEY');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('5. fetch-page: ไม่มีคีย์ Firecrawl → Jina ล้ม → ตรง (ได้ published จาก meta) · ถอดแท็ก', async () => {
  const html = '<html><head><title>ข่าว &amp; เรื่อง</title><meta property="article:published_time" content="2026-09-30T08:00:00+07:00"></head><body><script>x()</script><p>ชาวสวีเดนสวมขาเทียมช่วยกรอกกระสอบทรายที่เขื่อนเทศบาลเมืองราชบุรี ตั้งแต่เช้าจนค่ำ</p></body></html>';
  const root = tempRoot('');
  try {
    const f = fakeFetch([
      { match: /r\.jina\.ai/, status: 500, text: 'err' },
      { match: /example\.com/, text: html },
    ]);
    const r = await fetchPage.run(['https://example.com/news/1'], { fetchImpl: f.impl, env: { RESEARCH_TOOLS_REPO_ROOT: root } });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'direct');
    assert.equal(r.published, '2026-09-30T08:00:00+07:00');
    assert.equal(r.title, 'ข่าว & เรื่อง');
    assert.ok(!r.text.includes('x()'));
    assert.deepEqual(r.tried, ['ไม่มีคีย์ Firecrawl', 'jina 500']);
    assert.equal(fetchPage.publishedFromHtml('<script type="application/ld+json">{"datePublished":"2026-01-02"}</script>'), '2026-01-02');
    await assert.rejects(() => fetchPage.run(['ไม่ใช่ลิงก์'], { fetchImpl: f.impl, env: {} }), common.UsageError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('6. apify: preset → actor/input · โทเคนทาง header ไม่อยู่ใน URL · actor/input ผิดรูป = UsageError', async () => {
  await checkApifyTokenInHeader(apify);
  assert.deepEqual(apify.resolveRequest({ _: [], preset: 'facebook-search', q: 'ขาเทียม ราชบุรี', limit: '5' }).input, { searchQueries: ['ขาเทียม ราชบุรี'], resultsLimit: 5 });
  assert.equal(apify.resolveRequest({ _: [], actor: 'apify/website-content-crawler', input: { startUrls: [] } }).actor, 'apify~website-content-crawler');
  assert.throws(() => apify.resolveRequest({ _: [], preset: 'facebook-posts' }), common.UsageError);
  assert.throws(() => apify.resolveRequest({ _: ['../../etc'], input: {} }), common.UsageError);
  assert.throws(() => apify.resolveRequest({ _: ['apify~x', '{bad'] }), common.UsageError);
});

test('7. web-agent: Responses API gpt-6-astra low + web_search · นับการค้น/อ้างอิง', async () => {
  const f = fakeFetch([{ match: /api\.openai\.com\/v1\/responses/, json: {
    output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', content: [{ type: 'output_text', text: 'ไม่พบ', annotations: [{ type: 'url_citation', url: 'https://a.com' }] }] }],
    usage: { input_tokens: 100, output_tokens: 20 },
  } }]);
  const r = await webAgent.run(['หาต้นทาง'], { fetchImpl: f.impl, env: { OPENAI_API_KEY: 'sk-test-0123456789abcdef' } });
  assert.equal(r.ok, true);
  assert.equal(r.searches, 1);
  assert.deepEqual(r.cites, ['https://a.com']);
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.model, 'gpt-6-astra');
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.deepEqual(body.tools, [{ type: 'web_search' }]);
});

test('7b. web-agent ได้ OPENAI_API_KEY จาก .env.local ของ repo เอง — env ลูกที่ worker สร้างไม่มีคีย์นี้ (กัน Codex คิดเงินแบบ API)', () => checkWebAgentKeyFromEnvLocal(webAgent));

test('7c. โปรเซสจริงผ่าน junction (แบบที่เอเจนต์เรียก) + เชลล์กรอง RESEARCH_TOOLS_REPO_ROOT ทิ้ง → ยังหา .env.local เจอจากตำแหน่งจริงของเครื่องมือ (fetch ปลอม ไม่มีเน็ต)', () => {
  checkWebAgentJunctionProcess();
});

test('8. transcribe / gemini-video: แยกแพลตฟอร์ม · เรียก service เดิมด้วยลิงก์ · ตัดความยาว', async () => {
  assert.equal(transcribe.detectPlatform('https://youtu.be/abcdefghijk'), 'youtube');
  assert.equal(transcribe.detectPlatform('https://www.tiktok.com/@a/video/1'), 'tiktok');
  assert.equal(transcribe.detectPlatform('https://www.facebook.com/reel/1'), 'meta');
  assert.equal(transcribe.detectPlatform('https://www.instagram.com/reel/x'), 'meta');
  assert.equal(transcribe.detectPlatform('https://example.com/x'), null);
  const root = tempRoot('');
  try {
    const got = [];
    const chdirs = [];
    const r = await transcribe.run(['--url', 'https://www.tiktok.com/@a/video/1', '--max', '1000'], {
      env: { RESEARCH_TOOLS_REPO_ROOT: root }, chdir: (d) => chdirs.push(d),
      loadService: async (rel) => ({ transcribeTiktok: async (a) => { got.push([rel, a]); return { success: true, text: 'ก'.repeat(3000), title: 't', duration: 61 }; } }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.platform, 'tiktok');
    assert.equal(r.text.length, 1000);
    assert.equal(r.chars, 3000);
    assert.deepEqual(got, [['src/lib/services/tiktokService.js', { url: 'https://www.tiktok.com/@a/video/1' }]]);
    assert.deepEqual(chdirs, [root], 'service เดิมหา bin/yt-dlp.exe จาก cwd = ราก repo');
    const gv = [];
    const g = await geminiVideo.run(['--url', 'https://www.youtube.com/watch?v=abcdefghijk', '--question', 'ใครพูด', '--start', '10', '--end', '70'], {
      env: { RESEARCH_TOOLS_REPO_ROOT: root, GEMINI_API_KEY: 'g-key-0123456789' },
      loadService: async () => ({ callClipGeminiVideo: async (o) => { gv.push(o); return { ok: true, data: { summary: 's' }, receipt: { model: 'm', elapsedMs: 5 } }; } }),
    });
    assert.equal(g.ok, true);
    assert.equal(gv[0].youtubeUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.deepEqual(gv[0].videoRange, [10, 70]);
    assert.match(gv[0].prompt, /คำถาม: ใครพูด/);
    const notYt = await geminiVideo.run(['--url', 'https://www.tiktok.com/@a/video/1'], { env: { RESEARCH_TOOLS_REPO_ROOT: root } });
    assert.equal(notYt.errorType, 'UNSUPPORTED');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('9. youtube-meta: id หลายรูป · Data API (คีย์ทาง header) · ไม่มีคีย์ = oEmbed', async () => {
  for (const u of ['https://www.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk', 'https://www.youtube.com/shorts/abcdefghijk', 'abcdefghijk']) {
    assert.equal(ytMeta.youtubeId(u), 'abcdefghijk', u);
  }
  assert.equal(ytMeta.youtubeId('https://example.com'), null);
  const f = fakeFetch([{ match: /googleapis\.com\/youtube\/v3\/videos/, json: { items: [{ snippet: { title: 'T', channelTitle: 'C', publishedAt: '2024-01-01T00:00:00Z', tags: ['a'] }, statistics: { viewCount: '10' }, contentDetails: { duration: 'PT1M' } }] } }]);
  const r = await ytMeta.run(['--url', 'https://youtu.be/abcdefghijk'], { fetchImpl: f.impl, env: { YOUTUBE_API_KEY: 'yt-key-0123456789' } });
  assert.equal(r.publishedAt, '2024-01-01T00:00:00Z');
  assert.equal(r.views, 10);
  assert.ok(!f.calls[0].url.includes('yt-key-0123456789'), 'คีย์ห้ามอยู่ใน URL');
  assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'yt-key-0123456789');
  const root = tempRoot('');
  try {
    const o = fakeFetch([{ match: /youtube\.com\/oembed/, json: { title: 'OT', author_name: 'OC' } }]);
    const r2 = await ytMeta.run(['abcdefghijk'], { fetchImpl: o.impl, env: { RESEARCH_TOOLS_REPO_ROOT: root } });
    assert.equal(r2.via, 'oembed');
    assert.equal(r2.title, 'OT');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('10. wiki ไทยไม่พบ → อังกฤษ · rss-news/reverse-image/ocr เรียก service เดิมผ่านตัวฉีด', async () => {
  const f = fakeFetch([
    { match: /th\.wikipedia\.org\/w\/api\.php/, json: ['q', [], [], []] },
    { match: /en\.wikipedia\.org\/w\/api\.php/, json: ['q', ['Ratchaburi'], [], []] },
    { match: /en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Ratchaburi/, json: { title: 'Ratchaburi', extract: 'A town in Thailand.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ratchaburi' } } } },
  ]);
  const w = await wiki.run(['ราชบุรี'], { fetchImpl: f.impl });
  assert.equal(w.ok, true);
  assert.equal(w.lang, 'en');
  assert.match(f.calls[0].init.headers['User-Agent'], /ResearchAgent/);
  const root = tempRoot('');
  try {
    const rr = await rss.run(['ขาเทียม'], { env: { RESEARCH_TOOLS_REPO_ROOT: root }, loadService: async () => ({ searchRSS: async (k, o) => [{ title: `ข่าว ${k}`, url: 'https://a.com', publishedAt: '2026-10-01', source: 'rss-ไทยรัฐ', summary: 'x', max: o.maxPerFeed }] }) });
    assert.equal(rr.count, 1);
    assert.equal(rr.articles[0].title, 'ข่าว ขาเทียม');
    const ri = await reverseImage.run(['--image-url', 'https://a.com/i.jpg'], { env: { RESEARCH_TOOLS_REPO_ROOT: root, SERPAPI_KEY: 'serp-0123456789' }, loadService: async () => ({ reverseImageMulti: async () => [{ title: 'T', source: 'S', sourceLink: 'https://b.com', imageUrl: 'https://b.com/i.jpg' }] }) });
    assert.deepEqual(ri.matches[0], { title: 'T', source: 'S', link: 'https://b.com', imageUrl: 'https://b.com/i.jpg' });
    const img = join(root, 'shot.png');
    writeFileSync(img, Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    const seen = [];
    const o = await ocr.run(['--image', img], { env: { RESEARCH_TOOLS_REPO_ROOT: root }, runtime: (r) => r, loadService: async () => ({ performOcr: async (a) => { seen.push(a); return { text: 'ข้อความในภาพ', title: 'ภาพ' }; } }) });
    assert.equal(o.ok, true);
    assert.match(seen[0].dataUrls[0], /^data:image\/png;base64,/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('11. โควตา Codex (ฟรี): อ่าน auth.json → wham/usage · % เหลือจากหน้าต่างที่ใช้มากสุด · ไม่คืนโทเคน', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ra-home-'));
  try {
    mkdirSync(join(home, '.codex-b'), { recursive: true });
    const access = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1', chatgpt_plan_type: 'pro' } });
    writeFileSync(join(home, '.codex-b', 'auth.json'), JSON.stringify({ tokens: { access_token: access, id_token: fakeJwt({ email: 'b@example.com' }) } }));
    const f = fakeFetch([{ match: /chatgpt\.com\/backend-api\/wham\/usage/, json: { rate_limit: { primary_window: { used_percent: 30, reset_at: 1790000000 }, secondary_window: { used_percent: 88, reset_at: 1790500000 } } } }]);
    const q = await accounts.readQuota('b', { homeDir: home, fetchImpl: f.impl });
    assert.equal(q.status, 'OK');
    assert.equal(q.usedPct, 88);
    assert.equal(q.remainingPct, 12);
    assert.equal(q.resetAt, new Date(1790500000 * 1000).toISOString());
    assert.equal(f.calls[0].init.headers['chatgpt-account-id'], 'acc-1');
    assert.ok(!JSON.stringify(q).includes(access), 'ห้ามคืนโทเคน');
    const missing = await accounts.readQuota('zz', { homeDir: home, fetchImpl: f.impl });
    assert.equal(missing.status, 'LOGGED_OUT');
    const stale = await accounts.readQuota('b', { homeDir: home, fetchImpl: fakeFetch([{ match: /wham/, status: 401, json: {} }]).impl });
    assert.equal(stale.status, 'TOKEN_STALE');
    const full = await accounts.readQuota('b', { homeDir: home, fetchImpl: fakeFetch([{ match: /wham/, json: { rate_limit: { limit_reached: true, primary_window: { used_percent: 100 } } } }]).impl });
    assert.equal(full.status, 'FULL');
    const tool = await quotaTool.run([], { env: { CODEX_HOME: join(home, '.codex-b') }, fetchImpl: f.impl, loadAccounts: async () => accounts });
    assert.equal(tool.account, 'b');
    assert.equal(tool.remainingPct, 12);
    assert.ok(!('email' in tool), 'เครื่องมือของเอเจนต์ไม่คืนอีเมล');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('12. ลำดับบัญชี/เลือกบัญชี (≤5% สลับ · ≤15% เตือน · หมด = API) · เขียน .env.local ไม่ทำลายบรรทัดอื่น', () => {
  assert.deepEqual(accounts.accountOrder({}), ['main']);
  assert.deepEqual(accounts.accountOrder({ CODEX_ACCOUNT: 'b' }), ['b']);
  assert.deepEqual(accounts.accountOrder({ RESEARCH_AGENT_CODEX_ACCOUNTS: 'b, main,b,bad-name,c', CODEX_ACCOUNT: 'x' }), ['b', 'main', 'c']);
  checkChooseAccount(accounts);
  const text = 'A=1\r\nRESEARCH_AGENT_CODEX_ACCOUNTS=main\r\nB="x y"\r\n';
  assert.equal(accounts.upsertEnvLine(text, 'RESEARCH_AGENT_CODEX_ACCOUNTS', 'b,main'), 'A=1\r\nRESEARCH_AGENT_CODEX_ACCOUNTS=b,main\r\nB="x y"\r\n');
  assert.equal(accounts.upsertEnvLine('A=1\n', 'K', 'v'), 'A=1\nK=v\n');
  assert.equal(accounts.upsertEnvLine('', 'K', 'v'), 'K=v\n');
  assert.deepEqual(accounts.orderForUse('b', ['main', 'b', 'c']), ['b', 'main', 'c']);
  assert.throws(() => accounts.orderForUse('b;del', ['main']));
  assert.equal(accounts.isValidAccountName('main'), true);
  assert.equal(accounts.isValidAccountName('b-x'), false);
  const table = accounts.formatQuotaTable([{ account: 'main', usedPct: 10, remainingPct: 90, status: 'OK', resetAt: null, email: null, note: '' }], ['main']);
  assert.match(table, /main\s+1\s+10%\s+90%\s+OK/);
});

test('13. สมองสำรอง API: body ตามสเปก · tool_log api-fallback + web_search · ค่าเงินจากโทเคน · 429 = API_QUOTA · ไม่มีคีย์ = API_NO_KEY', async () => {
  assert.deepEqual(api.buildApiRequest({ prompt: 'p' }), { model: 'gpt-6-astra', reasoning: { effort: 'low' }, tools: [{ type: 'web_search' }], input: 'p', max_output_tokens: 12000 });
  const answer = JSON.stringify({ plan: [], origin_post: { url: null }, cards: [], tool_log: [{ tool: 'api-fallback', args: 'ซ้ำ' }, { tool: 'note', args: 'x' }] });
  const f = fakeFetch([{ match: /api\.openai\.com\/v1\/responses/, json: {
    output: [
      { type: 'web_search_call', status: 'completed', action: { query: 'ขาเทียม ราชบุรี' } },
      { type: 'web_search_call', status: 'failed', action: { query: 'สวีเดน' } },
      { type: 'message', content: [{ type: 'output_text', text: `ผล:\n\`\`\`json\n${answer}\n\`\`\`` }] },
    ],
    usage: { input_tokens: 10000, output_tokens: 2000 },
  } }]);
  let t = 1000;
  const r = await api.runApiFallback({ prompt: 'ใบงาน', apiKey: 'sk-test-0123456789', timeoutMs: 60_000 }, { fetchImpl: f.impl, now: () => (t += 500) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.account, 'api');
  assert.equal(r.searches, 2);
  assert.equal(r.costUsd, 0.22, 'โทเคน 10k×$10/1M + 2k×$50/1M + ค้น 2×$0.01 (ราคาทางการ astra 1 ต.ค. 69)');
  assert.deepEqual(r.json.tool_log.map((x) => x.tool), ['api-fallback', 'web_search', 'web_search'], 'ใช้บันทึกจริงจากซอง API เท่านั้น (ของที่โมเดลจดเองไม่นับซ้ำ)');
  assert.equal(r.json.tool_log[2].ok, false);
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer sk-test-0123456789');
  const q = await api.runApiFallback({ prompt: 'x', apiKey: 'sk-test-0123456789' }, { fetchImpl: fakeFetch([{ match: /openai/, status: 429, json: { error: { code: 'rate_limit', message: 'slow down' } } }]).impl });
  assert.equal(q.errorType, 'API_QUOTA');
  assert.equal((await api.runApiFallback({ prompt: 'x', apiKey: '' })).errorType, 'API_NO_KEY');
  await checkApiRedaction(api);
});

test('14. CLI จริง: ไม่มีอาร์กิวเมนต์/--help = exit 2 (stderr) · ผลล้ม = exit 1 + JSON ok:false ทาง stdout', () => {
  const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '' } });
  const a = run(['scripts/research-tools/serper.mjs']);
  assert.equal(a.status, 2);
  assert.equal(a.stdout, '');
  assert.match(a.stderr, /ต้องมีคำค้น/);
  assert.equal(run(['scripts/research-tools/wiki.mjs', '--help']).status, 2);
  const b = run(['scripts/research-tools/transcribe.mjs', '--url', 'https://example.com/x']);
  assert.equal(b.status, 1);
  assert.equal(JSON.parse(b.stdout).errorType, 'UNSUPPORTED');
});

// ── กลายพันธุ์ (ต้องแดง) ──
test('M1 กลายพันธุ์: ensureKeys ยกทั้ง .env.local เข้า env (ข้อตรวจต้องแดง)', async () => {
  const m = await mutantOf('scripts/research-tools/_common.mjs', 'for (const n of missing) if (parsed[n]) env[n] = parsed[n];', 'Object.assign(env, parsed);', 'env-all');
  assert.throws(() => checkEnsureKeysOnlyNamed(m));
});

test('M2 กลายพันธุ์: apify ส่งโทเคนใน URL (ข้อตรวจต้องแดง)', async () => {
  const m = await mutantOf('scripts/research-tools/apify.mjs', '?timeout=${req.timeout}&clean=true&limit=${req.limit}`;', '?token=${token}&timeout=${req.timeout}&clean=true&limit=${req.limit}`;', 'token-url');
  await assert.rejects(() => checkApifyTokenInHeader(m));
});

test('M3 กลายพันธุ์: ไม่สลับบัญชีเมื่อเหลือ ≤5% (ข้อตรวจต้องแดง)', async () => {
  const m = await mutantOf('scripts/research-agent/accounts.mjs', '|| (Number.isFinite(q.remainingPct) && q.remainingPct <= switchPct));', ');', 'no-switch');
  assert.throws(() => checkChooseAccount(m));
});

test('M4 กลายพันธุ์: สมองสำรองไม่ปิดคีย์ใน error (ข้อตรวจต้องแดง)', async () => {
  const m = await mutantOf('scripts/research-agent/apiFallback.mjs', 'error: redactSecrets(String(error || errorType), secrets).slice(0, 400)', 'error: String(error || errorType).slice(0, 400)', 'no-redact');
  await assert.rejects(() => checkApiRedaction(m));
});

test('M5 กลายพันธุ์: web-agent ไม่อ่าน .env.local (พึ่ง env อย่างเดียว) (ข้อตรวจทางคีย์ต้องแดง)', async () => {
  const m = await mutantOf('scripts/research-tools/web-agent.mjs', "if (ensureKeys(['OPENAI_API_KEY'], { env }).length)", 'if (!env.OPENAI_API_KEY)', 'wa-env-only');
  await assert.rejects(() => checkWebAgentKeyFromEnvLocal(m));
});

test('M6 กลายพันธุ์: หารากโปรเจกต์จาก cwd แทนตำแหน่งจริงของเครื่องมือ (ข้อตรวจโปรเซสจริงผ่าน junction ต้องแดง)', () => {
  const s = src('scripts/research-tools/_common.mjs');
  const find = "return path.resolve(HERE, '..', '..');";
  assert.ok(s.includes(find), 'ไม่พบจุดกลายพันธุ์ root-from-cwd');
  assert.throws(() => checkWebAgentJunctionProcess(s.replace(find, 'return process.cwd();')));
});
