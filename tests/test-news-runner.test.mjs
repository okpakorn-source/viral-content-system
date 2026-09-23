// ============================================================
// 🧪 ข้อสอบด่านเทสข่าว — scripts/test-news.mjs + tests/news-suite.json (CFG-03 · CFG-14)
// ★ 23 ก.ย. 69 (แคมเปญแก้บั๊ก ข้อ 1 · เจ้าของอนุมัติ)
// ------------------------------------------------------------
// สิ่งที่ข้อสอบนี้ล็อก (แต่ละข้อ "ต้องแดง" เมื่อถอดสิ่งที่ระบุ — ทุบจริง 23 ก.ย. 69 ผ่าน TEST_NEWS_RUNNER_UNDER_TEST
//   + 24 ก.ย. 69 ทุบข้อ 4/5/7 อีก 11 แบบ: ถอด git status/mtime โฟลเดอร์/ไฟล์ล็อก/การบังคับ skip ฯลฯ — แดงครบทุกแบบ):
//   1  news-suite ครอบทุกไฟล์เทสที่อ้างโมดูลข่าว + ตัวจับเห็นรูป join(ROOT,'src',...)/'@/lib/...'/app/api/*
//      (แดงถ้า: ไฟล์เทสข่าวใหม่ไม่ลงทะเบียน · ตัวจับถอยเป็นค้นแค่ '/' · findUnregistered คืนว่างเสมอ)
//      เทสคลิปห้ามอยู่ใน include ยกเว้นไฟล์ที่ระบุชื่อ (clip-golden-shared-clients — มีข้อเฝ้าฝั่งข่าว · L2)
//   2  suite ชั่วคราวใน %TEMP% ที่มีเทสแดง 1 ไฟล์ → ตัวรัน exit ≠ 0 (แดงถ้า: ตัวรันคืน 0 เสมอ) + คุมด้วยชุดเขียวล้วน = exit 0
//   3  ตัวรันถอดคีย์จริง: เทสชั่วคราว assert process.env.OPENAI_API_KEY === undefined ฯลฯ (แดงถ้า: ส่ง env เดิมทั้งก้อน)
//      + ตัวแปรธรรมดายังผ่าน (กันถอดทั้ง env จน PATH หาย) + ห้ามพิมพ์ค่าคีย์ลง log
//   4  ★ รอบแก้ผู้ตรวจ 24 ก.ย. 69 (H1): เทสเขียนไฟล์ลง src → แดง ด้วย snapshot ข้ามแพลตฟอร์ม (ไม่พึ่ง fs.watch ที่ Linux/CI
//      ใช้ไม่ได้) — รันทั้งโหมดไม่มี git (เดินโฟลเดอร์ mtime+size) และโหมด git (git status) · ไม่มี skip ตามแพลตฟอร์มแล้ว
//      4·ทิ้งไฟล์ค้าง → บอกชื่อไฟล์ (แดงถ้า: ถอดการเทียบ snapshot) · 4·สร้างแล้วลบเองใน finally → บอกโฟลเดอร์
//      (แดงถ้า: ถอดการเทียบ mtime โฟลเดอร์ใต้ src) · เทสที่ไม่แตะ src → ผ่าน
//   5  เทสทิ้งไฟล์/แก้ไฟล์ใน repo (git status ก่อน/หลัง) → แดง (แดงถ้า: ถอดการเทียบ git status) — data/ นับด้วยแล้ว
//      (low #3: แดงถ้ายกเว้น data/ ทั้งก้อนกลับมา) · ไฟล์ล็อกข่าว data/prompt-library.json ถูกเขียน → แดง แม้แก้ค้างอยู่ก่อนรัน
//      (แดงถ้า: ถอด DATA_LOCK_FILES) · ไฟล์ที่ผู้ใช้แก้ค้าง/สร้างไว้ก่อนรัน → ไม่นับ (แดงถ้า: นับทุกไฟล์ที่ dirty)
//   6  เทสค้างเกินเพดาน → ถูกฆ่า + แดง "หมดเวลา" (แดงถ้า: ไม่มีเพดานเวลา — ด่าน pre-push ค้างไม่รู้จบ)
//   7  ★ รอบแก้ผู้ตรวจ (L1): ไฟล์ exit 0 แต่มีข้อ skip/todo → แดง "ห้าม skip" (แดงถ้า: ถอดการอ่าน # skipped/# todo)
//      · NEWS_TEST_ALLOW_SKIP=1 → ผ่านพร้อมคำเตือน (แดงถ้า: ถอดสวิตช์)
// ไม่ได้ตรวจ: เนื้อหาเทสข่าวแต่ละไฟล์ (เป็นหน้าที่ของไฟล์นั้นเอง) · การติดตั้ง hook (ดู news-prepush-gate.test.mjs)
// ไม่มี API/network/DB — ทุกไฟล์ชั่วคราวอยู่ใต้ mkdtemp(os.tmpdir()) และลบใน finally
// วิธีรัน: node --test tests/test-news-runner.test.mjs
// ทุบตัวรัน: TEST_NEWS_RUNNER_UNDER_TEST=<สำเนาที่แก้แล้ว.mjs> node --test tests/test-news-runner.test.mjs (ต้องแดง)
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNNER_PATH = process.env.TEST_NEWS_RUNNER_UNDER_TEST
  ? resolve(process.env.TEST_NEWS_RUNNER_UNDER_TEST)
  : join(ROOT, 'scripts', 'test-news.mjs');
