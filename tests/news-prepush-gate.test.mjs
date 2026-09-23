// ============================================================
// 🧪 ข้อสอบด่าน pre-push → main: GOLDEN-LOCK เดิม + ด่านเทสข่าวใหม่ (CFG-03)
// ★ 23 ก.ย. 69 (แคมเปญแก้บั๊ก ข้อ 1 · เจ้าของอนุมัติ)
// ------------------------------------------------------------
// รัน hook ต้นฉบับ scripts/golden-lock/hooks/pre-push ด้วย sh จริง ใน git repo ชั่วคราว (mkdtemp) ที่มี
//   scripts/test-news.mjs ตัวปลอม (FAKE_NEWS_TESTS=red → exit 1) — ไม่ push จริง ไม่แตะ repo จริง/เครือข่าย
// สิ่งที่ล็อก (แต่ละข้อ "ต้องแดง" เมื่อถอดสิ่งที่ระบุ — ทุบจริง 23 ก.ย. 69 ผ่าน NEWS_PREPUSH_HOOK_UNDER_TEST):
//   a push → main + เทสข่าวแดง = ปฏิเสธ (exit 1 + 'NEWS-TEST GATE BLOCKED')        [ถอดขั้นรันเทส → แดง]
//   b push → main + เทสเขียว = ผ่าน                                                [บล็อกทุกครั้ง → แดง]
//   c NEWS_TEST_GATE=0 = ข้ามด่านเทสพร้อมคำเตือน ไม่รันเทส                           [ถอดสวิตช์ → แดง]
//   d push กิ่งอื่น (ไม่ใช่ main) = ไม่รันเทส ไม่บล็อก                                 [รันทุกกิ่ง → แดง]
//   e GOLDEN-LOCK เดิมยังบล็อก commit แตะไฟล์ข่าวที่ไม่มีรหัสอนุมัติ (และไม่เสียเวลารันเทส)   [ทำ lock หาย → แดง]
//   f มีรหัสอนุมัติ = lock ผ่าน แต่ด่านเทสยังต้องผ่านด้วย
//   g กิ่งที่ยังไม่มี scripts/test-news.mjs = ข้ามด่านเทสพร้อมคำเตือน (push จากกิ่งเก่าไม่พัง)
//   h ต้นฉบับ = สำเนาที่ติดตั้งจริงใน <git-common-dir>/hooks/pre-push ทุกไบต์ — เครื่องที่ไม่ได้ติดตั้ง GOLDEN-LOCK (เช่น CI)
//     = ไม่มีสำเนาให้เทียบ: ผ่านพร้อม diagnostic (★ 24 ก.ย. 69 L1: ด่านข่าวห้าม skip → เลิกใช้ t.skip ในข้อนี้)
//   i .github/workflows/news-tests.yml รัน npm run test:news บน push/pull_request → main ด้วย node 22 + npm ci
//   j ★ 24 ก.ย. 69 (L3): hook ไม่อ้างสคริปต์ที่ไม่มีใน repo (install-hooks.cmd / check-golden-lock.mjs ถูกถอดจาก main แล้ว)
//     [คืนข้อความอ้างสคริปต์ที่ไม่มี → แดง]
// ไม่ได้ตรวจ: การ push จริงผ่านเครือข่าย · เครื่องที่ไม่มี node ใน PATH (hook บล็อกพร้อมข้อความ — ไม่ได้จำลอง)
// วิธีรัน: node --test tests/news-prepush-gate.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATE = join(ROOT, 'scripts', 'golden-lock', 'hooks', 'pre-push');
const HOOK = process.env.NEWS_PREPUSH_HOOK_UNDER_TEST ? resolve(process.env.NEWS_PREPUSH_HOOK_UNDER_TEST) : TEMPLATE;

// env สะอาด: ตัดตัวแปรตำแหน่ง git (hook จริงอาจตั้ง GIT_DIR ชี้ repo จริง) + ตัดสวิตช์ของผู้รันออก ให้แต่ละเคสตั้งเอง
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^GIT_/i.test(k) || k === 'NEWS_TEST_GATE' || k === 'FAKE_NEWS_TESTS') delete env[k];
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = [dirname(process.execPath), ...(SH_DIR ? [SH_DIR] : []), env[pathKey] || ''].join(delimiter);
  return { ...env, ...extra };
}

let SH_DIR = null;
function findSh() {
  const probe = spawnSync('sh', ['-c', 'exit 0'], { windowsHide: true });
  if (probe.status === 0) return 'sh';
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true });
  if (exec.status === 0) {
    const base = exec.stdout.trim();
    for (const cand of [join(base, '..', '..', '..', 'usr', 'bin', 'sh.exe'), join(base, '..', '..', '..', 'bin', 'sh.exe')]) {
      if (existsSync(cand)) { SH_DIR = dirname(cand); return cand; }
    }
  }
  return null;
}
const SH = findSh();
const gitOk = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
const skipReason = !SH ? 'ไม่พบ sh (Git Bash) บนเครื่องนี้' : !gitOk ? 'ไม่มี git' : false;

