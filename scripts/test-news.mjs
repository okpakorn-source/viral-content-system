#!/usr/bin/env node
/**
 * 🧪 ด่านรันเทสระบบข่าว (CFG-03) — scripts/test-news.mjs
 * ★ 23 ก.ย. 69 (แคมเปญแก้บั๊ก ข้อ 1 · เจ้าของอนุมัติ)
 * ─────────────────────────────────────────────────────────────
 * ปัญหาที่ปิด: ไม่มีขั้นไหนรัน `node --test tests/*` อัตโนมัติเลย (package.json ไม่มี "test" · prebuild รันแค่
 *   validate-workflow ที่ตรวจสตริง · pre-push ตรวจแค่รหัสอนุมัติ) → เทสข่าวแดงค้างบน main 16 วัน (7→23 ก.ย. 69)
 *   โดยไม่มีใครเห็น (restore 7 ก.ย. a313281c ย้อนการแก้เทส 2 ก.ย. ทิ้งไปเงียบๆ)
 *
 * ใช้:  npm run test:news                        (= node scripts/test-news.mjs)
 *       node scripts/test-news.mjs --list        ตรวจรายชื่อ/การลงทะเบียนอย่างเดียว ไม่รันเทส
 *       node scripts/test-news.mjs --jobs 4      รันขนาน 4 ไฟล์ (ค่าเริ่มต้น 1 = ทีละไฟล์)
 *       --suite <file.json> --root <dir>         ใช้ในเทสของตัวรันเอง (tests/test-news-runner.test.mjs)
 *       --timeout-ms <ms>                        เพดานต่อไฟล์ (ค่าเริ่มต้น 300000 · env NEWS_TEST_FILE_TIMEOUT_MS)
 *
 * สัญญา (เทสกัดจริงอยู่ที่ tests/test-news-runner.test.mjs):
 *   1. รายชื่ออยู่ที่ tests/news-suite.json เท่านั้น — include = รันจริง · exclude = {file, domain, reason}
 *      (เทสปก/คลิปที่ตัวจับติดมา + เทสแดงนอกระบบข่าว) · detect = ท่อนชื่อโมดูลข่าวที่ใช้จับไฟล์เทส
 *   2. ก่อนรัน: ตรวจ suite (ไฟล์ include มีจริง · ไม่ซ้ำ · include∩exclude ว่าง · exclude ต้องมีเหตุผล)
 *      + ตรวจการลงทะเบียน: ไฟล์เทสที่อ้างโมดูลข่าวตาม detect แต่ไม่อยู่ใน include/exclude → แดง
 *      (กันเทสข่าวใหม่หลุดด่านเงียบๆ — ต้องเลือกให้ชัดว่ารันหรือกันออกพร้อมเหตุผล)
 *   3. รันทีละไฟล์ด้วย `node --test --test-reporter=tap <file>` · cwd = root
 *      env ของเทส = env ปัจจุบันที่ "ถอด" คีย์ API/secret/ที่อยู่ DB ทั้งหมด (กันยิงโมเดล/DB จริงเสียเงิน)
 *      + ถอดตัวแปรตำแหน่ง git (GIT_DIR ฯลฯ ที่ hook ตั้งไว้) กันเทสที่เรียก git ไปแตะ repo จริง
 *      ไฟล์ที่ exit 0 แต่มีข้อ skip/todo (อ่านบรรทัดสรุป `# skipped N` / `# todo N`) = แดง — ด่านข่าวห้าม skip
 *      (ข้อที่ถูกข้าม = ข้อที่ไม่ได้ตรวจ) · ยอมชั่วคราวได้ด้วย env NEWS_TEST_ALLOW_SKIP=1 (พิมพ์เตือนทุกครั้ง)
 *   4. ★ รอบแก้ผู้ตรวจ 24 ก.ย. 69 (H1): ตรวจว่าเทสแตะไฟล์ใน repo ไหมด้วย snapshot ก่อน/หลังรัน — เหมือนกันทุกแพลตฟอร์ม
 *      (เดิมเฝ้า src ด้วย fs.watch recursive ซึ่ง Linux/CI ใช้ไม่ได้ = ตัวกัน CFG-14 เงียบบน CI) — แดงเมื่อ:
 *      (ก) git status ทั้ง repo ต่างกัน: รายการใหม่ · สถานะเปลี่ยน · รายการหาย (ไฟล์ที่แก้ค้างอยู่ก่อนรันและสถานะคงเดิม
 *          = งานของผู้ใช้ ไม่นับ) — ไม่มี git หรือ root ไม่ใช่รากของ work tree → ถอยเป็นเดินโฟลเดอร์เก็บ mtime+size
 *          ของทุกไฟล์ใต้ src/ + data/*.json
 *      (ข) mtime ของโฟลเดอร์ใต้ src เปลี่ยน = มีการสร้าง/ลบไฟล์ใต้ src (แม้เทสลบเองใน finally — git status มองไม่เห็น)
 *      (ค) ไฟล์ล็อกข่าวใน data/ (DATA_LOCK_FILES) mtime/size เปลี่ยน — จับแม้ไฟล์นั้นแก้ค้างอยู่ก่อนรัน
 *      data/ ไม่ได้รับการยกเว้นแล้ว (low #3) — เซิร์ฟเวอร์ dev ที่รันจาก worktree เดียวกันเขียน data/ ระหว่างรัน = แดง
 *      (ปิดเซิร์ฟเวอร์แล้วรันใหม่)
 *   5. พิมพ์ผลต่อไฟล์ + สรุป · exit 1 เมื่อแดงข้อใดข้อหนึ่ง (suite ผิด/ไม่ลงทะเบียน/เทสแดง/หมดเวลา/skip/แตะไฟล์ใน repo)
 * ไม่ได้ตรวจ: การแก้เนื้อไฟล์เดิมใต้ src แบบไม่สร้าง/ลบไฟล์แล้วคืนสถานะ git เดิมก่อนจบ ·
 *   ไฟล์ที่เทสเขียนซ้ำบนไฟล์ที่แก้ค้างอยู่ก่อนรัน (ยกเว้นไฟล์ล็อกใน data/) · ไฟล์ใน .gitignore (โหมด git) ·
 *   ไฟล์นอก src/ + data/*.json (โหมดไม่มี git)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), '..');
export const DEFAULT_SUITE_REL = 'tests/news-suite.json';
const DEFAULT_TIMEOUT_MS = 300_000;
const TAIL_LINES = 60;

// ── 1) env ที่ส่งให้เทส: ถอดคีย์/ความลับ ─────────────────────────────
// ชื่อที่ลงท้าย/มีท่อน KEY/TOKEN/SECRET/PASSWORD/CREDENTIALS/SERVICE_ROLE (เช่น OPENAI_API_KEY, GH_TOKEN)
const SECRET_NAME_RE = /(^|_)(API_?KEYS?|APIKEY|KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASSWD|CREDENTIALS?|SERVICE_ROLE)($|_)/i;
// provider/บริการที่ตัวแปรทั้งตระกูลชี้ของจริง (URL/รุ่น/โปรเจกต์) — ถอดทั้งตระกูล
const PROVIDER_PREFIXES = [
  'OPENAI_', 'ANTHROPIC_', 'CLAUDE_API', 'GEMINI_', 'GOOGLE_', 'VERTEX_', 'SUPABASE_', 'NEXT_PUBLIC_SUPABASE_',
  'DISCORD_', 'SERPER_', 'TAVILY_', 'FIRECRAWL_', 'APIFY_', 'DATABASE_', 'POSTGRES_', 'REDIS_', 'UPSTASH_',
  'KV_', 'BLOB_', 'VERCEL_', 'XAI_', 'GROQ_', 'MISTRAL_', 'COHERE_', 'DEEPSEEK_', 'OPENROUTER_', 'PERPLEXITY_',
  'HF_', 'HUGGINGFACE_', 'REPLICATE_', 'FAL_', 'BANNERBEAR_', 'CLOUDINARY_', 'YOUTUBE_', 'META_', 'FACEBOOK_',
  'FB_', 'TIKTOK_', 'RAPIDAPI_', 'SCRAPINGBEE_', 'BROWSERLESS_', 'AWS_', 'AZURE_',
];
const EXACT_NAMES = new Set(['DATABASE_URL', 'DIRECT_URL', 'REDIS_URL', 'PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT']);
// hook ของ git ตั้งตัวแปรเหล่านี้ได้ — ถ้าหลุดเข้าเทสที่เรียก git จะไปแตะ repo จริงแทน repo ชั่วคราว
const GIT_LOCATION_VARS = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_QUARANTINE_PATH',
]);

export function isSecretEnvName(name) {
  const upper = String(name).toUpperCase();
  if (EXACT_NAMES.has(upper) || GIT_LOCATION_VARS.has(upper)) return true;
  if (PROVIDER_PREFIXES.some((p) => upper.startsWith(p))) return true;
  return SECRET_NAME_RE.test(upper);
}

/** คืน env ใหม่ที่ถอดคีย์แล้ว (ไม่แตะ process.env) + รายชื่อที่ถอด (ชื่อเท่านั้น ห้ามพิมพ์ค่า) */
export function sanitizeEnv(base = process.env) {
  const env = {};
  const removed = [];
  for (const [name, value] of Object.entries(base)) {
    if (isSecretEnvName(name)) removed.push(name);
    else env[name] = value;
  }
  return { env, removed: removed.sort() };
}

