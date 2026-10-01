/**
 * 🤖 scripts/research-agent/codexRunner.mjs — รัน Codex CLI (gpt-6-astra) เป็นเอเจนต์รีเสิร์ช 1 รอบ (SPEC-v2 ส่วน 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * คำสั่ง (ตามสเปกทุกธง):
 *   codex exec --skip-git-repo-check -C <workdir> -s danger-full-access --ephemeral -m gpt-6-astra
 *     -c model_reasoning_effort="low" -c approvals_reviewer="auto_review" -c approval_policy="on-request" -o <outfile> -
 *   (ไม่ใส่ --ignore-user-config — เอเจนต์ต้องใช้ปลั๊กอินเบราว์เซอร์ใน config.toml ของบัญชี ·
 *    approvals_reviewer/approval_policy คือกับดักข้อ 1 ของ astra ในโหมด exec: ไม่ตั้ง = ทุกคำสั่งถูกปัด)
 * ยืมโครงจาก src/lib/services/clipBrain/brainRunner.js (คัดลอกเฉพาะที่ใช้ ไม่ import ตรง — ไฟล์นั้นเป็นของสายคลิป):
 *   spawn shell:false · .cmd บน Windows เรียกผ่าน cmd.exe ที่เราประกอบบรรทัดเองทุกชิ้นผ่านด่านอักขระ ·
 *   พรอมต์ทาง stdin UTF-8 · เพดาน stdout/stderr · หมดเวลา = taskkill /T /F ทั้งต้นไม้ + ตาข่ายจบเอง 5 วิ ·
 *   env ลูก = รายชื่อปิด · ไม่โยน error (ทุกทางคืน {ok:false, errorType})
 * env ลูก: ระบบปฏิบัติการ (PATH/SYSTEMROOT/TEMP/โปรไฟล์ผู้ใช้ …) + คีย์เครื่องมือตามสเปก ยกเว้น OPENAI_API_KEY
 *   (codex-auto.ps1/add-codex-account.ps1 ของเจ้าของถอดตัวนี้ทุกครั้ง กัน Codex คิดเงินแบบ API แทนโควตา subscription —
 *    เครื่องมือ web-agent อ่านคีย์จาก .env.local ของ repo เองผ่าน RESEARCH_TOOLS_REPO_ROOT)
 *   + CODEX_HOME เฉพาะบัญชีที่ไม่ใช่ main (main = โฟลเดอร์ปกติของ CLI · ค่า CODEX_HOME ที่ติดมากับ worker ถูกทิ้ง)
 * ไม่อ้างตำแหน่งไฟล์ตัวเอง — ทุกอย่างที่แตะระบบฉีดได้ (spawnImpl/killTreeImpl/setTimer/clearTimer/resolveExe/fs) เพื่อเทสด้วย child ปลอม
 */
import { spawn as nodeSpawn } from 'node:child_process';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_MODEL = 'gpt-6-astra';
export const RESULT_FILE = 'result.json';
export const LAST_MESSAGE_FILE = 'last-message.txt';
const OUT_CAP = 4 * 1024 * 1024;
const ERR_CAP = 512 * 1024;

/** env ของระบบที่ลูกต้องมี (ไม่ใช่ความลับ) — ตัดแล้ว CLI/PowerShell/ปลั๊กอินหาโปรไฟล์/โฟลเดอร์ชั่วคราวไม่เจอ */
export const CHILD_ENV_OS = Object.freeze([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR', 'TEMP', 'TMP',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432', 'ALLUSERSPROFILE', 'PUBLIC', 'OS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER',
  'NUMBER_OF_PROCESSORS', 'PSMODULEPATH', 'LANG', 'LC_ALL',
]);
/** คีย์เครื่องมือที่สเปกส่วน 4 อนุญาตให้ลูก (OPENAI_API_KEY ตั้งใจไม่อยู่ในนี้ — ดูหัวไฟล์) */
export const CHILD_ENV_TOOL_KEYS = Object.freeze([
  'SERPER_API_KEY', 'JINA_API_KEY', 'FIRECRAWL_API_KEY', 'APIFY_API_TOKEN', 'TAVILY_API_KEY',
  'YOUTUBE_API_KEY', 'SUPADATA_API_KEY', 'GEMINI_API_KEY', 'SERPAPI_KEY',
]);
/** ชื่อที่ห้ามผ่านแม้ผู้เรียกขอเพิ่ม (passEnv) — ความลับระบบ/ฐานข้อมูล/บอท/โมเดล */
const DENY_EXTRA = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|COOKIE|AUTH|SESSION|PRIVATE|SUPABASE|DISCORD|DATABASE/i;

