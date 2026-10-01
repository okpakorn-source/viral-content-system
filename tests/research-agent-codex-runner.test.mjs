// ============================================================
// 🧪 tests/research-agent-codex-runner.test.mjs — ตัวรัน Codex ของเอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 4)
// ★ 1 ต.ค. 69 (research agent v2 เลน A) — ไม่เรียก Codex จริง: child ปลอม (EventEmitter) + ตัวปลอม fake-codex.mjs (โปรเซสจริง)
// ตรวจ: ธงคำสั่งตามสเปกทุกตัว · env ลูกเป็นรายชื่อปิด (ไม่มี OPENAI_API_KEY/ความลับระบบ) · บัญชี CODEX_HOME ·
//       พรอมต์ไทยทาง stdin · .cmd ผ่าน cmd.exe ที่ quote เอง · หมดเวลา = ฆ่าทั้งต้นไม้ (นาฬิกามือ ไม่รอเวลาจริง) ·
//       จัดประเภทโควตา/ล็อกอินเฉพาะออกด้วยโค้ดไม่ใช่ 0 · อ่านผลจาก out/result.json → ข้อความสุดท้าย → stdout
// กลายพันธุ์ 5 แบบ (patch codexRunner.mjs จริงในโฟลเดอร์ชั่วคราว → ข้อตรวจต้องแดง)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawn as realSpawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPatchedModule } from './helpers/temp-module.mjs';
import { settleWithin } from './helpers/fake-deadline.mjs';
import * as cr from '../scripts/research-agent/codexRunner.mjs';

const SRC_URL = new URL('../scripts/research-agent/codexRunner.mjs', import.meta.url);
const SRC = readFileSync(SRC_URL, 'utf8');
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/research-agent/fake-codex.mjs', import.meta.url));
const FIX_OUT = fileURLToPath(new URL('./fixtures/research-agent/lab-out-result.json', import.meta.url));
const PROMPT = 'ใบงานทดสอบ: ค้นต้นทางข่าวชาวสวีเดนสวมขาเทียม ราชบุรี (DATA ONLY)';

async function mutant(find, replace, name) {
  assert.ok(SRC.includes(find), `ไม่พบจุดกลายพันธุ์ ${name}`);
  return importPatchedModule(SRC.replace(find, replace), SRC_URL, `ra-codex-${name}`);
}
function tempWorkdir() {
  const dir = mkdtempSync(join(tmpdir(), 'ra-codex-'));
  mkdirSync(join(dir, 'out'), { recursive: true });
  return dir;
}

/** child ปลอม: stdout/stderr/stdin จริงแบบ stream · finish(code) ปิดทุกท่อแล้วยิง close */
function makeChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let stdin = '';
  child.stdin = new Writable({ write(chunk, _enc, cb) { stdin += chunk.toString('utf8'); cb(); } });
  child.stdinText = () => stdin;
  child.finish = (code, { out = '', err = '' } = {}) => {
    if (out) child.stdout.write(out);
    if (err) child.stderr.write(err);
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit('close', code));
  };
  return child;
}
function fakeSpawn(behavior) {
  const calls = [];
  const impl = (file, args, opts) => {
    const child = makeChild();
    calls.push({ file, args, opts, child });
    setImmediate(() => behavior(child, { file, args, opts }));
    return child;
  };
  return { impl, calls };
}
function manualTimers() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
    active: () => timers.filter((t) => !t.cleared),
  };
}
const SPEC_ARGS = (workdir, outFile, effort = 'low') => [
  'exec', '--skip-git-repo-check', '-C', workdir, '-s', 'danger-full-access', '--ephemeral', '-m', 'gpt-6-astra',
  '-c', `model_reasoning_effort="${effort}"`, '-c', 'approvals_reviewer="auto_review"', '-c', 'approval_policy="on-request"',
  '-o', outFile, '-',
];
const linuxDeps = (spawnImpl, extra = {}) => ({ spawnImpl, platform: 'linux', homeDir: '/home/u', ...extra });