function git(root, ...args) {
  const r = spawnSync('git', ['-C', root, '-c', 'user.name=news-test', '-c', 'user.email=news-test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(root, '.no-hooks')}`, ...args], { env: cleanEnv(), encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

const FAKE_RUNNER = "console.log('FAKE-RUNNER-RAN');\nprocess.exit(process.env.FAKE_NEWS_TESTS === 'red' ? 1 : 0);\n";

/** repo ชั่วคราว: C0 ฐาน → C1 แตะไฟล์ทั่วไป → C2 แตะไฟล์ข่าวไม่มีรหัส → C3 แตะไฟล์ข่าวมีรหัส (HEAD = C3) */
function makeRepo(root) {
  git(root, 'init', '-q');
  write(root, 'README.md', 'repo ทดสอบด่าน pre-push\n');
  write(root, 'scripts/test-news.mjs', FAKE_RUNNER);
  write(root, 'src/lib/ai/openai.js', 'export const x = 0;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const c0 = git(root, 'rev-parse', 'HEAD');
  write(root, 'docs/notes.md', 'บันทึก\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'docs: ไม่แตะไฟล์ข่าว');
  const c1 = git(root, 'rev-parse', 'HEAD');
  write(root, 'src/lib/ai/openai.js', 'export const x = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fix: แตะไฟล์ข่าวโดยไม่มีรหัส');
  const c2 = git(root, 'rev-parse', 'HEAD');
  write(root, 'src/lib/ai/openai.js', 'export const x = 2;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fix: แตะไฟล์ข่าว [NEWS-LOCK-APPROVED by ทดสอบ 23 ก.ย. 69]');
  const c3 = git(root, 'rev-parse', 'HEAD');
  return { c0, c1, c2, c3 };
}

function runHook(root, { local, remote, ref = 'refs/heads/main', env = {} }) {
  const r = spawnSync(SH, [HOOK, 'origin', 'https://example.invalid/repo.git'], {
    cwd: root,
    input: `refs/heads/work ${local} ${ref} ${remote}\n`,
    env: cleanEnv(env),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

let sandbox;
let shas;
test.before(() => {
  if (skipReason) return;
  sandbox = mkdtempSync(join(tmpdir(), 'news-prepush-'));
  shas = makeRepo(sandbox);
});
test.after(() => { if (sandbox) rmSync(sandbox, { recursive: true, force: true }); });

test('a push → main + เทสข่าวแดง = ปฏิเสธ (exit 1) และรันตัวรันเทสจริง', { skip: skipReason }, () => {
  const r = runHook(sandbox, { local: shas.c1, remote: shas.c0, env: { FAKE_NEWS_TESTS: 'red' } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAKE-RUNNER-RAN/);
  assert.match(r.out, /NEWS-TEST GATE BLOCKED/);
  assert.match(r.out, /ไม่ใช่ HEAD/, 'push commit ที่ไม่ใช่ HEAD ต้องเตือนว่าผลเทสมาจากไฟล์บนดิสก์');
});

test('b push → main + เทสเขียว = ผ่าน (exit 0)', { skip: skipReason }, () => {
  const r = runHook(sandbox, { local: shas.c1, remote: shas.c0 });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /FAKE-RUNNER-RAN/);
  assert.doesNotMatch(r.out, /BLOCKED/);
});

test('c NEWS_TEST_GATE=0 = ข้ามด่านเทส (ไม่รันเทส) พร้อมคำเตือน', { skip: skipReason }, () => {
  const r = runHook(sandbox, { local: shas.c1, remote: shas.c0, env: { FAKE_NEWS_TESTS: 'red', NEWS_TEST_GATE: '0' } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /NEWS_TEST_GATE=0/);
  assert.doesNotMatch(r.out, /FAKE-RUNNER-RAN/);
});

test('d push กิ่งอื่น (ไม่ใช่ main) = ไม่รันเทส ไม่บล็อก', { skip: skipReason }, () => {
  const r = runHook(sandbox, { local: shas.c2, remote: shas.c0, ref: 'refs/heads/feature/x', env: { FAKE_NEWS_TESTS: 'red' } });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /FAKE-RUNNER-RAN/);
});

test('e GOLDEN-LOCK เดิมยังบล็อก commit แตะไฟล์ข่าวไม่มีรหัส และไม่เสียเวลารันเทส', { skip: skipReason }, () => {
  const r = runHook(sandbox, { local: shas.c2, remote: shas.c1 });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /GOLDEN-LOCK BLOCKED/);
  assert.match(r.out, /src\/lib\/ai\/openai\.js/);
  assert.doesNotMatch(r.out, /FAKE-RUNNER-RAN/);
});

test('f มีรหัสอนุมัติ = lock ผ่าน แต่ยังต้องผ่านด่านเทส (เขียว=ผ่าน · แดง=บล็อก)', { skip: skipReason }, () => {
  const green = runHook(sandbox, { local: shas.c3, remote: shas.c2 });
  assert.equal(green.code, 0, green.out);
  assert.match(green.out, /FAKE-RUNNER-RAN/);
  const red = runHook(sandbox, { local: shas.c3, remote: shas.c2, env: { FAKE_NEWS_TESTS: 'red' } });
  assert.equal(red.code, 1, red.out);
  assert.match(red.out, /NEWS-TEST GATE BLOCKED/);
  assert.doesNotMatch(red.out, /GOLDEN-LOCK BLOCKED/);
});

test('g กิ่งที่ยังไม่มี scripts/test-news.mjs = ข้ามด่านเทสพร้อมคำเตือน (ไม่พังการ push จากกิ่งเก่า)', { skip: skipReason }, () => {
  const runnerPath = join(sandbox, 'scripts', 'test-news.mjs');
  rmSync(runnerPath);
  try {
    const r = runHook(sandbox, { local: shas.c1, remote: shas.c0, env: { FAKE_NEWS_TESTS: 'red' } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ไม่พบ scripts\/test-news\.mjs/);
  } finally {
    writeFileSync(runnerPath, FAKE_RUNNER);
  }
});

test('h hook ต้นฉบับ = สำเนาที่ติดตั้งจริงใน git-common-dir ทุกไบต์ (เครื่องที่ไม่ได้ติดตั้ง GOLDEN-LOCK เช่น CI = ไม่มีอะไรให้เทียบ)', (t) => {
  const r = spawnSync('git', ['-C', ROOT, 'rev-parse', '--git-common-dir'], { env: cleanEnv(), encoding: 'utf8', windowsHide: true });
  const installed = r.status === 0 ? join(resolve(ROOT, r.stdout.trim()), 'hooks', 'pre-push') : '';
  if (!installed || !existsSync(installed) || !readFileSync(installed, 'utf8').includes('GOLDEN-LOCK')) {
    // ไม่ใช้ t.skip: ด่านข่าวนับ skip เป็นแดง (L1) — ไม่มีสำเนาที่ติดตั้ง = ไม่มีสำเนาที่เพี้ยน จึงผ่านพร้อมบันทึกไว้ใน TAP
    t.diagnostic('ไม่มี hook GOLDEN-LOCK ติดตั้งบนเครื่องนี้ (เช่น CI) — ไม่มีสำเนาให้เทียบ');
    return;
  }
  const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(norm(installed), norm(TEMPLATE),
    `hook ที่ติดตั้งจริง (${installed}) ไม่ตรงต้นฉบับ — ติดตั้งใหม่: cp scripts/golden-lock/hooks/pre-push "$(git rev-parse --git-common-dir)/hooks/pre-push"`);
});

test('i CI: .github/workflows/news-tests.yml รัน npm run test:news บน push/pull_request → main (node 22 + npm ci)', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'news-tests.yml'), 'utf8').replace(/\r\n/g, '\n');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts?.['test:news'], 'node scripts/test-news.mjs', 'package.json ต้องมี "test:news"');
  assert.match(yml, /^on:\n(?:.*\n)*?\s+push:\n\s+branches:\s*\[\s*main\s*\]/m, 'ต้องรันเมื่อ push → main');
  assert.match(yml, /^\s+pull_request:\n\s+branches:\s*\[\s*main\s*\]/m, 'ต้องรันเมื่อเปิด PR → main');
  assert.match(yml, /node-version:\s*['"]?22['"]?/);
  assert.match(yml, /^\s+- run: npm ci\b/m);
  assert.match(yml, /^\s+- run: npm run test:news\s*$/m);
  assert.doesNotMatch(yml, /secrets\./, 'ด่านเทสข่าวต้องไม่ใช้ secret ใดๆ (เทสยิง API จริงไม่ได้อยู่แล้ว)');
});

test('j hook ไม่อ้างสคริปต์ที่ไม่มีใน repo (ข้อความติดตั้ง/ตรวจสถานะต้องทำตามได้จริง)', () => {
  // บรรทัด PROTECTED= เป็นแพตเทิร์นของไฟล์ที่ล็อก ไม่ใช่คำแนะนำ — ไม่นับ
  const text = readFileSync(HOOK, 'utf8').split(/\r?\n/).filter((line) => !line.startsWith('PROTECTED=')).join('\n');
  const referenced = [...new Set(text.match(/scripts\/[\w./-]+\.(?:mjs|cjs|js|cmd|ps1|sh)\b/g) || [])];
  assert.ok(referenced.includes('scripts/test-news.mjs'), `ต้องเห็นการอ้าง scripts/test-news.mjs (พบ: ${referenced.join(', ')})`);
  const missing = referenced.filter((rel) => !existsSync(join(ROOT, rel)));
  assert.deepEqual(missing, [], `hook อ้างสคริปต์ที่ไม่มีใน repo: ${missing.join(', ')}`);
});