const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SAFE_PATH = /^[\p{L}\p{M}\p{N}\\/:. _\-~()]+$/u;
const SAFE_ACCOUNT = /^[A-Za-z0-9_]{1,32}$/;
const EFFORTS = new Set(['low', 'medium']);
/** ค่าตั้ง -c ที่อนุญาต (คงที่) — ใส่ " แบบ TOML ได้เฉพาะชุดนี้ */
const FIXED_CONFIG = /^(?:model_reasoning_effort="(?:low|medium)"|approvals_reviewer="auto_review"|approval_policy="on-request")$/;

class BadArgError extends Error {}

/** โฟลเดอร์บัญชี Codex: main = ~/.codex · ตัวอักษร x = ~/.codex-x · path เต็ม = ใช้ตามนั้น */
export function resolveCodexHome(account, homeDir = os.homedir()) {
  const a = String(account || 'main').trim();
  if (!a || a === 'main' || a === 'default') return path.join(homeDir, '.codex');
  if (/[\\/]/.test(a)) return path.resolve(a);
  if (!SAFE_ACCOUNT.test(a)) throw new BadArgError(`ชื่อบัญชีผิดรูป: ${a.slice(0, 40)}`);
  return path.join(homeDir, `.codex-${a}`);
}

/** อาร์กิวเมนต์ codex exec ตามสเปก — ทุกชิ้นผ่านด่านอักขระ (โยน BadArgError ถ้าไม่ผ่าน) */
export function buildCodexArgs({ workdir, outFile, model = CODEX_MODEL, effort = 'low' }) {
  if (!SAFE_MODEL.test(String(model))) throw new BadArgError(`ชื่อรุ่นผิดรูป: ${String(model).slice(0, 40)}`);
  if (!EFFORTS.has(effort)) throw new BadArgError(`effort ต้องเป็น low|medium: ${String(effort).slice(0, 20)}`);
  for (const [label, p] of [['workdir', workdir], ['outFile', outFile]]) {
    if (typeof p !== 'string' || !p || !SAFE_PATH.test(p)) throw new BadArgError(`${label} มีอักขระต้องห้าม: ${String(p).slice(0, 80)}`);
  }
  return [
    'exec', '--skip-git-repo-check', '-C', workdir, '-s', 'danger-full-access', '--ephemeral',
    '-m', model,
    '-c', `model_reasoning_effort="${effort}"`,
    '-c', 'approvals_reviewer="auto_review"',
    '-c', 'approval_policy="on-request"',
    '-o', outFile,
    '-',
  ];
}

/**
 * env ของโปรเซสลูก (รายชื่อปิด)
 * @param {object} p
 * @param {object} [p.baseEnv]   env ของ worker
 * @param {string|null} [p.codexHome]  ตั้ง CODEX_HOME (null = ไม่ตั้ง = บัญชี main)
 * @param {string} [p.repoRoot]  ให้เครื่องมือหา .env.local/src ของ repo
 * @param {string[]} [p.passEnv] ชื่อเพิ่มเติมที่ยอมส่ง (ชื่อที่หน้าตาเป็นความลับถูกปฏิเสธเสมอ)
 */
export function buildChildEnv({ baseEnv = process.env, codexHome = null, repoRoot = '', passEnv = [] } = {}) {
  const allow = new Set([...CHILD_ENV_OS, ...CHILD_ENV_TOOL_KEYS]);
  const extra = new Set((passEnv || []).map((s) => String(s).trim().toUpperCase()).filter((s) => s && !DENY_EXTRA.test(s)));
  const out = {};
  for (const k of Object.keys(baseEnv || {})) {
    const K = k.toUpperCase();
    if (allow.has(K) || extra.has(K)) {
      const v = baseEnv[k];
      if (v !== undefined && v !== null && v !== '') out[k] = String(v);
    }
  }
  if (codexHome) out.CODEX_HOME = String(codexHome);
  if (repoRoot) {
    out.RESEARCH_TOOLS_REPO_ROOT = String(repoRoot);
  }
  out.NO_COLOR = '1';
  out.FORCE_COLOR = '0';
  out.PYTHONIOENCODING = 'utf-8';
  return out;
}