const SUITE_PATH = join(ROOT, 'tests', 'news-suite.json');
const runner = await import(pathToFileURL(RUNNER_PATH).href);

// env ที่ปลอดภัยสำหรับ git/ตัวรันลูก — ไม่ให้ตัวแปรตำแหน่ง git จาก hook หลุดไปแตะ repo จริง
// + ตัดสวิตช์ของผู้รัน (NEWS_TEST_ALLOW_SKIP ฯลฯ) ออก ให้แต่ละข้อตั้งเอง — ไม่งั้นข้อ 7 เขียวปลอมเมื่อผู้รันเปิดสวิตช์ไว้
const baseEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX)$/i.test(k)) delete env[k];
    if (/^NEWS_TEST_(ALLOW_SKIP|FILE_TIMEOUT_MS)$/.test(k)) delete env[k];
  }
  return env;
};

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;

/** git ใน repo ชั่วคราว (ไม่ใช้ hook/config ของเครื่อง) */
function gitIn(root, ...args) {
  const r = spawnSync('git', ['-C', root, '-c', 'user.name=news-test', '-c', 'user.email=news-test@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${join(root, '.no-hooks')}`, ...args], { env: baseEnv(), encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function initRepo(root) {
  gitIn(root, 'init', '-q');
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-q', '-m', 'base');
}

function withTempRoot(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'news-runner-test-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }));
}

function writeFile(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}

function runCli(root, suite, { env = baseEnv(), extraArgs = [] } = {}) {
  const suitePath = join(root, 'suite.json');
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  const r = spawnSync(process.execPath, [RUNNER_PATH, '--suite', suitePath, '--root', root, ...extraArgs], {
    cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 180_000,
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const GREEN_TEST = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('เขียว', () => assert.equal(1 + 1, 2));\n";
const RED_TEST = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('แดงโดยตั้งใจ', () => assert.equal(1 + 1, 3));\n";

// ── 1) การลงทะเบียน ─────────────────────────────────────────────
test('1a news-suite ครอบทุกไฟล์เทสที่อ้างโมดูลข่าว (ไม่มีไฟล์หลุดทะเบียน) และ suite ถูกโครง', () => {
  const suite = runner.loadSuite(SUITE_PATH);
  const { errors } = runner.validateSuite(suite, ROOT);
  assert.deepEqual(errors, [], 'news-suite.json ผิดโครง');
  const detected = runner.detectNewsTests(ROOT, suite.detect);
  const unregistered = runner.findUnregistered(suite, detected);
  assert.deepEqual(unregistered, [], `ไฟล์เทสอ้างโมดูลข่าวแต่ไม่อยู่ใน include/exclude: ${unregistered.join(', ')}`);
  // ตัวจับต้องเห็นรูปที่ grep ผู้สำรวจพลาด: join(ROOT,'src',...) · app/api/auto · app/api/bot (กันตัวจับถอยจนผ่านแบบว่างเปล่า)
  for (const mustSee of [
    'tests/text-queue-handoff-contract.test.mjs', // join(ROOT, 'src', 'lib', 'services', 'queueService.js')
    'tests/workflow-init-contract.test.mjs', // join(ROOT, 'src', 'app', 'api', 'auto', 'process', 'route.js')
    'tests/archive-save-truth.test.mjs', // '../src/app/api/auto/process/route.js'
    'tests/bot-tracking-route.test.mjs', // '../src/app/api/bot/tracking/route.js'
  ]) {
    assert.ok(detected.includes(mustSee), `ตัวจับต้องเห็น ${mustSee}`);
  }
  // นโยบาย: เทสคลิปไม่อยู่ในด่านข่าว — ยกเว้นไฟล์ที่ระบุชื่อตรงนี้ (มีข้อเฝ้าฝั่งข่าว + เขียว · ย้ายเข้า include รอบแก้ผู้ตรวจ L2)
  // · ทุกไฟล์ใน include ต้องไม่อยู่ใน exclude
  const CLIP_FILES_GUARDING_NEWS = new Set(['tests/clip-golden-shared-clients.test.mjs']);
  const excluded = new Set(suite.exclude.map((e) => e.file));
  assert.deepEqual(suite.include.filter((f) => /\/clip-[^/]*$/.test(f) && !CLIP_FILES_GUARDING_NEWS.has(f)), [], 'ห้ามมีเทสคลิปใน include ของด่านข่าว');
  assert.deepEqual(suite.include.filter((f) => excluded.has(f)), []);
  for (const e of suite.exclude) assert.ok(['cover', 'clip'].includes(e.domain), `exclude ${e.file} ต้องระบุ domain cover/clip`);
});

test('1b ไฟล์เทสใหม่ที่ import โมดูลข่าว (path ตรง / join / alias @/) แต่ไม่ลงทะเบียน → ตัวจับเจอ', () => withTempRoot((root) => {
  const suite = runner.loadSuite(SUITE_PATH);
  writeFile(root, 'tests/zz-direct.test.mjs', "import '../src/lib/services/summarizeServiceText.js';\n");
  writeFile(root, 'tests/zz-join.test.mjs', "const p = join(ROOT, 'src', 'lib', 'correction', 'correctionPipeline.js');\n");
  writeFile(root, 'tests/zz-alias.test.mjs', "if (spec === '@/lib/ai/openai') return stub;\n");
  writeFile(root, 'tests/zz-route.test.mjs', "readFileSync(new URL('../src/app/api/queue/add/route.js', import.meta.url));\n");
  writeFile(root, 'tests/zz-cover-only.test.mjs', "import '../src/lib/megaAdapters.js';\n");
  const detected = runner.detectNewsTests(root, suite.detect);
  assert.deepEqual(detected, [
    'tests/zz-alias.test.mjs', 'tests/zz-direct.test.mjs', 'tests/zz-join.test.mjs', 'tests/zz-route.test.mjs',
  ]);
  assert.deepEqual(runner.findUnregistered(suite, detected), detected, 'ไฟล์ใหม่ทั้ง 4 ต้องถูกนับว่ายังไม่ลงทะเบียน');
}));

test('1c ตัวรันไม่ยอมรันเมื่อมีไฟล์เทสข่าวหลุดทะเบียน · ลงทะเบียนแล้ว (include หรือ exclude พร้อมเหตุผล) จึงผ่าน', () => withTempRoot((root) => {
  writeFile(root, 'tests/green.test.mjs', GREEN_TEST);
  writeFile(root, 'tests/zz-new-news.test.mjs', `// อ้าง '../src/lib/services/autoFlowServiceText.js'\n${GREEN_TEST}`);
  const detect = { dir: 'tests', patterns: ['autoFlowServiceText'] };
  const blocked = runCli(root, { detect, include: ['tests/green.test.mjs'], exclude: [] });
  assert.notEqual(blocked.code, 0, blocked.out);
  assert.match(blocked.out, /ยังไม่ลงทะเบียน: tests\/zz-new-news\.test\.mjs/);
  const viaInclude = runCli(root, { detect, include: ['tests/green.test.mjs', 'tests/zz-new-news.test.mjs'], exclude: [] });
  assert.equal(viaInclude.code, 0, viaInclude.out);
  const viaExclude = runCli(root, {
    detect,
    include: ['tests/green.test.mjs'],
    exclude: [{ file: 'tests/zz-new-news.test.mjs', domain: 'cover', reason: 'ทดสอบ: กันออกพร้อมเหตุผลยาวพอ' }],
  });
  assert.equal(viaExclude.code, 0, viaExclude.out);
  const noReason = runCli(root, { detect, include: ['tests/green.test.mjs'], exclude: [{ file: 'tests/zz-new-news.test.mjs', domain: 'cover', reason: '' }] });
  assert.notEqual(noReason.code, 0, 'exclude ไม่มีเหตุผลต้องไม่ผ่าน');
}));

// ── 2) เทสแดงต้องทำให้ด่านแดง ───────────────────────────────────────
test('2 suite ชั่วคราวมีเทสแดง 1 ไฟล์ → ตัวรัน exit ≠ 0 และบอกชื่อไฟล์ · ชุดเขียวล้วน → exit 0', () => withTempRoot((root) => {
  writeFile(root, 'tests/green.test.mjs', GREEN_TEST);
  writeFile(root, 'tests/red.test.mjs', RED_TEST);
  const mixed = runCli(root, { include: ['tests/green.test.mjs', 'tests/red.test.mjs'], exclude: [] });
  assert.notEqual(mixed.code, 0, `ต้องแดง:\n${mixed.out}`);
  assert.match(mixed.out, /❌ tests\/red\.test\.mjs/);
  assert.match(mixed.out, /✅ tests\/green\.test\.mjs/);
  assert.match(mixed.out, /ด่านเทสข่าวไม่ผ่าน/);
  const green = runCli(root, { include: ['tests/green.test.mjs'], exclude: [] });
  assert.equal(green.code, 0, `ชุดเขียวล้วนต้องผ่าน:\n${green.out}`);
  const missing = runCli(root, { include: ['tests/green.test.mjs', 'tests/no-such.test.mjs'], exclude: [] });
  assert.notEqual(missing.code, 0, 'include ชี้ไฟล์ที่ไม่มีต้องแดง (กันเทสถูกลบเงียบๆ)');
}));

// ── 3) ถอดคีย์จริง ────────────────────────────────────────────────
test('3 ตัวรันถอดคีย์ API/secret ก่อนส่งให้เทส (เทสเห็น undefined) แต่ตัวแปรธรรมดายังอยู่ · ไม่พิมพ์ค่าคีย์', () => withTempRoot((root) => {
  writeFile(root, 'tests/env-probe.test.mjs', [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('env ถูกถอดคีย์', () => {",
    "  for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY',",
    "    'NEXT_PUBLIC_SUPABASE_URL', 'DISCORD_API_SECRET', 'SERPER_API_KEY', 'DATABASE_URL', 'GH_TOKEN', 'GIT_DIR']) {",
    "    assert.equal(process.env[k], undefined, k + ' ต้องถูกถอด');",
    '  }',
    "  assert.equal(process.env.NEWS_RUNNER_PROBE, 'kept', 'ตัวแปรธรรมดาต้องผ่าน');",
    '  assert.ok(process.env.PATH || process.env.Path, "PATH ต้องอยู่");',
    '});',
    '',
  ].join('\n'));
  const FAKE = 'sk-fake-value-must-not-leak-1234567890';
  const env = {
    ...baseEnv(),
    OPENAI_API_KEY: FAKE, ANTHROPIC_API_KEY: FAKE, GEMINI_API_KEY: FAKE, GOOGLE_API_KEY: FAKE,
    SUPABASE_SERVICE_ROLE_KEY: FAKE, NEXT_PUBLIC_SUPABASE_URL: 'https://fake.supabase.co', DISCORD_API_SECRET: FAKE,
    SERPER_API_KEY: FAKE, DATABASE_URL: 'postgres://fake', GH_TOKEN: FAKE, NEWS_RUNNER_PROBE: 'kept',
    GIT_DIR: join(root, 'not-a-git-dir'), // hook ตั้ง GIT_DIR ได้ — ตัวรันต้องถอดก่อนเรียก git/เทส
  };
  const r = runCli(root, { include: ['tests/env-probe.test.mjs'], exclude: [] }, { env });
  assert.equal(r.code, 0, `เทสชั่วคราวต้องเห็นคีย์เป็น undefined:\n${r.out}`);
  assert.ok(!r.out.includes(FAKE), 'ห้ามพิมพ์ค่าคีย์ลง log');
  assert.match(r.out, /OPENAI_API_KEY/, 'ควรบอกชื่อตัวแปรที่ถอด (ชื่อเท่านั้น)');
  // หน่วยย่อย: ฟังก์ชันเดียวกับที่ตัวรันใช้
  const { env: cleaned } = runner.sanitizeEnv({ OPENAI_API_KEY: 'x', PATH: '/bin', HOME: '/h', TOKENIZERS_PARALLELISM: 'false' });
  assert.deepEqual(Object.keys(cleaned).sort(), ['HOME', 'PATH', 'TOKENIZERS_PARALLELISM']);
}));

// ── 4) เทสเขียนไฟล์ลง src ระหว่างรัน (CFG-14) — snapshot ข้ามแพลตฟอร์ม ─────────────────────
// ★ รอบแก้ผู้ตรวจ 24 ก.ย. 69 (H1): ข้อเดิม skip เมื่อ fs.watch recursive ใช้ไม่ได้ และบน Linux ตัวกันเงียบ — ตอนนี้ไม่มี skip ตามแพลตฟอร์ม
const LEFTOVER_REL = 'src/lib/ai/_legacy-under-test.tmp.mjs';
// แบบเทสรุ่นเก่า 4 ไฟล์ที่ไม่มี finally: import ล้ม = ไฟล์ค้างใน src ให้ next dev/build/lint หยิบไป
const LEAVES_SRC_TEST = [
  "import test from 'node:test';",
  "import { writeFileSync } from 'node:fs';",
  "test('เขียน src แล้วไม่ได้ลบ (import ล้มก่อนถึงบรรทัดลบ)', () => {",
  `  writeFileSync(new URL('../${LEFTOVER_REL}', import.meta.url), 'export const x = 1;');`,
  '});',
  '',
].join('\n');
// แบบเทสรุ่นเก่าที่ลบเองใน finally: ไฟล์หายก่อนจบ — git status มองไม่เห็น ต้องจับจาก mtime ของโฟลเดอร์
const TRANSIENT_SRC_TEST = [
  "import test from 'node:test';",
  "import { writeFileSync, rmSync } from 'node:fs';",
  "test('เขียน src ชั่วคราวแล้วลบเองใน finally', () => {",
  `  const url = new URL('../${LEFTOVER_REL}', import.meta.url);`,
  "  writeFileSync(url, 'export const x = 1;');",
  '  try { /* import(url) */ } finally { rmSync(url, { force: true }); }',
  '});',
  '',
].join('\n');

for (const mode of ['fs', 'git']) {
  const label = mode === 'fs' ? '4a ไม่มี git: เดินโฟลเดอร์ mtime+size' : '4b git work tree: git status';
  test(`${label} — เทสทิ้งไฟล์ใน src → แดงพร้อมชื่อไฟล์ · สร้างแล้วลบเอง → แดงจาก mtime โฟลเดอร์ · ไม่แตะ src → ผ่าน`,
    { skip: mode === 'git' && !gitAvailable && 'ไม่มี git' }, () => withTempRoot((root) => {
      writeFile(root, 'src/lib/ai/existing.js', 'export const y = 1;\n');
      writeFile(root, 'tests/leaves-src.test.mjs', LEAVES_SRC_TEST);
      writeFile(root, 'tests/transient-src.test.mjs', TRANSIENT_SRC_TEST);
      writeFile(root, 'tests/green.test.mjs', GREEN_TEST);
      if (mode === 'git') initRepo(root);
      const modeLine = mode === 'git' ? /ตรวจการแตะไฟล์ใน repo: git status/ : /ตรวจการแตะไฟล์ใน repo: เดินโฟลเดอร์/;
      const leftover = join(root, ...LEFTOVER_REL.split('/'));
      try {
        const left = runCli(root, { include: ['tests/leaves-src.test.mjs'], exclude: [] });
        assert.notEqual(left.code, 0, `ต้องแดงเพราะทิ้งไฟล์ใน src:\n${left.out}`);
        assert.match(left.out, modeLine, `ต้องตรวจด้วยโหมด ${mode}:\n${left.out}`);
        assert.match(left.out, /src\/lib\/ai\/_legacy-under-test\.tmp\.mjs/);
        assert.match(left.out, /ด่านเทสข่าวไม่ผ่าน/);
      } finally {
        rmSync(leftover, { force: true }); // เก็บกวาดไฟล์ที่เทสชั่วคราวทิ้งไว้ใน src ของ root ชั่วคราว
      }
      const transient = runCli(root, { include: ['tests/transient-src.test.mjs'], exclude: [] });
      assert.notEqual(transient.code, 0, `สร้างไฟล์ใน src แล้วลบเองก็ต้องแดง:\n${transient.out}`);
      assert.match(transient.out, /• src\/lib\/ai\/ .*สร้าง\/ลบ/);
      assert.equal(existsSync(leftover), false);
      const clean = runCli(root, { include: ['tests/green.test.mjs'], exclude: [] });
      assert.equal(clean.code, 0, `เทสที่ไม่แตะ src ต้องผ่าน:\n${clean.out}`);
      assert.match(clean.out, modeLine);
    }));
}

// ── 5) เทสทิ้งไฟล์/แก้ไฟล์ใน repo (git status ก่อน/หลัง) ─────────────────────────
const writesTest = (title, body) => [
  "import test from 'node:test';",
  "import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';",
  `test(${JSON.stringify(title)}, () => { ${body} });`,
  '',
].join('\n');

test('5 เทสทิ้งไฟล์/แก้ไฟล์ใน repo → แดง · data/ นับด้วย (low #3) · ไฟล์ล็อกข่าวถูกเขียน → แดงแม้แก้ค้างอยู่ก่อน · งานค้างของผู้ใช้ไม่นับ', { skip: !gitAvailable && 'ไม่มี git' }, () => withTempRoot((root) => {
  writeFile(root, 'tests/green.test.mjs', GREEN_TEST);
  writeFile(root, 'tests/leaves-file.test.mjs', writesTest('ทิ้งไฟล์ไว้',
    "mkdirSync(new URL('../reports/', import.meta.url), { recursive: true }); writeFileSync(new URL('../reports/leftover.json', import.meta.url), '{}');"));
  writeFile(root, 'tests/writes-data.test.mjs', writesTest('เขียน data/ แบบเซิร์ฟเวอร์',
    "writeFileSync(new URL('../data/runtime-cache.json', import.meta.url), '{}');"));
  writeFile(root, 'tests/writes-lock.test.mjs', writesTest('เขียนไฟล์ล็อกข่าว',
    "appendFileSync(new URL('../data/prompt-library.json', import.meta.url), '\\n');"));
  writeFile(root, 'data/prompt-library.json', '[]\n');
  writeFile(root, 'docs/user-notes.md', 'v1\n');
  writeFile(root, 'suite.json', '{}');
  initRepo(root);
  const run = (file) => runCli(root, { include: [file], exclude: [] });

  const leftover = run('tests/leaves-file.test.mjs');
  assert.notEqual(leftover.code, 0, `ต้องแดงเพราะทิ้งไฟล์:\n${leftover.out}`);
  assert.match(leftover.out, /ตรวจการแตะไฟล์ใน repo: git status/);
  assert.match(leftover.out, /reports\/leftover\.json/);
  rmSync(join(root, 'reports'), { recursive: true, force: true });

  const data = run('tests/writes-data.test.mjs');
  assert.notEqual(data.code, 0, `data/ ไม่ได้รับการยกเว้นแล้ว — ไฟล์ใหม่ใน data/ ต้องแดง:\n${data.out}`);
  assert.match(data.out, /data\/runtime-cache\.json/);
  rmSync(join(root, 'data', 'runtime-cache.json'), { force: true });

  const lock = run('tests/writes-lock.test.mjs');
  assert.notEqual(lock.code, 0, `ไฟล์ล็อกข่าวถูกเขียน ต้องแดง:\n${lock.out}`);
  assert.match(lock.out, /data\/prompt-library\.json/);
  gitIn(root, 'checkout', '--', 'data/prompt-library.json');

  // งานค้างของผู้ใช้ก่อนรัน (แก้ไฟล์ที่ track + ไฟล์ใหม่ที่ยังไม่ commit) → ไม่ใช่ขยะของเทส ต้องผ่าน
  writeFile(root, 'docs/user-notes.md', 'v2 — ผู้ใช้กำลังแก้\n');
  writeFile(root, 'docs/draft.md', 'ร่างที่ยังไม่ commit\n');
  const userWip = run('tests/green.test.mjs');
  assert.equal(userWip.code, 0, `ไฟล์ที่ผู้ใช้แก้ค้างอยู่ก่อนรันต้องไม่ถูกนับ:\n${userWip.out}`);

  // ไฟล์ล็อกที่แก้ค้างอยู่ก่อนรัน + เทสเขียนซ้ำ: git status คงเดิม ([ M] ทั้งก่อน/หลัง) → ต้องแดงจาก mtime/size ของไฟล์ล็อก
  writeFile(root, 'data/prompt-library.json', '[{"wip":true}]\n');
  const lockDirty = run('tests/writes-lock.test.mjs');
  assert.notEqual(lockDirty.code, 0, `ไฟล์ล็อกที่แก้ค้างอยู่แล้วถูกเทสเขียนซ้ำ ต้องแดง:\n${lockDirty.out}`);
  assert.match(lockDirty.out, /data\/prompt-library\.json\s+— ถูกเขียน/);
}));

// ── 6) เพดานเวลา ─────────────────────────────────────────────────
test('6 เทสค้างเกินเพดาน → ถูกฆ่าและนับแดง "หมดเวลา" (ด่าน pre-push ต้องไม่ค้างไม่รู้จบ)', () => withTempRoot((root) => {
  writeFile(root, 'tests/hang.test.mjs', "import test from 'node:test';\ntest('ค้าง', () => new Promise(() => { setInterval(() => {}, 1000); }));\n");
  const startedAt = Date.now();
  const r = runCli(root, { include: ['tests/hang.test.mjs'], exclude: [] }, { extraArgs: ['--timeout-ms', '2000'] });
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /หมดเวลา/);
  assert.ok(Date.now() - startedAt < 60_000, 'ต้องจบเร็วหลังชนเพดาน');
}));

// ── 7) ไฟล์ที่ผ่านด้วย skip/todo (L1) ───────────────────────────────────
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('7 ไฟล์ที่ exit 0 แต่มีข้อ skip/todo → แดง (news suite ห้าม skip) · NEWS_TEST_ALLOW_SKIP=1 → ผ่านพร้อมคำเตือน', () => withTempRoot((root) => {
  writeFile(root, 'tests/option-skip.test.mjs', "import test from 'node:test';\ntest('ข้อที่ถูกข้าม', { skip: 'เหตุผลทดสอบ' }, () => {});\ntest('ข้อจริง', () => {});\n");
  writeFile(root, 'tests/runtime-skip.test.mjs', "import test from 'node:test';\ntest('ข้ามตอนรัน', (t) => { t.skip('ไม่มีของให้ตรวจ'); });\n");
  writeFile(root, 'tests/todo.test.mjs', "import test from 'node:test';\ntest.todo('ยังไม่ได้เขียน');\n");
  writeFile(root, 'tests/green.test.mjs', GREEN_TEST);
  const files = ['tests/option-skip.test.mjs', 'tests/runtime-skip.test.mjs', 'tests/todo.test.mjs'];
  for (const file of files) {
    const r = runCli(root, { include: ['tests/green.test.mjs', file], exclude: [] });
    assert.notEqual(r.code, 0, `${file} ต้องแดง:\n${r.out}`);
    assert.match(r.out, new RegExp(`❌ ${escapeRe(file)} .*ห้าม skip`));
    assert.match(r.out, /✅ tests\/green\.test\.mjs/);
  }
  const allowed = runCli(root, { include: ['tests/green.test.mjs', ...files], exclude: [] }, { env: { ...baseEnv(), NEWS_TEST_ALLOW_SKIP: '1' } });
  assert.equal(allowed.code, 0, `NEWS_TEST_ALLOW_SKIP=1 ต้องผ่าน:\n${allowed.out}`);
  assert.match(allowed.out, /NEWS_TEST_ALLOW_SKIP=1/);
  for (const file of files) assert.match(allowed.out, new RegExp(`ผ่านด้วย skip/todo.*${escapeRe(file)}`));
  // หน่วยย่อย: อ่านบรรทัดสรุป "ตัวสุดท้าย" ที่ชิดซ้าย — log ของเทส/ผลตัวรันลูกที่เยื้องอยู่ในข้อความ assert ต้องไม่หลอก
  assert.deepEqual(runner.parseCounts('# skipped 9\n  # skipped 7\n# tests 2\n# skipped 1\n# todo 0\n'), { tests: 2, skipped: 1, todo: 0 });
}));