// ── 2) suite + การลงทะเบียน ───────────────────────────────────────
const toPosix = (p) => String(p).replace(/\\/g, '/');

export function loadSuite(suitePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(suitePath, 'utf8'));
  } catch (err) {
    throw new Error(`อ่าน suite ไม่ได้ (${suitePath}): ${err.message}`);
  }
  return {
    include: Array.isArray(parsed.include) ? parsed.include.map(toPosix) : parsed.include,
    exclude: Array.isArray(parsed.exclude) ? parsed.exclude : parsed.exclude ?? [],
    detect: parsed.detect ?? null,
  };
}

/** ตรวจโครง suite → { errors, warnings } (errors ≠ ว่าง = แดง) */
export function validateSuite(suite, root) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(suite.include) || suite.include.length === 0) {
    errors.push('include ต้องเป็น array ที่มีอย่างน้อย 1 ไฟล์');
    return { errors, warnings };
  }
  if (!Array.isArray(suite.exclude)) errors.push('exclude ต้องเป็น array ของ {file, domain, reason}');
  const seen = new Set();
  for (const file of suite.include) {
    if (typeof file !== 'string' || !file.trim()) { errors.push(`include มีค่าที่ไม่ใช่ชื่อไฟล์: ${JSON.stringify(file)}`); continue; }
    if (seen.has(file)) errors.push(`include ซ้ำ: ${file}`);
    seen.add(file);
    const abs = isAbsolute(file) ? file : join(root, file);
    if (!existsSync(abs) || !statSync(abs).isFile()) errors.push(`include ชี้ไฟล์ที่ไม่มีอยู่: ${file}`);
  }
  const excluded = new Set();
  for (const entry of Array.isArray(suite.exclude) ? suite.exclude : []) {
    const file = toPosix(entry?.file ?? '');
    if (!file) { errors.push(`exclude มีรายการไม่มี file: ${JSON.stringify(entry)}`); continue; }
    if (excluded.has(file)) errors.push(`exclude ซ้ำ: ${file}`);
    excluded.add(file);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) errors.push(`exclude ต้องมีเหตุผล (≥10 ตัวอักษร): ${file}`);
    if (seen.has(file)) errors.push(`ไฟล์อยู่ทั้ง include และ exclude: ${file}`);
    if (!existsSync(isAbsolute(file) ? file : join(root, file))) warnings.push(`exclude ชี้ไฟล์ที่ไม่มีแล้ว (ลบรายการได้): ${file}`);
  }
  if (suite.detect != null) {
    const patterns = suite.detect?.patterns;
    if (!Array.isArray(patterns) || patterns.length === 0 || patterns.some((p) => typeof p !== 'string' || !p.trim())) {
      errors.push('detect.patterns ต้องเป็น array ของท่อน path โมดูลข่าว (string ไม่ว่าง)');
    }
  }
  return { errors, warnings };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ตัวคั่นท่อน path ที่ยอมรับ: '/' · '\' · หรือรูป join(ROOT, 'src', 'lib', ...) = ปิดคำพูด-จุลภาค-เปิดคำพูด