/** บรรทัดคำสั่งสำหรับ cmd.exe (เส้น .cmd shim) — ครอบ quote ทุกชิ้น · " ในค่าตั้ง -c คงที่ escape เป็น \" ให้ node แกะคืน */
export function buildWindowsCmdLine(exe, args) {
  const q = (s) => `"${String(s).replace(/"/g, '')}"`;
  const qArg = (s) => (FIXED_CONFIG.test(s) ? `"${s.replace(/"/g, '\\"')}"` : q(s));
  for (const a of [exe, ...args]) {
    if (/[%!^&|<>\r\n]/.test(String(a)) && !FIXED_CONFIG.test(String(a))) throw new BadArgError(`อาร์กิวเมนต์มีอักขระสั่งงาน cmd: ${String(a).slice(0, 60)}`);
  }
  return [q(exe), ...args.map(qArg)].join(' ');
}

const WIN_EXEC_EXT = ['.COM', '.EXE', '.BAT', '.CMD'];
function isFileSync(fs, p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
/** หาไฟล์โปรแกรมจริงบน Windows (PATH × PATHEXT) — ไม่พบ = null */
export function resolveWinExe(file, { env = process.env, fs = nodeFs } = {}) {
  const hasDir = /[\\/]/.test(file) || /^[A-Za-z]:/.test(file);
  const bases = hasDir ? [path.resolve(file)] : String(env.PATH || env.Path || '').split(';').filter(Boolean).map((d) => path.join(d, file));
  for (const b of bases) {
    const cands = WIN_EXEC_EXT.includes(path.extname(b).toUpperCase()) ? [b] : [...WIN_EXEC_EXT.map((e) => b + e), b];
    for (const c of cands) if (isFileSync(fs, c)) return { exe: c, batch: /\.(cmd|bat)$/i.test(c) };
  }
  return null;
}

/** ฆ่าทั้งต้นไม้โปรเซส (Windows: taskkill /T /F รอผลจริง · POSIX: ฆ่าทั้งกลุ่ม) — คืน {killFailed, reason} */
export function killTree(child, { spawnImpl = nodeSpawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    const pid = child && child.pid;
    if (!pid) { resolve({ killFailed: true, reason: 'ไม่มี pid' }); return; }
    if (platform === 'win32') {
      let tk;
      try {
        tk = spawnImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch (e) { resolve({ killFailed: true, reason: (e && e.message) || 'taskkill พลาด' }); return; }
      const guard = setTimeout(() => resolve({ killFailed: true, reason: 'taskkill ไม่จบใน 4 วิ' }), 4000);
      tk.on('error', (e) => { clearTimeout(guard); resolve({ killFailed: true, reason: (e && e.message) || 'taskkill error' }); });
      tk.on('close', (code) => { clearTimeout(guard); resolve({ killFailed: !(code === 0 || code === 128), reason: `taskkill โค้ด ${code}` }); });
      return;
    }
    try { process.kill(-pid, 'SIGKILL'); resolve({ killFailed: false }); } catch (e) {
      if (e && e.code === 'ESRCH') { resolve({ killFailed: false, reason: 'กลุ่มตายไปแล้ว' }); return; }
      try { child.kill('SIGKILL'); } catch { /* ตายไปแล้ว */ }
      resolve({ killFailed: true, reason: `ฆ่าทั้งกลุ่มไม่ได้: ${(e && e.message) || e}` });
    }
  });
}

// ── อ่านผล ────────────────────────────────────────────────────────────────
function tryParse(x) {
  try { const v = JSON.parse(String(x).trim()); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** ดึง JSON object จากข้อความปน (ยกตรรกะจาก brainRunner.extractJson: ตรง → code fence ท้ายสุด → ก้อนปีกกาสมดุลท้ายสุด) */
export function extractJson(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return null;
  const direct = tryParse(s);
  if (direct) return direct;
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (let i = fences.length - 1; i >= 0; i--) { const j = tryParse(fences[i]); if (j) return j; }
  const spans = [];
  let depth = 0; let start = -1; let inStr = false; let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) { spans.push([start, i + 1]); start = -1; }
    }
  }
  for (let i = spans.length - 1; i >= 0; i--) { const j = tryParse(s.slice(spans[i][0], spans[i][1])); if (j) return j; }
  return null;
}