// ── ข้อตรวจที่ใช้ซ้ำ ──
function checkArgs(m) {
  const wd = 'C:\\tmp\\work\\q_abc';
  const of = 'C:\\tmp\\work\\q_abc\\out\\last-message.txt';
  assert.deepEqual(m.buildCodexArgs({ workdir: wd, outFile: of, effort: 'low' }), SPEC_ARGS(wd, of, 'low'));
  assert.deepEqual(m.buildCodexArgs({ workdir: wd, outFile: of, effort: 'medium' }), SPEC_ARGS(wd, of, 'medium'));
}
function checkEnv(m) {
  const env = m.buildChildEnv({
    baseEnv: {
      PATH: 'C:\\bin', SystemRoot: 'C:\\Windows', TEMP: 'C:\\t', USERPROFILE: 'C:\\Users\\u',
      SERPER_API_KEY: 'serper-1234567890', APIFY_API_TOKEN: 'apify-1234567890',
      OPENAI_API_KEY: 'sk-should-not-pass', ANTHROPIC_API_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', RESEARCH_AGENT_SECRET: 'x',
      DISCORD_TOKEN: 'x', CODEX_HOME: 'C:\\evil', DATABASE_URL: 'x', HTTPS_PROXY: 'http://proxy:1',
    },
    codexHome: null,
    repoRoot: 'C:\\repo',
    passEnv: ['HTTPS_PROXY', 'MY_SECRET_TOKEN'],
  });
  for (const k of ['PATH', 'SystemRoot', 'TEMP', 'USERPROFILE', 'SERPER_API_KEY', 'APIFY_API_TOKEN', 'HTTPS_PROXY']) assert.ok(k in env, `ต้องมี ${k}`);
  for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEARCH_AGENT_SECRET', 'DISCORD_TOKEN', 'CODEX_HOME', 'DATABASE_URL']) {
    assert.ok(!(k in env), `ห้ามมี ${k}`);
  }
  assert.equal(env.RESEARCH_TOOLS_REPO_ROOT, 'C:\\repo');
  assert.equal(env.NO_COLOR, '1');
}
/**
 * passEnv (ชื่อเพิ่มที่ผู้เรียกขอ) ต้องผ่าน DENY_EXTRA เสมอ — ชื่อที่หน้าตาเป็นความลับ "อยู่ใน env จริง" ก็ห้ามถึงลูก
 * (checkEnv เดิมขอ MY_SECRET_TOKEN แต่ไม่มีค่านั้นใน baseEnv → ตัด DENY_EXTRA ทิ้งก็ยังเขียว — ข้อนี้ปิดช่องนั้น)
 */
function checkPassEnvDeny(m) {
  const secretish = {
    MY_SECRET_TOKEN: 'tok-0123456789', OPENAI_API_KEY: 'sk-must-not-pass-0123456789', ANTHROPIC_API_KEY: 'x-0123456789',
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-0123456789', DISCORD_BOT_TOKEN: 'd-0123456789',
    DISCORD_CHANNEL_ID: '1234567890', DATABASE_URL: 'postgres://u:p@h/db', RESEARCH_AGENT_SECRET: 'sec-0123456789',
    GH_AUTH_HEADER: 'x', SESSION_ID: 'x', MY_PRIVATE_DIR: 'x', COOKIE_JAR: 'x', DB_PASSWORD: 'x', DB_PASSWD: 'x',
    SSH_PASSPHRASE: 'x', AWS_CREDENTIAL_FILE: 'x',
  };
  const env = m.buildChildEnv({
    baseEnv: { PATH: 'C:\\bin', HTTPS_PROXY: 'http://proxy:1', NODE_EXTRA_CA_CERTS: 'C:\\ca.pem', ...secretish },
    passEnv: ['HTTPS_PROXY', 'node_extra_ca_certs', ...Object.keys(secretish), ...Object.keys(secretish).map((k) => k.toLowerCase())],
  });
  assert.equal(env.HTTPS_PROXY, 'http://proxy:1', 'ชื่อธรรมดาที่ขอเพิ่มต้องผ่าน');
  assert.equal(env.NODE_EXTRA_CA_CERTS, 'C:\\ca.pem', 'ขอด้วยตัวพิมพ์เล็กก็ได้');
  for (const k of Object.keys(secretish)) assert.ok(!(k in env), `passEnv ขอ ${k} ก็ห้ามผ่าน (DENY_EXTRA)`);
  const lower = m.buildChildEnv({ baseEnv: { my_api_key: 'k-0123456789', Session_Cookie: 'c-0123456789' }, passEnv: ['my_api_key', 'Session_Cookie'] });
  assert.deepEqual(Object.keys(lower).filter((k) => /key|cookie/i.test(k)), [], 'ชื่อตัวพิมพ์เล็ก/ผสมก็ถูกกัน');
}
function checkNoisyStderr(m) {
  // โค้ด 0 + ผลครบ แต่ stderr มี 401/authentication (บันทึกงานที่อ่านหน้าเว็บมา) → ต้องไม่ถูกตีเป็นบัญชีหลุด
  assert.equal(m.classifyExit({ code: 0, out: '', err: 'page says 401 authentication required' }), null);
  assert.equal(m.classifyExit({ code: 1, out: '', err: 'ERROR: usage limit reached' }), 'CODEX_QUOTA');
  assert.equal(m.classifyExit({ code: 1, out: '', err: 'Not logged in. Please run codex login' }), 'CODEX_AUTH');
  assert.equal(m.classifyExit({ code: 1, out: '', err: 'panic: something' }), 'CODEX_EXIT');
}
async function checkTimeoutKills(m) {
  const wd = tempWorkdir();
  try {
    const clock = manualTimers();
    const kills = [];
    const sp = fakeSpawn(() => { /* ค้าง ไม่จบเอง */ });
    const p = m.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: {} }, linuxDeps(sp.impl, {
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      killTreeImpl: async (child) => { kills.push(child.pid); child.finish(null); return { killFailed: false, reason: 'ok' }; },
    }));
    await settleWithin(new Promise((r) => setImmediate(r)), 'รอ spawn');
    const main = clock.active().find((t) => t.ms === 60_000);
    assert.ok(main, 'ต้องตั้งเพดานเวลาตาม timeoutMs');
    main.fn();
    const r = await settleWithin(p, 'รอผลหลังหมดเวลา', 1500);
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'CODEX_TIMEOUT');
    assert.equal(r.timedOut, true);
    assert.deepEqual(kills, [4242], 'ต้องฆ่าทั้งต้นไม้หนึ่งครั้ง');
  } finally { rmSync(wd, { recursive: true, force: true }); }
}