const SEGMENT_SEPARATOR = "(?:/|\\\\|['\"`]\\s*,\\s*['\"`])";

/** 'lib/ai/' → regex ที่จับ 'lib/ai/', 'lib\\ai\\', "'lib', 'ai', '" (ท่อนเดียว = ค้นชื่อตรงๆ แบบ grep) */
export function fragmentToRegExp(fragment) {
  const trailing = /[\\/]$/.test(fragment);
  const segments = toPosix(fragment).replace(/\/+$/, '').split('/').filter(Boolean);
  let body = segments.map(escapeRe).join(SEGMENT_SEPARATOR);
  if (trailing) body += SEGMENT_SEPARATOR;
  return new RegExp(body);
}

/** ไฟล์เทส (ชื่อสัมพัทธ์แบบ posix) ใน detect.dir ที่อ้างท่อนโมดูลข่าวข้อใดข้อหนึ่ง */
export function detectNewsTests(root, detect) {
  const dirRel = toPosix(detect?.dir || 'tests').replace(/\/+$/, '');
  const dirAbs = join(root, dirRel);
  if (!existsSync(dirAbs)) return [];
  const regs = (detect?.patterns || []).map(fragmentToRegExp);
  return readdirSync(dirAbs)
    .filter((name) => /\.test\.(mjs|cjs|js)$/.test(name))
    .sort()
    .filter((name) => {
      const source = readFileSync(join(dirAbs, name), 'utf8');
      return regs.some((re) => re.test(source));
    })
    .map((name) => `${dirRel}/${name}`);
}