/** อ่านไฟล์ข้อความ (รองรับ BOM UTF-8 และ UTF-16LE ที่ PowerShell 5.1 Out-File เขียน) — ไม่มี/อ่านไม่ได้ = null */
export function readTextFile(file, fs = nodeFs) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (!buf || !buf.length) return '';
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/** หาผลของเอเจนต์: out/result.json → ข้อความสุดท้าย (-o) → stdout */
export function readAgentResult({ workdir, lastMessage = '', stdout = '', fs = nodeFs }) {
  const resultText = readTextFile(path.join(workdir, 'out', RESULT_FILE), fs);
  if (resultText) {
    const j = tryParse(resultText) || extractJson(resultText);
    if (j) return { json: j, source: 'result.json' };
  }
  const fromLast = extractJson(lastMessage);
  if (fromLast) return { json: fromLast, source: 'last-message' };
  const fromOut = extractJson(stdout);
  if (fromOut) return { json: fromOut, source: 'stdout' };
  return { json: null, source: resultText === null ? 'missing' : 'unparseable' };
}

// ── จัดประเภทความล้มเหลว (ตรวจเฉพาะเมื่อออกด้วยโค้ดไม่ใช่ 0 — บทเรียน codex-auto.ps1:
//    stderr คือบันทึกงานของ codex ซึ่งมีเนื้อไฟล์/หน้าเว็บที่อ่านมาปน อาจมีคำว่า 401/authentication ได้ทั้งที่งานสำเร็จ)
const QUOTA_RE = /usage limit reached|usage limit|rate.?limit|quota (?:exceeded|exhausted)|out of (?:credits?|quota|usage)|insufficient (?:credits?|quota)|(?:status|code|http|error)\s*[:=]?\s*429\b|\b429\s*(?:too many|rate|error)|too many requests|limit will reset|hit your limit|plan limit/i;
const AUTH_RE = /not logged in|please (?:run|use) .?codex login|login required|unauthorized|\b401\b|token (?:expired|invalid)|refresh token|authentication (?:failed|required)|session (?:expired|invalid)/i;
export function isQuotaMessage(s) { return QUOTA_RE.test(String(s || '')); }
export function isAuthMessage(s) { return AUTH_RE.test(String(s || '')); }

/** แยกเหตุออกด้วยโค้ดไม่ใช่ 0 */
export function classifyExit({ code, out = '', err = '' }) {
  if (code === 0) return null;
  const blob = `${err}\n${out}`;
  if (code === 9009 || code === 127 || /is not recognized as an internal or external command|command not found/i.test(err)) return 'CODEX_UNAVAILABLE';
  if (isQuotaMessage(blob)) return 'CODEX_QUOTA';
  if (isAuthMessage(blob)) return 'CODEX_AUTH';
  return 'CODEX_EXIT';
}