test('1. อาร์กิวเมนต์ codex exec ตรงสเปกทุกธง/ทุกลำดับ (low/medium)', () => checkArgs(cr));

test('2. อาร์กิวเมนต์อันตรายถูกปฏิเสธ (รุ่น/effort/อักขระสั่งงานใน path)', () => {
  const ok = { workdir: 'C:\\tmp\\w', outFile: 'C:\\tmp\\w\\out\\x.txt' };
  assert.throws(() => cr.buildCodexArgs({ ...ok, model: '--dangerously-bypass-approvals-and-sandbox' }));
  assert.throws(() => cr.buildCodexArgs({ ...ok, model: 'gpt&calc' }));
  assert.throws(() => cr.buildCodexArgs({ ...ok, effort: 'ultra' }));
  for (const bad of ['C:\\tmp\\%PATH%', 'C:\\tmp\\a&b', 'C:\\tmp\\a"b', 'C:\\tmp\\a\nb', '']) {
    assert.throws(() => cr.buildCodexArgs({ ...ok, workdir: bad }), String(bad));
  }
});

test('3. env ลูก = รายชื่อปิด: มีคีย์เครื่องมือ ไม่มี OPENAI_API_KEY/ความลับระบบ/CODEX_HOME ที่ติดมา', () => checkEnv(cr));

test('3b. passEnv ขอชื่อที่หน้าตาเป็นความลับ (มีค่าอยู่จริงใน env) → ถูก DENY_EXTRA กันทุกตัว · ชื่อธรรมดาผ่าน', () => checkPassEnvDeny(cr));

test('4. บัญชี: main = ไม่ตั้ง CODEX_HOME · ตัวอักษร = ~/.codex-<x> · ชื่อผิดรูปถูกปฏิเสธ', () => {
  assert.equal(cr.resolveCodexHome('main', '/home/u'), join('/home/u', '.codex'));
  assert.equal(cr.resolveCodexHome('b', '/home/u'), join('/home/u', '.codex-b'));
  assert.throws(() => cr.resolveCodexHome('b;rm', '/home/u'));
  const env = cr.buildChildEnv({ baseEnv: {}, codexHome: join('/home/u', '.codex-b') });
  assert.equal(env.CODEX_HOME, join('/home/u', '.codex-b'));
});