/** ไฟล์ที่ตัวจับเจอแต่ยังไม่ถูกจัดเข้า include/exclude */
export function findUnregistered(suite, detected) {
  const known = new Set([
    ...(suite.include || []).map(toPosix),
    ...(suite.exclude || []).map((e) => toPosix(e?.file ?? '')),
  ]);
  return detected.filter((file) => !known.has(file));
}

// ── 3) รันเทส ─────────────────────────────────────────────────────
function killTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* ไม่มีโปรเซสแล้ว */ }
  }
}

// บรรทัดสรุปของ node --test อยู่ "ท้ายสุด" และชิดซ้าย (`# tests 5` แบบ tap · `ℹ tests 5` แบบ spec) — เอาตัวสุดท้าย
// ไม่เอาตัวแรก: console.log ของเทสโผล่เป็น `# ...` ก่อนสรุป และผลของตัวรันลูก (ในข้อความ assert) อยู่ในบล็อกที่เยื้อง
export function parseCounts(output) {
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const re = new RegExp(`^(?:#|ℹ)[ \\t]*${key}[ \\t]+(\\d+)[ \\t\\r]*$`, 'gm');
    let match;
    let last = null;
    while ((match = re.exec(output))) last = match;
    if (last) counts[key] = Number(last[1]);
  }
  return counts;
}

/** จำนวนข้อ skip+todo ของไฟล์ (จากบรรทัดสรุป) — >0 = ไฟล์ "ผ่าน" ทั้งที่มีข้อไม่ได้ตรวจ */
export const skippedOrTodo = (counts) => (counts.skipped || 0) + (counts.todo || 0);

export function runTestFile(file, { root, env, timeoutMs = DEFAULT_TIMEOUT_MS, allowSkip = false }) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const chunks = [];
    let timedOut = false;
    let child;
    // ตัวรันถูกเรียกจากใต้ node --test ได้ (เช่น tests/test-news-runner.test.mjs) → env มี NODE_TEST_CONTEXT ของพ่อ
    // ถ้าส่งต่อ `node --test` ลูกจะทำตัวเป็น "ลูกของตัวรันอื่น" (พ่นผลแบบ v8 + exit 0 แม้เทสแดง) = ด่านเขียวปลอม
    const childEnv = { ...env };
    delete childEnv.NODE_TEST_CONTEXT;
    try {
      child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], {
        cwd: root,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolvePromise({ file, ok: false, code: null, signal: null, timedOut: false, ms: 0, output: `spawn ล้ม: ${err.message}`, counts: {} });
      return;
    }
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const finish = (code, signal, extra = '') => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8') + extra;
      const counts = parseCounts(output);
      // ★ รอบแก้ผู้ตรวจ (L1): exit 0 แต่มีข้อ skip/todo = ไม่ผ่านด่านข่าว (เว้นแต่ NEWS_TEST_ALLOW_SKIP=1)
      const skipBlocked = code === 0 && !timedOut && !allowSkip && skippedOrTodo(counts) > 0;
      resolvePromise({
        file, ok: code === 0 && !timedOut && !skipBlocked, skipBlocked, code, signal, timedOut,
        ms: Date.now() - startedAt, output, counts,
      });
    };
    child.on('error', (err) => finish(null, null, `\nspawn error: ${err.message}`));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

