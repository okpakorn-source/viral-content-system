/**
 * 🧰 scripts/research-tools/_common.mjs — ตัวช่วยร่วมของเข็มขัดเครื่องมือรีเสิร์ช (SPEC-v2 ส่วน 5)
 * ─────────────────────────────────────────────────────────────────────────────
 * - รากโปรเจกต์: env RESEARCH_TOOLS_REPO_ROOT (worker ส่งให้) → ไม่มี = สองชั้นเหนือไฟล์นี้
 *   (tools/ ในโฟลเดอร์งานเป็น junction มาที่ไฟล์จริง → import.meta.url ชี้ repo อยู่แล้ว · โหมดสำเนาพึ่ง env)
 * - คีย์: ใช้ค่าใน env ก่อน · ขาดตัวไหนอ่านเฉพาะชื่อนั้นจาก <ราก>/.env.local (util.parseEnv — ไม่ยกทั้งไฟล์เข้า env)
 *   เพราะ Codex อาจกรองตัวแปรที่ชื่อมีคำว่า KEY หรือ TOKEN ออกจากเชลล์ของเอเจนต์
 * - อินพุต: argv ง่ายๆ หรือ --input <file.json> (บทเรียนแล็บ: PowerShell ทำ JSON/ภาษาไทยใน argv พัง)
 * - เอาต์พุต: JSON บรรทัดเดียวทาง stdout · exit 0 สำเร็จ · 1 ล้ม (stdout = {ok:false,...}) · 2 ใช้ผิด (stderr)
 * - ห้ามพิมพ์คีย์: ข้อความ error ทุกอันผ่าน redact() (ปิดค่าจริงของคีย์ที่โหลด + รูปแบบโทเคนทั่วไป)
 * - console.* ของ service เดิมถูกย้ายไป stderr (quietConsole) ให้ stdout เป็น JSON ล้วน
 */
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export class UsageError extends Error {}

/** ไฟล์บอกรากโปรเจกต์ที่ worker เขียนไว้ข้างเครื่องมือ (โหมดสำเนา — เผื่อเชลล์ของเอเจนต์ไม่ส่ง env ต่อ) */
export const REPO_ROOT_MARKER = '.repo-root';

/** รากโปรเจกต์ (มี package.json): env RESEARCH_TOOLS_REPO_ROOT → ไฟล์ .repo-root ข้างเครื่องมือ → สองชั้นเหนือไฟล์นี้ */
export function repoRoot(env = process.env) {
  const ok = (p) => !!p && fs.existsSync(path.join(p, 'package.json'));
  const fromEnv = String(env.RESEARCH_TOOLS_REPO_ROOT || '').trim();
  if (ok(fromEnv)) return path.resolve(fromEnv);
  let fromMarker = '';
  try { fromMarker = fs.readFileSync(path.join(HERE, REPO_ROOT_MARKER), 'utf8').trim(); } catch { fromMarker = ''; }
  if (ok(fromMarker)) return path.resolve(fromMarker);
  return path.resolve(HERE, '..', '..');
}

const loadedSecretValues = new Set();

/** เติมคีย์ที่ขาดจาก .env.local ของ repo (เฉพาะชื่อที่ขอ) — คืนชื่อที่ยังขาดอยู่ */
export function ensureKeys(names, { env = process.env, root = repoRoot(env), readFile = fs.readFileSync } = {}) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) {
    let parsed = {};
    try { parsed = util.parseEnv(String(readFile(path.join(root, '.env.local'), 'utf8'))); } catch { parsed = {}; }
    for (const n of missing) if (parsed[n]) env[n] = parsed[n];
  }
  for (const n of names) if (env[n]) loadedSecretValues.add(String(env[n]));
  return names.filter((n) => !env[n]);
}

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, /\bAIza[0-9A-Za-z_-]{20,}/g, /\bapify_api_[A-Za-z0-9]{10,}/g,
  /(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  /((?:api[_-]?key|apikey|token|key|secret)=)[^\s&"']{8,}/gi,
];
/** ปิดค่าคีย์ในข้อความ (ค่าจริงที่โหลด + รูปแบบโทเคนทั่วไป) */
export function redact(text, extraSecrets = []) {
  let s = String(text == null ? '' : text);
  for (const v of [...loadedSecretValues, ...extraSecrets]) {
    if (v && v.length >= 8 && s.includes(v)) s = s.split(v).join('[REDACTED]');
  }
  for (const re of TOKEN_PATTERNS) {
    s = s.replace(re, (m, lead) => (typeof lead === 'string' && m.startsWith(lead) ? `${lead}[REDACTED]` : '[REDACTED]'));
  }
  return s;
}

/**
 * แยกอาร์กิวเมนต์: ตำแหน่ง (_), ธง boolean, ตัวเลือกที่มีค่า (ซ้ำได้ → array), --input <file.json> (รวมทับ)
 * @param {string[]} argv
 * @param {{flags?:string[], options?:string[], multi?:string[], readFile?:Function}} spec
 */
export function parseArgs(argv, { flags = [], options = [], multi = [], readFile = fs.readFileSync } = {}) {
  const out = { _: [] };
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '--input') {
      const file = args[++i];
      if (!file) throw new UsageError('--input ต้องตามด้วยไฟล์ JSON');
      let j;
      try { j = JSON.parse(String(readFile(path.resolve(String(file)), 'utf8')).replace(/^\uFEFF/, '')); } catch (e) {
        throw new UsageError(`อ่าน --input ไม่ได้ (${String(e && e.message).slice(0, 80)}) — ไฟล์ต้องเป็น JSON UTF-8`);
      }
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new UsageError('--input ต้องเป็น JSON object');
      Object.assign(out, j);
      continue;
    }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (flags.includes(name)) { out[name] = true; continue; }
      if (options.includes(name) || multi.includes(name)) {
        const v = args[++i];
        if (v === undefined) throw new UsageError(`--${name} ต้องมีค่า`);
        if (multi.includes(name)) (out[name] = Array.isArray(out[name]) ? out[name] : []).push(String(v));
        else out[name] = String(v);
        continue;
      }
      throw new UsageError(`ไม่รู้จักตัวเลือก ${a}`);
    }
    out._.push(a);
  }
  return out;
}