test('5. เส้น .cmd (Windows): บรรทัด cmd.exe quote ทุกชิ้น · ค่าตั้ง -c คง " แบบ TOML ด้วย \\"', () => {
  const args = cr.buildCodexArgs({ workdir: 'C:\\tmp\\w\\q_1', outFile: 'C:\\tmp\\w\\q_1\\out\\last-message.txt', effort: 'low' });
  const line = cr.buildWindowsCmdLine('C:\\Users\\U\\AppData\\Roaming\\npm\\codex.cmd', args);
  assert.ok(line.startsWith('"C:\\Users\\U\\AppData\\Roaming\\npm\\codex.cmd" "exec" "--skip-git-repo-check" "-C" "C:\\tmp\\w\\q_1"'));
  assert.ok(line.includes('"model_reasoning_effort=\\"low\\""'));
  assert.ok(line.includes('"approvals_reviewer=\\"auto_review\\""'));
  assert.ok(line.includes('"approval_policy=\\"on-request\\""'));
  assert.ok(line.endsWith('"-"'));
  assert.throws(() => cr.buildWindowsCmdLine('C:\\x\\codex.cmd', ['exec', 'a%PATH%b']));
});

test('6. Windows + codex.cmd → spawn cmd.exe /d /s /c "<บรรทัด>" verbatim · cwd = โฟลเดอร์งาน · พรอมต์ไทยทาง stdin', async () => {
  const wd = tempWorkdir();
  try {
    const sp = fakeSpawn((child) => {
      writeFileSync(join(wd, 'out', 'result.json'), readFileSync(FIX_OUT));
      child.finish(0, { err: 'tokens used\n9,876\n' });
    });
    const r = await settleWithin(cr.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: { COMSPEC: 'C:\\Windows\\system32\\cmd.exe', PATH: 'C:\\x' } }, {
      spawnImpl: sp.impl, platform: 'win32', resolveExe: () => ({ exe: 'C:\\npm\\codex.cmd', batch: true }),
    }), 'รอ runCodex');
    assert.equal(r.ok, true, r.error);
    const call = sp.calls[0];
    assert.equal(call.file, 'C:\\Windows\\system32\\cmd.exe');
    assert.deepEqual(call.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.ok(call.args[3].startsWith('""C:\\npm\\codex.cmd" "exec"'));
    assert.equal(call.opts.windowsVerbatimArguments, true);
    assert.equal(call.opts.shell, false);
    assert.equal(call.opts.cwd, wd);
    assert.equal(call.child.stdinText(), PROMPT, 'พรอมต์ไทยครบทุกตัวอักษร');
    assert.equal(r.tokensUsed, 9876);
    assert.equal(r.resultSource, 'result.json');
    assert.ok(Array.isArray(r.json.research_plan));
  } finally { rmSync(wd, { recursive: true, force: true }); }
});

test('7. ไม่มี result.json แต่ข้อความสุดท้ายมี JSON → ใช้ได้ (source last-message)', async () => {
  const wd = tempWorkdir();
  try {
    const sp = fakeSpawn((child) => {
      writeFileSync(join(wd, 'out', cr.LAST_MESSAGE_FILE), 'สรุป\n```json\n{"plan":[],"cards":[],"tool_log":[],"origin_post":{}}\n```\n');
      child.finish(0);
    });
    const r = await settleWithin(cr.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: {} }, linuxDeps(sp.impl)), 'รอ runCodex');
    assert.equal(r.ok, true);
    assert.equal(r.resultSource, 'last-message');
    assert.deepEqual(r.json.cards, []);
  } finally { rmSync(wd, { recursive: true, force: true }); }
});

test('8. จัดประเภทความล้มเหลว: โควตา/ล็อกอิน/ออกผิดปกติ — และ stderr ปนคำว่า 401 แต่โค้ด 0 ไม่ใช่บัญชีหลุด', async () => {
  checkNoisyStderr(cr);
  const cases = [
    { code: 1, err: 'ERROR: usage limit reached', want: 'CODEX_QUOTA' },
    { code: 1, err: 'Not logged in', want: 'CODEX_AUTH' },
    { code: 3, err: 'boom', want: 'CODEX_EXIT' },
  ];
  for (const c of cases) {
    const wd = tempWorkdir();
    try {
      const sp = fakeSpawn((child) => child.finish(c.code, { err: c.err }));
      const r = await settleWithin(cr.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: {} }, linuxDeps(sp.impl)), c.want); // eslint-disable-line no-await-in-loop
      assert.equal(r.errorType, c.want);
    } finally { rmSync(wd, { recursive: true, force: true }); }
  }
  const wd = tempWorkdir();
  try {
    const sp = fakeSpawn((child) => {
      writeFileSync(join(wd, 'out', cr.LAST_MESSAGE_FILE), 'Not logged in · Please run codex login');
      child.finish(0);
    });
    const r = await settleWithin(cr.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: {} }, linuxDeps(sp.impl)), 'auth-ok0');
    assert.equal(r.errorType, 'CODEX_AUTH', 'โค้ด 0 แต่ข้อความบอกให้ล็อกอิน = บัญชีหลุด');
  } finally { rmSync(wd, { recursive: true, force: true }); }
});