function parseTokensUsed(text) {
  const all = [...String(text || '').matchAll(/tokens used[^\d]*([\d,]+)/gi)];
  if (!all.length) return null;
  const n = Number(all[all.length - 1][1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const tail = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(-n) : t; };

/**
 * โปรเซสลูก 1 ตัว: รอจบ/หมดเวลา — สถานะจบเดียว เจ้าของเดียว (แบบ brainRunner CB-03)
 * @returns {Promise<{spawnError?:Error, code?:number|null, out:string, err:string, timedOut:boolean, outTrunc?:boolean, killFailed?:boolean, orphaned?:boolean, killReason?:string|null}>}
 */
function execChild({ file, args, opts, prompt, timeoutMs, spawnImpl, killTreeImpl, setTimer, clearTimer }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let child;
    try { child = spawnImpl(file, args, opts); } catch (e) { finish({ spawnError: e, out: '', err: '', timedOut: false }); return; }
    let out = ''; let err = ''; let outTrunc = false;
    try { child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); } catch { /* stream ปลอมบางตัวไม่มี */ }
    child.stdout.on('data', (d) => { if (out.length < OUT_CAP) out += d; else outTrunc = true; });
    child.stderr.on('data', (d) => { if (err.length < ERR_CAP) err += d; });

    let timedOut = false; let closed = false; let closeCode = null; let closeWaiter = null; let backstop = null;
    const markClosed = (code) => {
      closed = true; closeCode = code;
      if (closeWaiter) { const w = closeWaiter; closeWaiter = null; w(); }
    };
    const waitClosed = (ms) => (closed ? Promise.resolve() : new Promise((res) => {
      const t = setTimer(() => { closeWaiter = null; res(); }, ms);
      closeWaiter = () => { clearTimer(t); res(); };
    }));
    const timer = setTimer(async () => {
      timedOut = true;
      backstop = setTimer(() => finish({
        code: null, out, err, timedOut: true, outTrunc, killFailed: true, orphaned: !closed, killReason: 'สรุปผลการฆ่าไม่ทันใน 5 วิ',
      }), 5000);
      let k;
      try { k = await killTreeImpl(child); } catch (e) { k = { killFailed: true, reason: (e && e.message) || 'killTree พลาด' }; }
      if (backstop) { clearTimer(backstop); backstop = null; }
      if (!closed) await waitClosed(2000);
      finish({ code: closed ? closeCode : null, out, err, timedOut: true, outTrunc, killFailed: !!k.killFailed, orphaned: !closed, killReason: k.reason || null });
    }, timeoutMs);
    const clearAll = () => { clearTimer(timer); if (backstop) { clearTimer(backstop); backstop = null; } };
    child.on('error', (e) => {
      if (timedOut) { markClosed(null); return; }
      clearAll();
      finish({ spawnError: e, out, err, timedOut: false });
    });
    child.on('close', (code) => {
      markClosed(code);
      if (timedOut) return;
      clearAll();
      finish({ code, out, err, timedOut: false, outTrunc });
    });
    try {
      child.stdin.on('error', () => {});
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch { /* ให้ close สรุป */ }
  });
}

/**
 * รันเอเจนต์ Codex 1 รอบ — ไม่โยน error
 * @param {object} p
 * @param {string} p.prompt      ใบงาน (ส่งทาง stdin)
 * @param {string} p.workdir     โฟลเดอร์งาน (มี out/ อยู่แล้ว)
 * @param {string} [p.account]   main | ตัวอักษรบัญชี | path
 * @param {'low'|'medium'} [p.effort]
 * @param {number} p.timeoutMs
 * @param {string} [p.repoRoot]
 * @param {object} [p.baseEnv]
 * @param {object} [deps] { spawnImpl, killTreeImpl, setTimer, clearTimer, platform, resolveExe, fs, homeDir, now, bin }
 * @returns {Promise<object>}
 */