async function runPool(files, jobs, worker) {
  const results = new Array(files.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(jobs, files.length)) }, async () => {
    while (next < files.length) {
      const index = next++;
      results[index] = await worker(files[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

// ── 4) ตรวจว่าเทสแตะไฟล์ใน repo ไหม: snapshot ก่อน/หลังรัน (ข้ามแพลตฟอร์ม · ไม่พึ่ง fs.watch) ──────────
// ★ รอบแก้ผู้ตรวจ 24 ก.ย. 69 (H1 + low #3) — ดูสัญญาข้อ 4 ที่หัวไฟล์ · ข้อสอบ tests/test-news-runner.test.mjs ข้อ 4/5
/** ไฟล์ล็อกข่าวใน data/ (อยู่ในรายการ PROTECTED ของ GOLDEN-LOCK) — ตรวจ mtime+size เสมอ แม้แก้ค้างอยู่ก่อนรัน */
export const DATA_LOCK_FILES = ['data/prompt-library.json', 'data/card-essences.json', 'data/viral-essences.json'];

/** 'size:mtimeNs' ของไฟล์ (null = ไม่มีไฟล์) — bigint กันความละเอียดเวลาหาย */
function fileFingerprint(abs) {
  try {
    const st = statSync(abs, { bigint: true });
    return st.isFile() ? `${st.size}:${st.mtimeNs}` : null;
  } catch {
    return null;
  }
}

/** เดินโฟลเดอร์เอง (ไม่ตามลิงก์): เก็บ mtime ของทุกโฟลเดอร์ (key ลงท้าย '/') และถ้า withFiles เก็บ fingerprint ของทุกไฟล์ */
function walkTree(root, relDir, snap, withFiles) {
  const abs = join(root, relDir);
  let entries;
  try {
    snap.dirs.set(`${relDir}/`, String(statSync(abs, { bigint: true }).mtimeNs));
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return; // ไม่มีโฟลเดอร์ / อ่านไม่ได้
  }
  for (const entry of entries) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) walkTree(root, rel, snap, withFiles);
    else if (withFiles && entry.isFile()) snap.files.set(rel, fileFingerprint(join(root, rel)));
  }
}

/**
 * git status ทั้ง repo → Map<path, XY> · null = ใช้โหมด git ไม่ได้ (ไม่มี git / root ไม่ใช่รากของ work tree —
 * เช่นโฟลเดอร์ชั่วคราวที่บังเอิญอยู่ใต้ repo อื่น: ห้ามไปอ่านสถานะ repo นั้น)
 */
export function gitStatusEntries(root, env) {
  const probe = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree', '--show-prefix'], { env, encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) return null;
  const [inside = '', prefix = ''] = probe.stdout.split(/\r?\n/);
  if (inside.trim() !== 'true' || prefix.trim() !== '') return null;
  const status = spawnSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '-z'], {
    env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (status.error || status.status !== 0) return null;
  const entries = new Map();
  const fields = status.stdout.split('\0');
  for (let k = 0; k < fields.length; k++) {
    const field = fields[k];
    if (field.length < 4) continue;
    const xy = field.slice(0, 2);
    entries.set(field.slice(3), xy);
    if (/[RC]/.test(xy)) k++; // -z: rename/copy มีชื่อเดิมตามมาอีกช่อง — ข้าม
  }
  return entries;
}

/**
 * snapshot ของ repo ณ ตอนนี้ → { mode: 'git'|'fs', git, files, dirs }
 *   git  : สถานะ git ทั้ง repo (โหมด git)
 *   files: โหมด git = เฉพาะ DATA_LOCK_FILES · โหมด fs = ทุกไฟล์ใต้ src/ + data/*.json (+ DATA_LOCK_FILES)
 *   dirs : mtime ของทุกโฟลเดอร์ใต้ src (ทั้งสองโหมด — จับสร้าง/ลบไฟล์ที่เทสลบเองทีหลัง)
 */
export function takeRepoSnapshot(root, env) {
  const git = gitStatusEntries(root, env);
  const snap = { mode: git ? 'git' : 'fs', git, files: new Map(), dirs: new Map() };
  walkTree(root, 'src', snap, !git);
  if (!git) {
    let dataEntries = [];
    try { dataEntries = readdirSync(join(root, 'data'), { withFileTypes: true }); } catch { /* ไม่มี data/ */ }
    for (const entry of dataEntries) {
      if (entry.isFile() && entry.name.endsWith('.json')) snap.files.set(`data/${entry.name}`, fileFingerprint(join(root, 'data', entry.name)));
    }
  }
  for (const rel of DATA_LOCK_FILES) snap.files.set(rel, fileFingerprint(join(root, rel)));
  return snap;
}

export function describeSnapshotMode(snap) {
  return snap.mode === 'git'
    ? 'git status ทั้ง repo + mtime โฟลเดอร์ใต้ src + ไฟล์ล็อก data/ (ไม่พึ่ง fs.watch)'
    : 'เดินโฟลเดอร์เก็บ mtime+size ไฟล์ใต้ src/ + data/*.json + mtime โฟลเดอร์ใต้ src (root ไม่ใช่รากของ git work tree / ไม่มี git)';
}

/** เทียบ snapshot ก่อน/หลัง → [{ path, what }] เรียงตาม path · ว่าง = เทสไม่ได้แตะ repo */
export function diffRepoSnapshots(before, after) {
  if (before.mode !== after.mode) {
    return [{ path: '(snapshot)', what: `โหมดตรวจเปลี่ยนระหว่างรัน ${before.mode} → ${after.mode} (เทสสร้าง/ลบ .git?)` }];
  }
  const changes = [];
  const reported = new Set();
  const add = (path, what) => { if (!reported.has(path)) { reported.add(path); changes.push({ path, what }); } };
  if (before.git && after.git) {
    for (const [path, xy] of after.git) {
      const was = before.git.get(path);
      if (was === undefined) add(path, `โผล่ใหม่ [${xy}]`);
      else if (was !== xy) add(path, `สถานะเปลี่ยน [${was}] → [${xy}]`);
    }
    for (const [path, xy] of before.git) if (!after.git.has(path)) add(path, `หายไป/ถูกย้อน (เดิม [${xy}])`);
  }
  for (const [path, now] of after.files) {
    const was = before.files.has(path) ? before.files.get(path) : null;
    if (was === now) continue;
    add(path, now === null ? 'ถูกลบ' : was === null ? 'ไฟล์ใหม่' : 'ถูกเขียน (mtime/size เปลี่ยน)');
  }
  for (const [path, was] of before.files) if (!after.files.has(path) && was !== null) add(path, 'ถูกลบ');
  const namedFiles = [...reported];
  const dirChanged = [];
  for (const [dir, mtime] of after.dirs) if (before.dirs.get(dir) !== mtime) dirChanged.push(dir);
  for (const dir of before.dirs.keys()) if (!after.dirs.has(dir)) dirChanged.push(dir);
  for (const dir of dirChanged) {
    if (namedFiles.some((path) => path.startsWith(dir))) continue; // มีรายชื่อไฟล์ใต้โฟลเดอร์นั้นแล้ว ไม่ต้องซ้ำ
    add(dir, 'มีการสร้าง/ลบไฟล์ในโฟลเดอร์นี้ระหว่างรัน (mtime โฟลเดอร์เปลี่ยน — นับแม้เทสลบไฟล์เองแล้ว)');
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;

function describeCounts(counts) {
  if (counts.tests == null) return '';
  const parts = [`pass ${counts.pass ?? 0}/${counts.tests}`];
  if (counts.fail) parts.push(`fail ${counts.fail}`);
  if (counts.cancelled) parts.push(`cancelled ${counts.cancelled}`);
  if (counts.skipped) parts.push(`skipped ${counts.skipped}`);
  if (counts.todo) parts.push(`todo ${counts.todo}`);
  return parts.join(' · ');
}

/** บรรทัด TAP ของข้อที่ถูกข้าม (`ok N - ชื่อ # SKIP เหตุผล` / `# TODO`) — ไว้บอกว่าข้อไหนไม่ได้ตรวจ */
const skipLines = (output) => output.split(/\r?\n/).filter((line) => /^\s*(?:not )?ok \d+ - .*#\s*(?:SKIP|TODO)\b/i.test(line));

function parseArgs(argv) {
  const opts = { list: false, jobs: 1, timeoutMs: Number(process.env.NEWS_TEST_FILE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`ต้องระบุค่าหลัง ${arg}`);
      return v;
    };
    if (arg === '--list') opts.list = true;
    else if (arg === '--suite') opts.suite = value();
    else if (arg === '--root') opts.root = value();
    else if (arg === '--jobs') opts.jobs = Math.max(1, Number.parseInt(value(), 10) || 1);
    else if (arg === '--timeout-ms') opts.timeoutMs = Math.max(1000, Number.parseInt(value(), 10) || DEFAULT_TIMEOUT_MS);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`ไม่รู้จักตัวเลือก: ${arg}`);
  }
  return opts;
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return 1;
  }
  if (opts.help) {
    console.log('ใช้: node scripts/test-news.mjs [--list] [--jobs N] [--timeout-ms MS] [--suite FILE --root DIR]');
    return 0;
  }
  const root = resolve(opts.root || DEFAULT_ROOT);
  const suitePath = opts.suite ? resolve(opts.suite) : join(root, DEFAULT_SUITE_REL);

  console.log('🧪 ด่านเทสระบบข่าว (scripts/test-news.mjs)');
  console.log(`   root: ${root}`);
  console.log(`   suite: ${suitePath}`);

  let suite;
  try {
    suite = loadSuite(suitePath);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return 1;
  }
  const { errors, warnings } = validateSuite(suite, root);
  for (const w of warnings) console.log(`⚠️  ${w}`);
  let unregistered = [];
  if (errors.length === 0 && suite.detect) {
    unregistered = findUnregistered(suite, detectNewsTests(root, suite.detect));
  }
  if (errors.length || unregistered.length) {
    console.error('❌ รายชื่อเทสข่าว (suite) ไม่ผ่าน — ยังไม่รันเทส:');
    for (const e of errors) console.error(`   • ${e}`);
    for (const f of unregistered) {
      console.error(`   • ไฟล์เทสอ้างโมดูลข่าวแต่ยังไม่ลงทะเบียน: ${f}`);
    }
    if (unregistered.length) {
      console.error(`   → เพิ่มเข้า "include" (ถ้าเป็นเทสข่าว) หรือ "exclude" พร้อม domain/reason (ถ้าเป็นเทสปก/คลิป) ใน ${DEFAULT_SUITE_REL}`);
    }
    return 1;
  }

  const { env, removed } = sanitizeEnv(process.env);
  console.log(`   ไฟล์ที่จะรัน: ${suite.include.length} · กันออก (exclude): ${suite.exclude.length}`);
  console.log(`   env: ถอดคีย์/ความลับ/ตัวแปรตำแหน่ง git ${removed.length} ตัว${removed.length ? ` (${removed.join(', ')})` : ''} — เทสยิงโมเดล/DB จริงไม่ได้`);
  if (opts.list) {
    for (const f of suite.include) console.log(`   • ${f}`);
    console.log('✅ รายชื่อผ่าน (--list: ไม่รันเทส)');
    return 0;
  }

  const allowSkip = process.env.NEWS_TEST_ALLOW_SKIP === '1';
  const before = takeRepoSnapshot(root, env);
  console.log(`   ตรวจการแตะไฟล์ใน repo: ${describeSnapshotMode(before)}`);
  if (allowSkip) console.log('   ⚠️  NEWS_TEST_ALLOW_SKIP=1 — ยอมให้ไฟล์ที่มีข้อ skip/todo ผ่าน (ชั่วคราวเท่านั้น)');
  const startedAt = Date.now();
  const results = await runPool(suite.include, opts.jobs, async (file) => {
    const result = await runTestFile(file, { root, env, timeoutMs: opts.timeoutMs, allowSkip });
    const tag = result.ok ? '✅' : '❌';
    const why = result.timedOut ? `หมดเวลา ${fmtMs(opts.timeoutMs)}`
      : result.skipBlocked ? `skip/todo ${skippedOrTodo(result.counts)} ข้อ — ด่านข่าวห้าม skip`
      : (result.ok ? '' : `exit ${result.code ?? result.signal}`);
    const detail = [describeCounts(result.counts), why, fmtMs(result.ms)].filter(Boolean).join(' · ');
    console.log(`${tag} ${file}  (${detail})`);
    if (result.skipBlocked) {
      for (const line of skipLines(result.output)) console.log(`      ↳ ${line.trim()}`);
    } else if (!result.ok) {
      const tail = result.output.split(/\r?\n/).slice(-TAIL_LINES).join('\n');
      console.log(`----- ${file} (ท้าย ${TAIL_LINES} บรรทัด) -----\n${tail}\n----- จบ ${file} -----`);
    }
    return result;
  });

  const after = takeRepoSnapshot(root, env);
  const touched = diffRepoSnapshots(before, after);
  const failed = results.filter((r) => !r.ok);
  const skippedAllowed = allowSkip ? results.filter((r) => r.ok && skippedOrTodo(r.counts) > 0) : [];

  console.log('\n📊 สรุปด่านเทสข่าว');
  console.log(`   ${results.length} ไฟล์ · ✅ ${results.length - failed.length} · ❌ ${failed.length} · ⏱ ${fmtMs(Date.now() - startedAt)}`);
  if (touched.length) {
    console.log('❌ เทสแตะไฟล์ใน repo ระหว่างรัน (snapshot ก่อน/หลังต่างกัน — CFG-14):');
    for (const c of touched) console.log(`   • ${c.path}  — ${c.what}`);
    console.log('   → เทสต้องเขียนไฟล์ชั่วคราวใต้ os.tmpdir() (mkdtemp) และลบใน finally เท่านั้น ·'
      + ' โหลดซอร์สที่ patch ผ่าน tests/helpers/temp-module.mjs แทนการเขียนลง src');
    if (touched.some((c) => c.path.startsWith('data/'))) {
      console.log('   → data/ นับด้วย (ไฟล์ล็อกข่าวอยู่ที่นี่) — ถ้าเป็นเซิร์ฟเวอร์ dev ที่รันจาก worktree เดียวกันเขียน ให้ปิดเซิร์ฟเวอร์แล้วรันใหม่');
    }
  }
  if (skippedAllowed.length) {
    console.log(`⚠️  ไฟล์ที่ผ่านด้วย skip/todo (ยอมเพราะ NEWS_TEST_ALLOW_SKIP=1): ${skippedAllowed.map((r) => r.file).join(', ')}`);
  }
  if (failed.length) {
    console.log('❌ ไฟล์ที่แดง:');
    for (const r of failed) {
      console.log(`   • ${r.file}${r.timedOut ? ' (หมดเวลา)' : r.skipBlocked ? ' (มีข้อ skip/todo — news suite ห้าม skip)' : ''}`);
    }
    console.log('   รันซ้ำทีละไฟล์: node --test <ไฟล์> · แก้ที่ต้นเหตุ — ห้ามแก้ src เพื่อให้เทสผ่านโดยไม่เข้าใจสาเหตุ');
    if (failed.some((r) => r.skipBlocked)) {
      console.log('   ข้อที่ถูกข้าม = ข้อที่ไม่ได้ตรวจ: ทำให้รันจริง หรือย้ายไฟล์ไป exclude พร้อมเหตุผล · ยอมชั่วคราว: NEWS_TEST_ALLOW_SKIP=1');
    }
  }
  const ok = failed.length === 0 && touched.length === 0;
  console.log(ok ? '✅ ด่านเทสข่าวผ่านทั้งหมด' : '❌ ด่านเทสข่าวไม่ผ่าน');
  return ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (invokedPath && samePath(invokedPath, SCRIPT_PATH)) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(`❌ ตัวรันเทสข่าวล้ม: ${err?.stack || err}`); process.exitCode = 1; },
  );
}