test('9. หมดเวลา: ฆ่าทั้งต้นไม้ (นาฬิกามือ) · มีผลบางส่วนใน result.json = ใช้ได้พร้อม warning', async () => {
  await checkTimeoutKills(cr);
  const wd = tempWorkdir();
  try {
    const clock = manualTimers();
    const sp = fakeSpawn(() => { writeFileSync(join(wd, 'out', 'result.json'), readFileSync(FIX_OUT)); });
    const p = cr.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: {} }, linuxDeps(sp.impl, {
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      killTreeImpl: async (child) => { child.finish(null); return { killFailed: false }; },
    }));
    await settleWithin(new Promise((r) => setImmediate(() => setImmediate(r))), 'รอ spawn');
    clock.active().find((t) => t.ms === 60_000).fn();
    const r = await settleWithin(p, 'partial', 1500);
    assert.equal(r.ok, true);
    assert.equal(r.warning, 'CODEX_TIMEOUT');
    assert.equal(r.timedOut, true);
  } finally { rmSync(wd, { recursive: true, force: true }); }
});

test('10. ไม่มี CLI: spawn ENOENT / หาไฟล์ไม่เจอบน Windows → CODEX_UNAVAILABLE (ไม่โยน)', async () => {
  const wd = tempWorkdir();
  try {
    const r1 = await settleWithin(cr.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: {} }, linuxDeps(() => {
      const e = new Error('spawn codex ENOENT'); e.code = 'ENOENT'; throw e;
    })), 'enoent');
    assert.equal(r1.errorType, 'CODEX_UNAVAILABLE');
    const r2 = await settleWithin(cr.runCodex({ prompt: PROMPT, workdir: wd, timeoutMs: 60_000, baseEnv: {} }, {
      platform: 'win32', resolveExe: () => null, spawnImpl: () => { throw new Error('ไม่ควรถูกเรียก'); },
    }), 'no exe');
    assert.equal(r2.errorType, 'CODEX_UNAVAILABLE');
    const r3 = await cr.runCodex({ prompt: '', workdir: wd }, linuxDeps(() => { throw new Error('x'); }));
    assert.equal(r3.errorType, 'CODEX_BAD_ARGS');
    const r4 = await cr.runCodex({ prompt: PROMPT, workdir: wd, account: 'b&calc' }, linuxDeps(() => { throw new Error('x'); }));
    assert.equal(r4.errorType, 'CODEX_BAD_ARGS');
  } finally { rmSync(wd, { recursive: true, force: true }); }
});

test('11. อ่านไฟล์ผล: BOM UTF-8 / UTF-16LE (PowerShell Out-File) / JSON ปนข้อความ', () => {
  const wd = tempWorkdir();
  try {
    const obj = { plan: [], cards: [], tool_log: [], origin_post: {}, note: 'ไทย' };
    writeFileSync(join(wd, 'out', 'result.json'), Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(JSON.stringify(obj), 'utf16le')]));
    assert.deepEqual(cr.readAgentResult({ workdir: wd }).json, obj);
    writeFileSync(join(wd, 'out', 'result.json'), `\uFEFF${JSON.stringify(obj)}`, 'utf8');
    assert.deepEqual(cr.readAgentResult({ workdir: wd }).json, obj);
    writeFileSync(join(wd, 'out', 'result.json'), `ผลลัพธ์: ${JSON.stringify(obj)} จบ`, 'utf8');
    assert.deepEqual(cr.readAgentResult({ workdir: wd }).json, obj);
    rmSync(join(wd, 'out', 'result.json'));
    assert.equal(cr.readAgentResult({ workdir: wd, lastMessage: 'ไม่มี JSON' }).source, 'missing');
  } finally { rmSync(wd, { recursive: true, force: true }); }
});