/** จำนวนเต็มในช่วง (อ่านไม่ได้ = ค่าเริ่มต้น) */
export function intIn(v, min, max, def) {
  const n = parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** URL http(s) */
export function isHttpUrl(v) {
  try { const u = new URL(String(v)); return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname; } catch { return false; }
}

/** ย้าย console.log/info/debug/warn ของโมดูลเดิมไป stderr — stdout ต้องเป็น JSON ล้วน */
export function quietConsole() {
  const toErr = (...a) => { try { process.stderr.write(`${a.map((x) => (typeof x === 'string' ? x : util.inspect(x, { depth: 1 }))).join(' ')}\n`); } catch { /* ไม่สำคัญ */ } };
  console.log = toErr; // eslint-disable-line no-console -- ตั้งใจเปลี่ยนปลายทาง log ของ service เดิม
  console.info = toErr; // eslint-disable-line no-console
  console.debug = toErr; // eslint-disable-line no-console
  console.warn = toErr;
}

let aliasRegistered = false;
/**
 * ให้ import '@/...' ของ src ใช้ได้ + cwd = ราก repo (service เดิมหา bin/yt-dlp.exe และ data/ จาก cwd)
 * ตัวแปลง = _alias-hooks.mjs (ตรรกะเดียวกับ scripts/_alias-loader.mjs + รองรับโฟลเดอร์ชื่อไทย)
 */
export function useRepoRuntime(root = repoRoot()) {
  process.chdir(root);
  if (!aliasRegistered) {
    register(pathToFileURL(path.join(HERE, '_alias-hooks.mjs')).href, { parentURL: import.meta.url, data: { root } });
    aliasRegistered = true;
  }
  return root;
}

/** import ไฟล์ใน repo ด้วย path เต็ม (ใช้ได้ทั้งโหมด junction และสำเนา) */
export function importFromRepo(rel, root = repoRoot()) {
  return import(pathToFileURL(path.join(root, ...rel.split('/'))).href);
}

/** fetch พร้อมเพดานเวลา (ไม่ใส่คีย์ใน URL — ส่งทาง header เสมอ) */
export async function fetchJson(fetchImpl, url, { method = 'GET', headers = {}, body, timeoutMs = 20_000 } = {}) {
  const r = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch { data = null; }
  return { ok: r.ok, status: r.status, data, text };
}

/** ตัดสตริงยาวใน object (ซ้อนได้) */
export function trimDeep(v, max = 1500, depth = 0) {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…` : v;
  if (Array.isArray(v)) return depth > 4 ? '[…]' : v.slice(0, 30).map((x) => trimDeep(x, max, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 4) return '{…}';
    return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, trimDeep(x, max, depth + 1)]));
  }
  return v;
}

/** true เมื่อไฟล์นี้ถูกรันตรง (รองรับ junction: เทียบ realpath) */
export function isMain(metaUrl) {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return pathToFileURL(fs.realpathSync(argv1)).href === metaUrl || pathToFileURL(path.resolve(argv1)).href === metaUrl;
  } catch {
    return false;
  }
}

/**
 * ตัวรันมาตรฐานของเครื่องมือ: parse → run → พิมพ์ JSON → exit code
 * @param {string} metaUrl  import.meta.url ของเครื่องมือ
 * @param {(argv:string[]) => Promise<object>} runFn
 * @param {string} usage
 */
export async function runTool(metaUrl, runFn, usage) {
  if (!isMain(metaUrl)) return;
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { process.stderr.write(`${usage}\n`); process.exitCode = 2; return; }
  try {
    const res = await runFn(argv);
    process.stdout.write(`${JSON.stringify(res)}\n`);
    process.exitCode = res && res.ok === false ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`${redact(e.message)}\n${usage}\n`);
      process.exitCode = 2;
      return;
    }
    const msg = redact(String((e && e.message) || e)).slice(0, 400);
    process.stdout.write(`${JSON.stringify({ ok: false, error: msg, errorType: (e && e.errorType) || 'TOOL_ERROR' })}\n`);
    process.exitCode = 1;
  }
}