export async function runCodex(p, deps = {}) {
  const {
    spawnImpl = nodeSpawn,
    platform = process.platform,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    fs = nodeFs,
    homeDir = os.homedir(),
    now = Date.now,
    bin = 'codex',
  } = deps;
  const killTreeImpl = deps.killTreeImpl || ((child) => killTree(child, { spawnImpl, platform }));
  const resolveExe = deps.resolveExe || ((file, env) => resolveWinExe(file, { env, fs }));
  const t0 = now();
  const base = { brain: 'codex', model: CODEX_MODEL, effort: p && p.effort === 'medium' ? 'medium' : 'low', account: String((p && p.account) || 'main') };
  const fail = (errorType, error, extra = {}) => ({ ok: false, ...base, errorType, error: String(error || errorType).slice(0, 400), elapsedMs: now() - t0, json: null, ...extra });
  try {
    const prompt = String((p && p.prompt) || '');
    if (!prompt.trim()) return fail('CODEX_BAD_ARGS', 'ใบงานว่าง');
    const workdir = String((p && p.workdir) || '');
    const outFile = path.join(workdir, 'out', LAST_MESSAGE_FILE);
    let args;
    let codexHome = null;
    try {
      args = buildCodexArgs({ workdir, outFile, model: (p && p.model) || CODEX_MODEL, effort: base.effort });
      if (base.account !== 'main' && base.account !== 'default') codexHome = resolveCodexHome(base.account, homeDir);
    } catch (e) {
      return fail('CODEX_BAD_ARGS', e.message);
    }
    const env = buildChildEnv({ baseEnv: (p && p.baseEnv) || process.env, codexHome, repoRoot: (p && p.repoRoot) || '', passEnv: (p && p.passEnv) || [] });
    const timeoutMs = Math.max(10_000, Number(p && p.timeoutMs) || 7 * 60_000);

    let file = bin;
    let spawnArgs = args;
    const opts = { shell: false, cwd: workdir, windowsHide: true, detached: platform !== 'win32', env };
    if (platform === 'win32') {
      const found = resolveExe(bin, env);
      if (!found) return fail('CODEX_UNAVAILABLE', `ไม่พบ ${bin} ใน PATH ของเครื่องนี้`);
      if (found.batch) {
        let line;
        try { line = buildWindowsCmdLine(found.exe, args); } catch (e) { return fail('CODEX_BAD_ARGS', e.message); }
        file = env.COMSPEC || env.ComSpec || 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', `"${line}"`];
        opts.windowsVerbatimArguments = true;
      } else {
        file = found.exe;
      }
    }

    const r = await execChild({ file, args: spawnArgs, opts, prompt, timeoutMs, spawnImpl, killTreeImpl, setTimer, clearTimer });
    const elapsedMs = now() - t0;
    if (r.spawnError) {
      const msg = (r.spawnError && (r.spawnError.code || r.spawnError.message)) || String(r.spawnError);
      return fail(/ENOENT/i.test(String(msg)) ? 'CODEX_UNAVAILABLE' : 'CODEX_SPAWN_ERROR', msg);
    }
    const lastMessage = readTextFile(outFile, fs) || '';
    const tokensUsed = parseTokensUsed(`${r.err}\n${r.out}`);
    const found = readAgentResult({ workdir, lastMessage, stdout: r.out, fs });
    const meta = {
      exitCode: r.code === undefined ? null : r.code,
      timedOut: !!r.timedOut,
      killFailed: !!r.killFailed,
      orphaned: !!r.orphaned,
      tokensUsed,
      elapsedMs,
      resultSource: found.source,
      lastMessage: tail(lastMessage, 2000),
      truncated: !!r.outTrunc,
    };
    // ผลที่เอเจนต์เขียนไว้แล้วใช้ได้เสมอ แม้หมดเวลา/ออกด้วยโค้ดไม่ใช่ 0 (fail-open · ผู้เรียกติดธง AGENT_TIMEOUT)
    if (found.json) {
      const exitType = r.timedOut ? 'CODEX_TIMEOUT' : classifyExit({ code: r.code, out: r.out, err: r.err });
      return { ok: true, ...base, json: found.json, warning: exitType || null, ...meta };
    }
    if (r.timedOut) return fail('CODEX_TIMEOUT', `เกินเพดานเวลา ${timeoutMs}ms`, { ...meta, rawSample: tail(r.err, 300) });
    const exitType = classifyExit({ code: r.code, out: r.out, err: r.err });
    if (exitType) return fail(exitType, `codex ออกด้วยโค้ด ${r.code}: ${tail(r.err || r.out, 300)}`, meta);
    // โค้ด 0 แต่ข้อความสั้นบอกให้ล็อกอิน = บัญชีหลุด (CLI ตอบ "สำเร็จ" ได้ทั้งที่ไม่ได้ทำงาน)
    if (lastMessage.trim().length < 400 && isAuthMessage(lastMessage)) return fail('CODEX_AUTH', `บัญชี ${base.account} ยังไม่ได้ล็อกอิน`, meta);
    return fail('CODEX_NO_RESULT', `ไม่พบ out/${RESULT_FILE} และไม่มี JSON ในคำตอบ (${found.source})`, meta);
  } catch (e) {
    return fail('CODEX_SPAWN_ERROR', (e && e.message) || e);
  }
}