test('12. โปรเซสจริง (fake-codex.mjs): argv ตามสเปก · env รายชื่อปิด · CODEX_HOME บัญชีรอง · UTF-8 ไป-กลับ · tokens used', async () => {
  const wd = tempWorkdir();
  try {
    const spawnImpl = (file, args, opts) => realSpawn(file, [FAKE_CODEX, ...args], opts);
    const r = await settleWithin(cr.runCodex({
      prompt: PROMPT, workdir: wd, account: 'b', timeoutMs: 60_000, repoRoot: 'C:\\repo-root',
      baseEnv: { ...process.env, SERPER_API_KEY: 'serper-test-0123456789', OPENAI_API_KEY: 'sk-test-must-not-pass-0123456789', RESEARCH_AGENT_SECRET: 'secret-must-not-pass', FAKE_CODEX_MODE: 'ok' },
      passEnv: ['FAKE_CODEX_MODE'],
    }, { spawnImpl, platform: process.platform, bin: process.execPath, resolveExe: () => ({ exe: process.execPath, batch: false }), homeDir: join(wd, 'home') }), 'โปรเซสจริง', 15_000);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.tokensUsed, 12345);
    const seen = JSON.parse(readFileSync(join(wd, 'out', 'seen.json'), 'utf8'));
    assert.deepEqual(seen.argv, SPEC_ARGS(wd, join(wd, 'out', cr.LAST_MESSAGE_FILE), 'low'));
    assert.ok(seen.envNames.includes('SERPER_API_KEY'));
    assert.ok(!seen.envNames.includes('OPENAI_API_KEY'), 'OPENAI_API_KEY ห้ามถึง Codex (กันคิดเงินแบบ API)');
    assert.ok(!seen.envNames.includes('RESEARCH_AGENT_SECRET'));
    assert.equal(seen.codexHome, join(wd, 'home', '.codex-b'));
    assert.equal(seen.toolsRoot, 'C:\\repo-root');
    assert.equal(seen.promptHasThai, true);
    assert.equal(seen.promptHead, PROMPT);
  } finally { rmSync(wd, { recursive: true, force: true }); }
});

// ── กลายพันธุ์ (ต้องแดง) ──
test('M1 กลายพันธุ์: ส่ง OPENAI_API_KEY ให้ Codex (ข้อตรวจ env ต้องแดง)', async () => {
  const m = await mutant("'SERPER_API_KEY', 'JINA_API_KEY',", "'SERPER_API_KEY', 'OPENAI_API_KEY', 'JINA_API_KEY',", 'openai-env');
  assert.throws(() => checkEnv(m));
});

test('M2 กลายพันธุ์: ลืม -s danger-full-access (ข้อตรวจอาร์กิวเมนต์ต้องแดง)', async () => {
  const m = await mutant("'-C', workdir, '-s', 'danger-full-access', '--ephemeral',", "'-C', workdir, '--ephemeral',", 'no-sandbox-flag');
  assert.throws(() => checkArgs(m));
});

test('M3 กลายพันธุ์: ลืม --ephemeral (ข้อตรวจอาร์กิวเมนต์ต้องแดง)', async () => {
  const m = await mutant("'danger-full-access', '--ephemeral',", "'danger-full-access',", 'no-ephemeral');
  assert.throws(() => checkArgs(m));
});

test('M4 กลายพันธุ์: ตรวจโควตา/ล็อกอินแม้โค้ด 0 (ข้อตรวจ stderr ปนต้องแดง)', async () => {
  const m = await mutant('  if (code === 0) return null;\n', '', 'classify-on-zero');
  assert.throws(() => checkNoisyStderr(m));
});

test('M5 กลายพันธุ์: หมดเวลาแล้วไม่ฆ่าโปรเซส (ข้อตรวจหมดเวลาต้องแดง)', async () => {
  const m = await mutant('try { k = await killTreeImpl(child); }', 'try { k = { killFailed: false }; }', 'no-kill');
  await assert.rejects(() => checkTimeoutKills(m));
});

test('M6 กลายพันธุ์: ตัด DENY_EXTRA ใน buildChildEnv — passEnv ส่งความลับต่อได้ (ข้อตรวจ passEnv ต้องแดง)', async () => {
  const m = await mutant('.filter((s) => s && !DENY_EXTRA.test(s))', '.filter((s) => s)', 'no-deny-extra');
  assert.throws(() => checkPassEnvDeny(m));
});
