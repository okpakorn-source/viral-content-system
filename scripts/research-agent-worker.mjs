#!/usr/bin/env node
/**
 * 🔎 scripts/research-agent-worker.mjs — worker เอเจนต์รีเสิร์ช (SPEC-v2 ส่วน 4 · 6 · 8) รันบนเครื่องเจ้าของ/เครื่องทีม
 * ─────────────────────────────────────────────────────────────────────────────
 * วน: ธงหยุด? → POST /api/research/lease (x-research-secret) → เตรียมโฟลเดอร์งาน <WORKDIR>/<jobId>/
 *     (README-TOOLS.md · tools/ = junction ไป scripts/research-tools (หรือสำเนาเฉพาะเครื่องมือที่เปิด) · TASK.txt · out/)
 *     → เช็คโควตา (≤15% = ธง QUOTA_LOW · ≤5% = ข้ามไปบัญชีถัดไปใน RESEARCH_AGENT_CODEX_ACCOUNTS · หมด = โหมด api)
 *     → Codex gpt-6-astra low (เพดาน MAX_MINUTES+1 แต่ไม่เกินเส้นตายงาน) → ล้ม = สำรอง API (ถ้ามีคีย์+เวลา)
 *     → ยก medium เฉพาะ: เอเจนต์ประเมิน complexity สูง + ผลรอบ low ว่าง/ไม่พบต้นทาง + เวลายังเหลือ (บันทึกทุกครั้ง)
 *     → ด่านเชิงกล (gate.mjs) → ระเบียนตรงสัญญา 2.2 → POST /api/research/report (ลองซ้ำ ≤3 เฉพาะเน็ต/5xx/429)
 *     heartbeat ทุก 30 วิระหว่างทำงาน · log หมุนเวียน logs/research-agent/worker.log (5MB × 5) · เก็บโฟลเดอร์งานล่าสุด 30 งาน
 * ทำขนาน (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 · ข่าว 30–40/วัน 08:00–22:00 มาเป็นจังหวะ): ถือได้พร้อมกัน RESEARCH_AGENT_CONCURRENCY งาน
 *     (ค่าเริ่มต้น 2) · เต็มแล้วไม่ขอเพิ่ม · แต่ "เบราว์เซอร์" ใช้ได้ทีละงาน (research-agent/browserLock.mjs ไฟล์ล็อก) —
 *     งานที่ล็อกไม่ได้รันโดยตัด browser ออกจาก TOOLS ของงานนั้น + บันทึก tool_log ('browser-lock')
 * สัญญากับ route เลน B: lease body {workerId, version} · heartbeat body {jobId, workerId, version, account?, quota?:{remainingPct}}
 *     (version = PROTOCOL · ส่งใน header x-research-worker-version ด้วยเหมือนเดิม)
 *     job.limits ที่ lease อาจส่งมา "ไม่ถูกใช้" ในเฟส 1 — งบ/เครื่องมือ/สมอง/effort เป็นค่าฝั่ง worker (env บนเครื่องที่รัน worker
 *     ไม่ใช่ env บน Vercel) · เส้นตายงาน = job.deadlineAt จากเว็บ (ไม่มี = createdAt + 15 นาที เท่าค่าเริ่มต้นฝั่งเว็บ)
 * fail-open: ทุกความล้มเหลวของงานเดียวถูกจับ → รายงาน failed/skipped แล้วไปงานต่อไป · ท่อข่าวไม่รอ worker (เส้นตายฝั่งเว็บ)
 * ไม่ยิงอะไรเมื่อไม่ได้สั่งรัน (ไฟล์นี้ import แล้วไม่เริ่มลูปเอง) · ไม่พิมพ์คีย์ (log ผ่าน redactSecrets)
 *
 * ใช้:  node scripts/research-agent-worker.mjs            วนรับงาน (หยุด: Ctrl+C หรือ --stop)
 *       node scripts/research-agent-worker.mjs --once     ทำงานเดียวแล้วออก (ไม่มีงาน = ออกทันที)
 *       node scripts/research-agent-worker.mjs --check    แสดงค่าตั้ง (ไม่แสดงความลับ) + โควตา แล้วออก
 *       node scripts/research-agent-worker.mjs --stop     วางไฟล์ธงหยุด (worker ทำงานที่ค้างให้จบแล้วออก · forever.cmd จะรอจนลบธง)
 *       node scripts/research-agent-worker.mjs --resume   ลบไฟล์ธงหยุด
 * env (ไม่ตั้ง = ค่าเริ่มต้นตามสเปก 2.5): RESEARCH_AGENT_API_BASE (บังคับ) · RESEARCH_AGENT_SECRET (บังคับ) ·
 *   RESEARCH_AGENT_MAX_CALLS=24 · RESEARCH_AGENT_MAX_MINUTES=6 · RESEARCH_AGENT_EFFORT=low · RESEARCH_AGENT_ALLOW_MEDIUM (0 = ปิด) ·
 *   RESEARCH_AGENT_TOOLS (คั่นจุลภาค · ใส่ browser = อนุญาตเบราว์เซอร์) · RESEARCH_AGENT_BRAIN=codex|api ·
 *   RESEARCH_AGENT_QUOTA_ALERT_PCT=15 · RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH=10 · RESEARCH_AGENT_MODE (ค่าสำรองของ mode) ·
 *   RESEARCH_AGENT_CODEX_ACCOUNTS / CODEX_ACCOUNT · RESEARCH_AGENT_WORKDIR · RESEARCH_AGENT_WORKER_ID (ไม่ตั้ง = ชื่อเครื่อง) ·
 *   RESEARCH_AGENT_CODEX_BIN (ไม่ตั้ง = codex ใน PATH · ชี้ไฟล์โปรแกรมเดียว เช่น ตอน autostart ที่ PATH ไม่ครบ หรือตัวปลอมตอนทดสอบ) ·
 *   RESEARCH_AGENT_IDLE_MS (ไม่ตั้ง = 10000 · ช่วงถามงานตอนว่าง 1–120 วิ — ทุก lease = 1 การเรียก Vercel) ·
 *   RESEARCH_AGENT_CONCURRENCY (ไม่ตั้ง = 2 · งานพร้อมกัน 1–4 · เบราว์เซอร์ทีละงานเสมอ) ·
 *   RESEARCH_AGENT_STALE_DAYS (ไม่ตั้ง = 7 · เรื่องเก่ากว่าวันส่งเกินกี่วัน = ธง STALE_NEWS — ธงอย่างเดียว ไม่หยุดงาน)
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 ชั้น 3 · W4): กันไฟล์ผลเอเจนต์เข้ารหัสผิด (ไทยกลายเป็น ?)
 *   ตรวจผลทุกรอบด้วยกฎกลาง (research-agent/encodingCheck.mjs · ช่อง encoding จาก codexRunner หรือคำนวณเอง) →
 *   (ก) เสีย + สมอง codex + เวลาถึงเส้นตายใบขอ (deadlineAt − ตอนนี้ แบบเดียวกับ remaining()) เหลือ ≥ 6 นาที + ยังไม่เคยรันซ้ำ
 *       → ย้ายไฟล์เสียไป out/round-encoding-result.json แล้วรัน Codex ซ้ำ 1 รอบในโฟลเดอร์งานเดิม (ใบงานมีย่อหน้าเตือน encodingRetry)
 *   (ข) เวลาไม่พอ / รันซ้ำแล้วยังเสียหรือไม่ได้ผล → ระเบียน status 'failed' + ธง ENCODING_BROKEN · การ์ดทุกใบ gate=dropped
 *       (ไม่มีแผน/ต้นทาง/ข้อแก้/ธงจากเนื้อที่เสีย — ไม่โชว์เป็นข้อเท็จจริง ไม่ส่งบรรณาธิการ) · ไม่ยก medium · ไม่สำรอง API
 *   ผลไทยปกติ = เส้นทางเดิมทุกอย่าง (ไม่รันซ้ำ ระเบียนเดิม) · ตัวตรวจพัง = ถือว่าไม่เสีย (fail-open)
 *   tools/ แบบสำเนา (RESEARCH_AGENT_TOOLS ตั้งไว้) คัด check-result.mjs ไปด้วยเสมอ (HELPER_FILES) — ใบงานสั่งให้เอเจนต์รันก่อนจบ
 * ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): RESEARCH_AGENT_API_FALLBACK (ไม่ตั้ง/ค่าอื่น = ปิด · '1' = เปิดทางสำรอง
 *   OpenAI API gpt-6-astra เมื่อ Codex ใช้ไม่ได้/โควตาหมดทุกบัญชี — เสียเงินจริง $10/$50 ต่อ 1M โทเคน) · ปิดอยู่ = งานนั้น failed +
 *   ธง BRAIN_UNAVAILABLE (+ CODEX_AUTH/QUOTA_LOW) · งบ RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH ถึงเพดาน = หยุดทาง API จริง (ธง TOOL_BUDGET_MONTH)
 *   ข้อความบรรทัด "→ ล้ม = สำรอง API (ถ้ามีคีย์+เวลา)" ด้านบน = เฉพาะเมื่อเปิดสวิตช์นี้และงบยังไม่ถึงเพดาน
 */
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { runCodex as realRunCodex, RESULT_FILE, LAST_MESSAGE_FILE } from './research-agent/codexRunner.mjs';
import { runApiFallback as realRunApi } from './research-agent/apiFallback.mjs';
// ★ 1 ต.ค. 69 (SPEC-v3 ส่วน 10 · W4): + ENCODING_RETRY_ARCHIVE_LABEL · ของเดิม: import { buildTask, loadTasteExamples, ALL_TOOLS } from './research-agent/taskBuilder.mjs';
import { buildTask, loadTasteExamples, ALL_TOOLS, ENCODING_RETRY_ARCHIVE_LABEL } from './research-agent/taskBuilder.mjs';
import { runGate, resultValue, GATE_RULES } from './research-agent/gate.mjs';
import { isEncodingBroken, summarizeEncoding, dropCardsForEncoding, ENCODING_FLAG } from './research-agent/encodingCheck.mjs'; // ★ W4
import { buildCardRecord, validateCardRecord, redactSecrets, MODES, LIMITS } from './research-agent/schema.mjs';
import { accountOrder, readQuota as realReadQuota, chooseAccount, DEFAULT_ALERT_PCT } from './research-agent/accounts.mjs';
import { monthBudgetStatus } from './research-agent/pricing.mjs';
import { acquireBrowserLock, readBrowserLock, BROWSER_LOCK_FILE } from './research-agent/browserLock.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROTOCOL = 'research-lease-v1';
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_BIN = /^[\p{L}\p{M}\p{N}\\/:. _\-~()]{1,260}$/u; // ไฟล์โปรแกรมเดียว ไม่มีอาร์กิวเมนต์/อักขระ shell
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SERVICE_ROLE/i;
// ★ 1 ต.ค. 69 (SPEC-v3 ส่วน 10 · W4): + check-result.mjs (ใบงานสั่งรันก่อนจบทุกงาน — โหมดสำเนาต้องมีเสมอ)
//   ของเดิม: const HELPER_FILES = ['_common.mjs', '_alias-hooks.mjs'];
const HELPER_FILES = ['_common.mjs', '_alias-hooks.mjs', 'check-result.mjs'];
/** เพดานงานพร้อมกัน (Codex หลายตัวพร้อมกัน = โควตา/เครื่องหนักตาม) */
export const MAX_CONCURRENCY = 4;
/**
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 ข้อ 3 ก · W4): รันซ้ำเพราะไฟล์ผลเข้ารหัสผิดได้เมื่อเวลาถึงเส้นตายใบขอ
 *   (deadlineAt − ตอนนี้ · วิธีเดียวกับ remaining() ใน processJob) เหลือ ≥ 6 นาที — ไม่พอ = failed + ENCODING_BROKEN ทันที
 */
export const ENCODING_RETRY_MIN_LEFT_MS = 6 * 60000;
/** เส้นตายสำรองเมื่อใบขอไม่มี deadlineAt = เท่าค่าเริ่มต้นฝั่งเว็บ (createdAt + RESEARCH_AGENT_DEADLINE_MIN 15 นาที) */
export const FALLBACK_DEADLINE_MIN = 15;

const intEnv = (v, min, max, def) => {
  const n = parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const floatEnv = (v, min, max, def) => {
  const n = parseFloat(String(v == null ? '' : v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** ค่าตั้ง worker จาก env (ไม่มีค่าความลับในผล นอกจาก secret ที่ใช้ยิง API ของเราเอง) */
export function loadConfig(env = process.env, { repoRoot = REPO_ROOT } = {}) {
  const toolsRaw = String(env.RESEARCH_AGENT_TOOLS || '').trim();
  const toolTokens = toolsRaw ? toolsRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  const tools = toolTokens ? ALL_TOOLS.filter((t) => toolTokens.includes(t)) : [...ALL_TOOLS];
  const logDir = path.join(repoRoot, 'logs', 'research-agent');
  const mode = String(env.RESEARCH_AGENT_MODE || '').trim();
  const maxMinutes = intEnv(env.RESEARCH_AGENT_MAX_MINUTES, 1, 30, 6);
  return {
    apiBase: String(env.RESEARCH_AGENT_API_BASE || '').trim().replace(/\/+$/, ''),
    secret: String(env.RESEARCH_AGENT_SECRET || ''),
    workerId: (String(env.RESEARCH_AGENT_WORKER_ID || '').trim() || os.hostname()).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 60) || 'worker',
    workdirRoot: String(env.RESEARCH_AGENT_WORKDIR || '').trim() || path.join(os.tmpdir(), 'research-agent-work'),
    logDir,
    stopFile: path.join(logDir, 'research-agent.stop'),
    maxCalls: intEnv(env.RESEARCH_AGENT_MAX_CALLS, 1, 80, 24),
    maxMinutes,
    effort: String(env.RESEARCH_AGENT_EFFORT || '').trim() === 'medium' ? 'medium' : 'low',
    allowMedium: String(env.RESEARCH_AGENT_ALLOW_MEDIUM || '').trim() !== '0',
    tools,
    restrictedTools: !!toolTokens,
    browser: toolTokens ? toolTokens.includes('browser') : true,
    brain: String(env.RESEARCH_AGENT_BRAIN || '').trim() === 'api' ? 'api' : 'codex',
    quotaAlertPct: floatEnv(env.RESEARCH_AGENT_QUOTA_ALERT_PCT, 0, 100, DEFAULT_ALERT_PCT),
    toolBudgetUsdMonth: floatEnv(env.RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH, 0, 100000, 10),
    mode: MODES.includes(mode) ? mode : 'shadow',
    accounts: accountOrder(env),
    codexBin: String(env.RESEARCH_AGENT_CODEX_BIN || '').trim() || 'codex',
    repoRoot,
    toolsDir: path.join(repoRoot, 'scripts', 'research-tools'),
    essencesPath: path.join(repoRoot, 'data', 'viral-essences.json'),
    idleMs: intEnv(env.RESEARCH_AGENT_IDLE_MS, 1000, 120000, 10000), // ว่าง = ถามงานทุก 10 วิ (ลดการเรียก Vercel)
    concurrency: intEnv(env.RESEARCH_AGENT_CONCURRENCY, 1, MAX_CONCURRENCY, 2),
    staleDays: intEnv(env.RESEARCH_AGENT_STALE_DAYS, 1, 3650, GATE_RULES.STALE_DAYS),
    // ล็อกเบราว์เซอร์อยู่ใต้ temp ของผู้ใช้ (ไม่ใช่ WORKDIR) — worker ทุกตัวของผู้ใช้คนนี้ใช้โปรไฟล์ Edge ชุดเดียวกัน
    browserLockFile: path.join(os.tmpdir(), BROWSER_LOCK_FILE),
    // ถือล็อกได้นานสุด ≈ รอบ low + รอบ medium (คนละ MAX_MINUTES+1) → เกินนี้ +5 นาที = ล็อกค้าง ยึดคืนได้
    browserLockStaleMs: ((maxMinutes + 1) * 2 + 5) * 60000,
    errMs: 15000,
    maxErrMs: 60000,
    heartbeatMs: 30000,
    keepWorkdirs: 30,
    logMaxBytes: 5 * 1024 * 1024,
    logKeep: 5,
    accountCooldownMs: 30 * 60 * 1000,
  };
}

/** ปัญหาค่าตั้งที่ต้องหยุด (คืนข้อความ — ไม่มีค่าความลับ) */
export function configProblems(cfg) {
  const p = [];
  if (!cfg.secret) p.push('ยังไม่ได้ตั้ง RESEARCH_AGENT_SECRET');
  if (!cfg.apiBase) p.push('ยังไม่ได้ตั้ง RESEARCH_AGENT_API_BASE (เช่น https://<โดเมน> หรือ http://localhost:3000)');
  else {
    try {
      const u = new URL(cfg.apiBase);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') p.push('RESEARCH_AGENT_API_BASE ต้องเป็น http(s)');
      else if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) p.push('RESEARCH_AGENT_API_BASE แบบ http ใช้ได้เฉพาะ localhost (secret ต้องไม่วิ่งบน http สาธารณะ)');
    } catch { p.push('RESEARCH_AGENT_API_BASE ไม่ใช่ URL'); }
  }
  if (!SAFE_BIN.test(String(cfg.codexBin || ''))) p.push('RESEARCH_AGENT_CODEX_BIN ต้องเป็นชื่อ/พาธไฟล์โปรแกรมเดียว (ห้ามอักขระสั่งงาน)');
  return p;
}

/**
 * .env.local ของ repo มีชื่อนี้ (ค่าไม่ว่าง) ไหม — ใช้ตอน --check: เครื่องมือในโฟลเดอร์งาน (เช่น web-agent ↔ OPENAI_API_KEY)
 * ไม่ได้รับคีย์จาก worker (codexRunner ตัด OPENAI_API_KEY ออกจาก env ลูก) แต่ _common.ensureKeys อ่านจากไฟล์นี้เอง
 * คืน true/false เท่านั้น (ไม่คืนค่า)
 */
export function envLocalHas(name, { repoRoot = REPO_ROOT, fs = nodeFs } = {}) {
  try {
    return !!util.parseEnv(String(fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8')))[name];
  } catch {
    return false;
  }
}

/** ค่าความลับทั้งหมดใน env (ไว้ปิดใน log/ผล) */
export function secretValuesOf(env = process.env) {
  const out = [];
  for (const [k, v] of Object.entries(env || {})) if (SECRET_NAME.test(k) && typeof v === 'string' && v.length >= 8) out.push(v);
  return out;
}

// ── log หมุนเวียน ──────────────────────────────────────────────────────────
export function createLogger({ logDir, maxBytes = 5 * 1024 * 1024, keep = 5, fs = nodeFs, now = Date.now, echo = true, secretValues = [] }) {
  const file = path.join(logDir, 'worker.log');
  let ready = false;
  const rotate = () => {
    try {
      if (fs.statSync(file).size < maxBytes) return;
    } catch { return; }
    try { fs.rmSync(`${file}.${keep}`, { force: true }); } catch { /* ไม่สำคัญ */ } // ลบเก่าสุดก่อน แล้วค่อยเลื่อน
    for (let i = keep - 1; i >= 1; i--) {
      try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch { /* ไม่มีไฟล์ลำดับนี้ */ }
    }
    try { fs.renameSync(file, `${file}.1`); } catch { /* ไม่สำคัญ */ }
  };
  return function log(level, msg) {
    const line = `[${new Date(now()).toISOString()}] ${level} ${redactSecrets(String(msg), secretValues)}`;
    if (echo) { try { process.stdout.write(`${line}\n`); } catch { /* ไม่สำคัญ */ } }
    try {
      if (!ready) { fs.mkdirSync(logDir, { recursive: true }); ready = true; }
      rotate();
      fs.appendFileSync(file, `${line}\n`, 'utf8');
    } catch { /* log ล้มต้องไม่ทำงานล้ม */ }
  };
}

// ── HTTP ไปเว็บ (route ของเลน B) ───────────────────────────────────────────
export class HttpError extends Error {
  constructor(message, status, errorType) { super(message); this.status = status; this.errorType = errorType || ''; }
}

/**
 * body ของ heartbeat (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 · route เลน B อ่าน body.quota?.remainingPct ?? body.quotaPct และ body.version)
 * → {jobId, workerId, version, account?, quota?:{remainingPct}} · ไม่รู้บัญชี/โควตา = ไม่ใส่ช่องนั้น (ไม่ส่ง null)
 */
export function heartbeatBody({ jobId, workerId, account, remainingPct }) {
  const body = { jobId, workerId, version: PROTOCOL };
  if (typeof account === 'string' && account) body.account = account;
  if (typeof remainingPct === 'number' && Number.isFinite(remainingPct)) body.quota = { remainingPct };
  return body;
}

export function createApi({ apiBase, secret, workerId, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const headers = { 'Content-Type': 'application/json', 'x-research-secret': secret, 'x-research-worker-version': PROTOCOL };
  async function post(route, body, timeoutMs) {
    let r;
    try {
      r = await fetchImpl(`${apiBase}${route}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new HttpError(`เชื่อม ${route} ไม่ได้: ${String((e && e.message) || e).slice(0, 160)}`, 0, 'NETWORK');
    }
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok || (data && data.success === false)) {
      throw new HttpError(`${route} ตอบ ${r.status}: ${String((data && data.error) || '').slice(0, 160)}`, r.status, (data && data.errorType) || '');
    }
    return data || {};
  }
  return {
    async lease() {
      const d = await post('/api/research/lease', { workerId, version: PROTOCOL }, 15000);
      return { job: d.job || null, mode: d.mode || null };
    },
    /** extra = {account?, remainingPct?} (ช่องอื่นถูกทิ้ง — body ตรงสัญญาเสมอ) */
    async heartbeat(jobId, extra = {}) {
      const x = extra && typeof extra === 'object' ? extra : {};
      return post('/api/research/heartbeat', heartbeatBody({ jobId, workerId, account: x.account, remainingPct: x.remainingPct }), 10000);
    },
    async report(jobId, result, { attempts = 3 } = {}) {
      let last = null;
      for (let i = 1; i <= attempts; i++) {
        try {
          return await post('/api/research/report', { jobId, workerId, result }, 20000); // eslint-disable-line no-await-in-loop -- ลองซ้ำแบบมีเพดานตามลำดับ
        } catch (e) {
          last = e;
          const retryable = e.status === 0 || e.status === 429 || e.status >= 500;
          if (!retryable || i === attempts) break;
          await sleep(500 * (2 ** (i - 1))); // eslint-disable-line no-await-in-loop -- backoff มีเพดาน
        }
      }
      throw last;
    },
  };
}

// ── โฟลเดอร์งาน ────────────────────────────────────────────────────────────
/** สร้าง <root>/<jobId>/ ใหม่: README-TOOLS.md · tools/ · TASK.txt · out/ */
export function prepareWorkdir({ root, jobId, toolsDir, tools = ALL_TOOLS, restricted = false, taskText, fs = nodeFs }) {
  if (!SAFE_JOB_ID.test(String(jobId))) throw new Error(`jobId ผิดรูป: ${String(jobId).slice(0, 40)}`);
  const dir = path.join(root, String(jobId));
  fs.rmSync(dir, { recursive: true, force: true }); // junction ถูกถอดเฉพาะลิงก์ ไม่แตะต้นทาง (พิสูจน์บน Windows แล้ว)
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  try { fs.copyFileSync(path.join(toolsDir, 'README-TOOLS.md'), path.join(dir, 'README-TOOLS.md')); } catch { /* ไม่มี README ก็ทำงานได้ */ }
  let toolsMode = 'junction';
  const toolsLink = path.join(dir, 'tools');
  if (!restricted) {
    try { fs.symlinkSync(toolsDir, toolsLink, 'junction'); } catch { toolsMode = 'copy'; }
  } else toolsMode = 'copy';
  if (toolsMode === 'copy') {
    fs.mkdirSync(toolsLink, { recursive: true });
    for (const f of [...HELPER_FILES, ...tools.map((t) => `${t}.mjs`)]) {
      try { fs.copyFileSync(path.join(toolsDir, f), path.join(toolsLink, f)); } catch { /* เครื่องมือหาย = เอเจนต์จะเห็นว่าใช้ไม่ได้ */ }
    }
    // สำเนาอยู่นอก repo → บอกรากโปรเจกต์ให้เครื่องมือหา .env.local/src เอง (กรณีเชลล์ของเอเจนต์ไม่ส่ง env ต่อ)
    try { fs.writeFileSync(path.join(toolsLink, '.repo-root'), path.resolve(toolsDir, '..', '..'), 'utf8'); } catch { /* มี env สำรองอยู่แล้ว */ }
  }
  fs.writeFileSync(path.join(dir, 'TASK.txt'), taskText, 'utf8');
  return { dir, outDir: path.join(dir, 'out'), toolsMode };
}

/** เก็บโฟลเดอร์งานล่าสุด keep งาน (ใหม่สุดตาม mtime) — ที่เหลือลบ (retention กันดิสก์เต็ม) */
export function pruneWorkdirs({ root, keep = 30, fs = nodeFs, exceptDir = null }) {
  // exceptDir = โฟลเดอร์เดียวหรือรายการ (ทำขนาน: โฟลเดอร์ของงานที่ยังรันอยู่ห้ามถูกลบ)
  const except = new Set((Array.isArray(exceptDir) ? exceptDir : [exceptDir]).filter(Boolean).map((d) => path.resolve(String(d))));
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && SAFE_JOB_ID.test(d.name))
      .map((d) => { const p = path.join(root, d.name); let t = 0; try { t = fs.statSync(p).mtimeMs; } catch { t = 0; } return { p, t }; });
  } catch { return 0; }
  entries.sort((a, b) => b.t - a.t);
  let removed = 0;
  for (const e of entries.slice(keep)) {
    if (except.has(path.resolve(e.p))) continue;
    try { fs.rmSync(e.p, { recursive: true, force: true }); removed++; } catch { /* ไฟล์ถูกล็อกอยู่ — รอบหน้าค่อยลบ */ }
  }
  return removed;
}

/** ย้ายผลรอบ low ออกก่อนรัน medium (กันอ่านผลเก่าซ้ำ) */
export function archiveRound(outDir, label, fs = nodeFs) {
  for (const f of [RESULT_FILE, LAST_MESSAGE_FILE]) {
    try { fs.renameSync(path.join(outDir, f), path.join(outDir, `${label}-${f}`)); } catch { /* ไม่มีไฟล์ */ }
  }
}

// ── งบเครื่องมือรายเดือน (ข้อ 18: เตือนเมื่อถึง ไม่หยุด) ──────────────────────
export function addMonthSpend({ logDir, costUsd, capUsd, now = Date.now, fs = nodeFs }) {
  const month = new Date(now()).toISOString().slice(0, 7);
  const file = path.join(logDir, `tool-spend-${month}.json`);
  let led = { month, costUsd: 0, jobs: 0 };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.month === month) led = j; } catch { /* ไฟล์ใหม่ */ }
  const st = monthBudgetStatus({ spentUsd: led.costUsd, addUsd: costUsd, capUsd });
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ month, costUsd: st.spentAfter, jobs: (Number(led.jobs) || 0) + 1, updatedAt: new Date(now()).toISOString() }), 'utf8');
  } catch { /* บัญชีงบเขียนไม่ได้ ไม่ทำให้งานล้ม */ }
  return st;
}

// ── ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): ทาง OpenAI API ห้ามวิ่งเอง (เงินรั่ว) ──────────────────────
//   สมอง gpt-6-astra ผ่าน Responses API = เสียเงินจริง $10/1M input · $50/1M output (+ web search $10/1,000) ไม่ใช่โควตา subscription
//   1) ทางสำรอง 2 จุด (โควตา Codex หมดทุกบัญชี · Codex ล้ม/ผลผิดสัญญา) เปิดเฉพาะ RESEARCH_AGENT_API_FALLBACK=1 — ไม่ตั้ง/ค่าอื่น = ปิด:
//      งานนั้น failed + ธง BRAIN_UNAVAILABLE (+ CODEX_AUTH เมื่อหลุดล็อกอิน · QUOTA_LOW เมื่อโควตาหมด) + เหตุผลใน tool_log · ไม่เรียก API
//   2) งบเดือนนี้ (บัญชี tool-spend ของ addMonthSpend) ถึงเพดานแล้ว = หยุดทาง API จริงทุกทาง (รวม RESEARCH_AGENT_BRAIN=api) →
//      failed + ธง TOOL_BUDGET_MONTH · รอบ Codex ยังทำต่อพร้อมธงเตือนเดิม (เจ้าของ#18 "เตือนเมื่อถึง ไม่หยุด" ใช้กับเครื่องมือของ Codex)
/** ทางสำรอง API เปิดไหม (รับ '1' ตรงตัวเท่านั้น แบบสวิตช์อื่นของระบบ) */
export function apiFallbackEnabled(env = process.env) {
  return String((env && env.RESEARCH_AGENT_API_FALLBACK) || '').trim() === '1';
}

/** งบเดือนนี้ถึงเพดานหรือยัง — อ่านบัญชีเดียวกับ addMonthSpend (ไม่เขียน) · ไม่มีบัญชี/อ่านไม่ได้ = ยังไม่ใช้ (แบบ addMonthSpend) */
export function monthSpendReached({ logDir, capUsd, now = Date.now, fs = nodeFs }) {
  const month = new Date(now()).toISOString().slice(0, 7);
  let spent = 0;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(logDir, `tool-spend-${month}.json`), 'utf8'));
    if (j && j.month === month) spent = Number(j.costUsd) || 0;
  } catch { /* ยังไม่มีบัญชีเดือนนี้ */ }
  return monthBudgetStatus({ spentUsd: spent, addUsd: 0, capUsd }).reached;
}

/**
 * ทาง API ของงานนี้ถูกกั้นไหม → null = เรียกได้ · {flags, note} = ห้ามเรียก (ผู้เรียกติดธง + บันทึก → งานจบ failed)
 * @param {{env:object, cfg:object, now?:Function, fs?:object, viaFallback:boolean, reason?:string}} p
 *   viaFallback = มาจากทางสำรอง (ต้องเปิด RESEARCH_AGENT_API_FALLBACK=1 ก่อน) · false = ตั้ง RESEARCH_AGENT_BRAIN=api เอง (ดูแค่งบ)
 *   reason = เหตุที่ Codex ใช้ไม่ได้ (errorType ของรอบ Codex · 'QUOTA' เมื่อโควตาหมดทุกบัญชี) → ธงเหตุผล CODEX_AUTH / QUOTA_LOW
 */
export function apiPathBlock({ env, cfg, now = Date.now, fs = nodeFs, viaFallback, reason = '' }) {
  const off = !!viaFallback && !apiFallbackEnabled(env);
  const budget = !off && monthSpendReached({ logDir: cfg.logDir, capUsd: cfg.toolBudgetUsdMonth, now, fs });
  if (!off && !budget) return null;
  const why = String(reason || '-').slice(0, 80);
  const flags = viaFallback ? ['BRAIN_UNAVAILABLE'] : [];
  if (why === 'CODEX_AUTH') flags.push('CODEX_AUTH');
  if (why === 'CODEX_QUOTA' || why === 'QUOTA') flags.push('QUOTA_LOW');
  if (budget) flags.push('TOOL_BUDGET_MONTH');
  const note = off
    ? `${why} → ไม่ใช้ทางสำรอง OpenAI API (ปิดอยู่ · เปิดด้วย RESEARCH_AGENT_API_FALLBACK=1 เมื่อเจ้าของยอมจ่าย $10/$50 ต่อ 1M โทเคน)`
    : `${why} → งบเดือนนี้ถึงเพดาน $${cfg.toolBudgetUsdMonth} แล้ว — หยุดทาง API (ขยาย RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH ได้ถ้าจำเป็น)`;
  return { flags, note: workerNote('api-path', false, note) };
}

// ── งานหนึ่งชิ้น ────────────────────────────────────────────────────────────
/**
 * ช่องที่ worker ใช้จากใบขอ — job.limits (lease เลน B อาจส่ง RESEARCH_AGENT_MAX_CALLS/EFFORT/TOOLS/BRAIN ฝั่ง Vercel มา)
 * "ตั้งใจไม่ใช้" ในเฟส 1: งบ/เครื่องมือ/สมอง/effort อ่านจาก env บนเครื่องที่รัน worker เท่านั้น (เทส worker ข้อ 15 เฝ้าไว้)
 */
function sanitizeJob(job) {
  const j = job && typeof job === 'object' ? job : {};
  return {
    id: String(j.id || ''),
    rawText: typeof j.rawText === 'string' ? j.rawText : '',
    sourceUrls: (Array.isArray(j.sourceUrls) ? j.sourceUrls : []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 10),
    createdAt: typeof j.createdAt === 'string' ? j.createdAt : null,
    deadlineAt: typeof j.deadlineAt === 'string' ? j.deadlineAt : null,
    mode: MODES.includes(j.mode) ? j.mode : null,
  };
}

const workerNote = (args, ok, note) => ({ tool: 'worker', args: String(args).slice(0, LIMITS.text), ok: !!ok, note: String(note).slice(0, LIMITS.text), ms: null });

/**
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 · W4): ผลตรวจไฟล์ผลเข้ารหัสผิดของผลรอบหนึ่ง
 *   ใช้ช่อง encoding ที่ codexRunner.readAgentResult ติดมา (รูปถูก) · ไม่มี (สมอง api/ตัวรันปลอม) = คำนวณเองด้วยกฎเดียวกัน
 *   ไม่มี JSON / ตัวตรวจพัง = null (fail-open: ไม่ถือว่าเสีย)
 * @param {object|null} res  ผลของ runCodex/runApi
 * @returns {object|null}
 */
export function encodingOfResult(res) {
  if (!res || !res.ok || !res.json) return null;
  if (res.encoding && typeof res.encoding === 'object' && typeof res.encoding.broken === 'boolean') return res.encoding;
  try { return isEncodingBroken(res.json); } catch { return null; }
}
const encodingBrokenRound = (r) => !!(r && r.encoding && r.encoding.broken === true);

/**
 * ทำงานรีเสิร์ช 1 งาน → ระเบียนตามสัญญา 2.2 (ไม่ส่ง — ผู้เรียกส่งเอง) · ไม่โยน error
 * @param {object} rawJob  แถว research-requests จาก lease
 * @param {object} ctx { cfg, env, deps:{runCodex, runApi, readQuota, now, fs, log, heartbeat, every}, state, leaseMode }
 * @returns {Promise<{record:object|null, summary:object}>}
 */
export async function processJob(rawJob, ctx) {
  const { cfg, env = process.env, state = { cooldown: {} }, leaseMode = null } = ctx;
  const deps = ctx.deps || {};
  const now = deps.now || Date.now;
  const fs = deps.fs || nodeFs;
  const log = deps.log || (() => {});
  const runCodex = deps.runCodex || realRunCodex;
  const runApi = deps.runApi || realRunApi;
  const readQuota = deps.readQuota || realReadQuota;
  const secretValues = deps.secretValues || secretValuesOf(env);
  const job = sanitizeJob(rawJob);
  const summary = { jobId: job.id, status: null, brain: null, effort: null, cards: 0, flags: [] };
  if (!SAFE_JOB_ID.test(job.id)) { log('WARN', `ข้ามงาน: jobId ผิดรูป (${job.id.slice(0, 40)})`); return { record: null, summary }; }
  const t0 = now();
  const mode = job.mode || leaseMode || cfg.mode;
  const createdT = Date.parse(job.createdAt || '');
  const deadlineT = Date.parse(job.deadlineAt || '') || (Number.isFinite(createdT) ? createdT : t0) + FALLBACK_DEADLINE_MIN * 60000;
  const flags = [];
  const addFlag = (f) => { if (!flags.includes(f)) flags.push(f); };
  const finish = (record) => {
    const errs = validateCardRecord(record);
    if (errs.length) {
      log('ERROR', `ระเบียนผิดสัญญา (บั๊ก worker): ${errs.slice(0, 5).join(' | ')}`);
      record = buildCardRecord({
        jobId: job.id, status: 'failed', mode, brain: record.brain, flags: ['AGENT_FAILED'],
        toolLog: [workerNote('validate', false, `ระเบียนผิดสัญญา: ${errs.slice(0, 3).join(' | ')}`)], nowIso: new Date(now()).toISOString(),
      });
    }
    summary.status = record.status; summary.cards = record.cards.length; summary.flags = record.flags;
    summary.brain = record.brain.kind; summary.effort = record.brain.effort;
    return { record, summary };
  };
  const skip = (flag, why) => finish(buildCardRecord({
    jobId: job.id, status: 'skipped', mode, brain: { kind: cfg.brain, effort: cfg.effort, account: 'none' }, flags: [flag],
    toolLog: [workerNote('skip', false, why)], nowIso: new Date(now()).toISOString(),
  }));

  try {
    if (!job.rawText.trim()) return skip('EMPTY_RAW', 'ข่าวดิบว่าง');
    const remaining = () => deadlineT - now();
    const fullMs = (cfg.maxMinutes + 1) * 60000;
    if (remaining() < 45000) return skip('DEADLINE_PASSED', `เหลือเวลา ${Math.round(remaining() / 1000)} วิ ก่อนเส้นตาย — ไม่พอเริ่ม`);

    // ── เลือกสมอง/บัญชี ──
    let brainKind = cfg.brain;
    let account = 'api';
    let quotaInfo = null;
    const toolLogExtra = [];
    // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): ทาง API ถูกกั้น (ทางสำรองปิด/งบเดือนถึงเพดาน) ก่อนเริ่มงาน = จบ failed ทันที
    //   (ไม่สร้างโฟลเดอร์งาน · ไม่ heartbeat · ไม่เรียก Codex/API) · ธงจาก apiPathBlock + AGENT_FAILED · เหตุผลใน tool_log
    const failApiBlocked = (block) => {
      for (const f of [...block.flags, 'AGENT_FAILED']) addFlag(f);
      return finish(buildCardRecord({
        jobId: job.id, status: 'failed', mode, brain: { kind: cfg.brain, effort: cfg.effort, account: 'none' }, flags,
        toolLog: [...toolLogExtra, block.note], nowIso: new Date(now()).toISOString(),
      }));
    };
    if (brainKind === 'api') { // ★ W5: ตั้ง RESEARCH_AGENT_BRAIN=api เอง (ไม่ใช่ทางสำรอง) — ดูแค่งบเดือน
      const explicitBlock = apiPathBlock({ env, cfg, now, fs, viaFallback: false, reason: 'RESEARCH_AGENT_BRAIN=api' });
      if (explicitBlock) return failApiBlocked(explicitBlock);
    }
    if (brainKind === 'codex') {
      const quotas = {};
      for (const name of cfg.accounts) {
        const cool = state.cooldown && state.cooldown[name];
        if (cool && cool > now()) { quotas[name] = { account: name, status: 'FULL', remainingPct: 0, note: 'พักบัญชี (โควตาหมด/หลุดล็อกอินรอบก่อน)' }; continue; }
        try { quotas[name] = await readQuota(name); } catch { quotas[name] = undefined; } // eslint-disable-line no-await-in-loop -- ทีละบัญชี ฟรี
      }
      const pick = chooseAccount(cfg.accounts, quotas, { alertPct: cfg.quotaAlertPct });
      if (pick.quotaLow) addFlag('QUOTA_LOW');
      // ★ 1 ต.ค. 69 (W5): โควตาหมดทุกบัญชี — ทางสำรอง API ปิดอยู่ (ค่าเริ่มต้น) หรืองบเดือนถึงเพดาน = failed ไม่เรียก API
      const quotaBlock = pick.useApi ? apiPathBlock({ env, cfg, now, fs, viaFallback: true, reason: 'QUOTA' }) : null;
      if (quotaBlock) {
        toolLogExtra.push(workerNote('quota', false, pick.reason));
        return failApiBlocked(quotaBlock);
      }
      if (pick.useApi) {
        brainKind = 'api';
        addFlag('API_FALLBACK');
        toolLogExtra.push(workerNote('quota', false, `${pick.reason} → โหมด API`));
      } else {
        account = pick.account;
        quotaInfo = { account, remainingPct: pick.remainingPct };
        if (pick.skipped.length) toolLogExtra.push(workerNote('quota', true, `${pick.reason} → ใช้ ${account}`));
      }
    }

    // ── heartbeat ระหว่างทำงาน ──
    let stopBeat = () => {};
    if (deps.heartbeat && deps.every) {
      // body จริงประกอบที่ createApi.heartbeat → {jobId, workerId, version, account, quota:{remainingPct}} (สัญญากับเลน B)
      const beat = () => deps.heartbeat(job.id, quotaInfo ? { account: quotaInfo.account, remainingPct: quotaInfo.remainingPct } : {})
        .catch((e) => log('WARN', `heartbeat ${job.id}: ${e.message}`));
      beat();
      stopBeat = deps.every(cfg.heartbeatMs, beat);
    }

    let releaseBrowser = () => {};
    try {
      // ── เบราว์เซอร์ทีละงาน (ทำขนานได้ แต่โปรไฟล์ Edge มีชุดเดียว) — ล็อกไม่ได้ = ตัด browser ออกจาก TOOLS ของงานนี้ ──
      let browserOn = cfg.browser && brainKind === 'codex';
      if (browserOn) {
        const lock = deps.acquireBrowserLock
          ? deps.acquireBrowserLock(job.id)
          : acquireBrowserLock({
            file: cfg.browserLockFile, jobId: job.id, workerId: cfg.workerId, staleMs: cfg.browserLockStaleMs, fs, now,
            heldInProcess: (id) => state.browserHolder === id,
          });
        if (lock && lock.ok) {
          state.browserHolder = job.id;
          releaseBrowser = () => {
            releaseBrowser = () => {};
            if (state.browserHolder === job.id) state.browserHolder = null;
            try { if (lock.release) lock.release(); } catch { /* ไฟล์ล็อกค้าง = งานถัดไปยึดคืนเอง (staleReason) */ }
          };
          if (lock.takeover) log('WARN', `งาน ${job.id} ยึดล็อกเบราว์เซอร์ที่ค้างคืน (${String(lock.takeover.staleReason || '')})`);
        } else {
          browserOn = false;
          const holder = lock && lock.holder && lock.holder.jobId ? `งาน ${String(lock.holder.jobId).slice(0, 80)}` : 'งานอื่น';
          const why = `เบราว์เซอร์ถูกใช้โดย${holder} (${String((lock && lock.reason) || 'ล็อกไม่ได้').slice(0, 120)}) → งานนี้ตัด browser ออกจาก TOOLS`;
          toolLogExtra.push(workerNote('browser-lock', false, why));
          log('INFO', `งาน ${job.id} ${why}`);
        }
      }
      const tasteExamples = loadTasteExamples(cfg.essencesPath, job.id, 5);
      // ★ 1 ต.ค. 69 (SPEC-v3 ส่วน 10 · W4): + encodingRetry (รอบรันซ้ำเพราะไฟล์ผลเข้ารหัสผิด → ใบงานมีย่อหน้าเตือน)
      //   ของเดิม: const taskFor = (kind, effort, budget, previousRound = null) => buildTask({ …เดิม… });
      const taskFor = (kind, effort, budget, previousRound = null, encodingRetry = false) => buildTask({
        job, budget: { ...budget, effort }, brainKind: kind, tools: cfg.tools, browser: browserOn, tasteExamples, previousRound, staleDays: cfg.staleDays,
        encodingRetry,
      });
      const baseBudget = { maxCalls: cfg.maxCalls, maxMinutes: cfg.maxMinutes };
      const firstTask = taskFor(brainKind, cfg.effort, baseBudget);
      const wd = prepareWorkdir({
        root: cfg.workdirRoot, jobId: job.id, toolsDir: cfg.toolsDir, tools: cfg.tools, restricted: cfg.restrictedTools, taskText: firstTask.text, fs,
      });
      const rounds = [];
      const runRound = async (kind, effort, task, timeoutMs) => {
        const started = now();
        const res = kind === 'codex'
          ? await runCodex({ prompt: task.text, workdir: wd.dir, account, effort, timeoutMs, repoRoot: cfg.repoRoot, baseEnv: env }, { bin: cfg.codexBin })
          : await runApi({ prompt: task.text, apiKey: env.OPENAI_API_KEY || '', timeoutMs, effort, secretValues });
        const minutes = (now() - started) / 60000;
        const gated = res && res.ok && res.json
          ? runGate(res.json, { jobCreatedAt: job.createdAt, minutes, maxCalls: cfg.maxCalls, maxMinutes: cfg.maxMinutes, staleDays: cfg.staleDays, secretValues })
          : null;
        // ★ 1 ต.ค. 69 (SPEC-v3 ส่วน 10 · W4): + encoding (ผลตรวจไฟล์ผลเข้ารหัสผิด · ไม่มี JSON = null)
        //   ของเดิม: const round = { kind, effort, res: res || { ok: false, errorType: 'NO_RESULT' }, gated, minutes };
        const round = { kind, effort, res: res || { ok: false, errorType: 'NO_RESULT' }, gated, minutes, encoding: encodingOfResult(res) };
        rounds.push(round);
        log('INFO', `งาน ${job.id} รอบ ${kind}/${effort}: ${res && res.ok ? 'ได้ผล' : `ล้ม ${res && res.errorType}`}${gated ? ` · การ์ด ${gated.cards.length} (ผ่าน ${gated.stats.pass})` : ''} · ${minutes.toFixed(2)} นาที`);
        if (kind === 'codex' && res && ['CODEX_QUOTA', 'CODEX_AUTH'].includes(res.errorType || res.warning)) {
          state.cooldown = state.cooldown || {};
          state.cooldown[account] = now() + cfg.accountCooldownMs;
          log('WARN', `พักบัญชี ${account} ${Math.round(cfg.accountCooldownMs / 60000)} นาที (${res.errorType || res.warning})`);
        }
        return round;
      };

      const good = (r) => !!(r && r.gated && r.gated.ok); // ได้ JSON และผ่านด่าน 1 (schema)
      // รอบแรก
      let r1 = await runRound(brainKind, cfg.effort, firstTask, Math.min(fullMs, remaining() - 5000));
      // Codex ล้มทั้งรอบ/ผลผิดสัญญา → สำรอง API (ถ้ามีคีย์และเวลา)
      if (brainKind === 'codex' && !good(r1)) {
        if (r1.res.errorType === 'CODEX_UNAVAILABLE') addFlag('BRAIN_UNAVAILABLE');
        // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): ทางสำรอง API ปิดอยู่ (ค่าเริ่มต้น) หรืองบเดือนถึงเพดาน = ไม่เรียก API
        //   → ธง BRAIN_UNAVAILABLE (+ CODEX_AUTH/QUOTA_LOW/TOOL_BUDGET_MONTH ตามเหตุ) + เหตุผลใน tool_log · งานจบ failed (AGENT_FAILED ด้านล่าง)
        const r1Block = apiPathBlock({ env, cfg, now, fs, viaFallback: true, reason: r1.res.errorType || 'ผลผิดสัญญา 2.2' });
        if (r1Block) { for (const f of r1Block.flags) addFlag(f); toolLogExtra.push(r1Block.note); }
        // ของเดิม: if (env.OPENAI_API_KEY && remaining() >= 60000) {
        if (!r1Block && env.OPENAI_API_KEY && remaining() >= 60000) {
          addFlag('API_FALLBACK');
          toolLogExtra.push(workerNote('fallback', true, `Codex ล้ม (${r1.res.errorType || 'ผลผิดสัญญา'}) → สำรอง API`));
          releaseBrowser(); // โหมด API ไม่มีเบราว์เซอร์ — คืนล็อกให้งานอื่นทันที
          r1 = await runRound('api', 'low', taskFor('api', 'low', baseBudget), Math.min(cfg.maxMinutes * 60000, remaining() - 5000));
          brainKind = 'api';
          account = 'api';
        }
      }
      if (r1.res && (r1.res.timedOut || r1.res.warning === 'CODEX_TIMEOUT')) addFlag('AGENT_TIMEOUT');

      // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 ข้อ 3 · W4): ไฟล์ผลเข้ารหัสผิด (ไทยกลายเป็น ?)
      //   (ก) สมอง codex + เวลาถึงเส้นตายใบขอเหลือ ≥ 6 นาที + ยังไม่เคยรันซ้ำ → ย้ายไฟล์เสียไป out/round-encoding-result.json
      //       แล้วรัน Codex ซ้ำ 1 รอบในโฟลเดอร์งานเดิม (ค้นต่อจากของเดิมได้) ด้วยใบงานที่มีย่อหน้าเตือน
      //   (ข) เวลาไม่พอ / ไม่ใช่ codex / รันซ้ำแล้วยังเสียหรือไม่ได้ผล → encodingFailed (ระเบียน failed + ENCODING_BROKEN ด้านล่าง)
      //   ผลไทยปกติไม่เข้าบล็อกนี้ = เส้นทางเดิมทุกอย่าง
      let encodingFailed = false;
      if (good(r1) && encodingBrokenRound(r1)) {
        const leftMs = remaining();
        const canRetry = r1.kind === 'codex' && leftMs >= ENCODING_RETRY_MIN_LEFT_MS;
        const what = `ไฟล์ผลเข้ารหัสผิด (${summarizeEncoding(r1.encoding)})`;
        log('WARN', `งาน ${job.id} ${what} · เหลือเวลาถึงเส้นตาย ${Math.round(leftMs / 1000)} วิ → ${canRetry ? 'รันซ้ำ 1 รอบ' : 'ไม่รันซ้ำ'}`);
        if (canRetry) {
          archiveRound(wd.outDir, ENCODING_RETRY_ARCHIVE_LABEL, fs);
          const tRetry = taskFor('codex', r1.effort, {
            maxCalls: cfg.maxCalls, maxMinutes: Math.max(1, Math.min(cfg.maxMinutes, Math.floor((leftMs - 5000) / 60000))),
          }, null, true);
          try { fs.writeFileSync(path.join(wd.dir, 'TASK-encoding-retry.txt'), tRetry.text, 'utf8'); } catch { /* เก็บไว้ดูเท่านั้น */ }
          const rr = await runRound('codex', r1.effort, tRetry, Math.min(fullMs, remaining() - 5000));
          const fixed = good(rr) && !encodingBrokenRound(rr);
          const how = fixed
            ? 'รอบซ้ำไทยครบ → ใช้ผลรอบซ้ำ'
            : `รอบซ้ำ${good(rr) ? `ยังเสีย (${summarizeEncoding(rr.encoding)})` : `ไม่ได้ผล (${(rr.res && rr.res.errorType) || 'ผลผิดสัญญา'})`} → failed + ${ENCODING_FLAG}`;
          toolLogExtra.push(workerNote('encoding', fixed, `${what} → รันซ้ำ 1 รอบ: ${how}`));
          log(fixed ? 'INFO' : 'WARN', `งาน ${job.id} ${how}`);
          if (fixed) {
            r1 = rr;
            if (rr.res && (rr.res.timedOut || rr.res.warning === 'CODEX_TIMEOUT')) addFlag('AGENT_TIMEOUT');
          } else {
            encodingFailed = true;
          }
        } else {
          encodingFailed = true;
          const why = r1.kind !== 'codex' ? `สมอง ${r1.kind}` : `เหลือเวลา ${Math.round(leftMs / 1000)} วิ < ${ENCODING_RETRY_MIN_LEFT_MS / 1000} วิ`;
          toolLogExtra.push(workerNote('encoding', false, `${what} → ไม่รันซ้ำ (${why}) → failed + ${ENCODING_FLAG}`));
        }
      }

      // ยก medium (สเปกส่วน 4 / ข้อ 17)
      let final = r1;
      let escalated = false;
      const g1 = r1.gated;
      // ★ W4: + !encodingFailed (ผลเข้ารหัสผิดไม่ยก medium) · ของเดิม: เงื่อนไขเดียวกันทุกข้อ ไม่มี !encodingFailed
      //   (ไม่คัดลอกบรรทัดเดิมมาทั้งดุ้น — เทสกลายพันธุ์ M2 ของ worker แทนที่ข้อความแรกที่เจอในซอร์ส)
      if (cfg.allowMedium && cfg.effort === 'low' && r1.kind === 'codex' && good(r1) && !encodingFailed && g1.complexity === 'high') {
        const usable = g1.cards.filter((c) => c.gate !== 'dropped').length;
        const originMissing = !g1.origin_post.url;
        const left = remaining() - 5000;
        if ((usable === 0 || originMissing) && left >= 90000) {
          const reason = `เอเจนต์ประเมินว่ายาก · ${usable === 0 ? 'ไม่มีการ์ดที่ใช้ได้' : 'ไม่พบต้นทาง'} · เหลือเวลา ${Math.round(left / 1000)} วิ`;
          archiveRound(wd.outDir, 'round-low', fs);
          const used = g1.usage.tool_calls;
          const t2 = taskFor('codex', 'medium', {
            maxCalls: Math.max(4, cfg.maxCalls - used), maxMinutes: Math.max(1, Math.floor(left / 60000)),
          }, { reason, plan: g1.plan, tool_log: g1.tool_log });
          try { fs.writeFileSync(path.join(wd.dir, 'TASK-medium.txt'), t2.text, 'utf8'); } catch { /* เก็บไว้ดูเท่านั้น */ }
          const r2 = await runRound('codex', 'medium', t2, Math.min(fullMs, left));
          escalated = true;
          // ★ W4: รอบ medium ที่ไฟล์ผลเข้ารหัสผิดไม่นับว่าดีกว่า · ของเดิม: const better = good(r2) && resultValue(r2.gated) >= resultValue(g1);
          const better = good(r2) && !encodingBrokenRound(r2) && resultValue(r2.gated) >= resultValue(g1);
          if (good(r2) && encodingBrokenRound(r2)) toolLogExtra.push(workerNote('encoding', false, `รอบ medium ไฟล์ผลเข้ารหัสผิด (${summarizeEncoding(r2.encoding)}) → คงผลรอบ low`));
          if (better) final = r2;
          toolLogExtra.push(workerNote('effort low→medium', good(r2), `${reason} → ${better ? 'ใช้ผลรอบ medium' : `คงผลรอบ low (${good(r2) ? 'medium ไม่ดีกว่า' : (r2.res.errorType || 'ผลผิดสัญญา')})`}`));
          if (r2.res && (r2.res.timedOut || r2.res.warning === 'CODEX_TIMEOUT') && better) addFlag('AGENT_TIMEOUT');
        }
      }

      // ── ประกอบระเบียน ──
      const quotaAfter = brainKind === 'codex' && account !== 'api'
        ? await readQuota(account).then((q) => (q && Number.isFinite(q.remainingPct) ? q.remainingPct : null), () => null)
        : null;
      if (quotaAfter !== null && quotaAfter <= cfg.quotaAlertPct) addFlag('QUOTA_LOW');
      const brain = { kind: final.kind, model: 'gpt-6-astra', effort: escalated ? 'medium' : final.effort, account: final.kind === 'api' ? 'api' : account, quotaPctAfter: quotaAfter };
      const totalMinutes = rounds.reduce((s, r) => s + r.minutes, 0);
      const gateCost = rounds.reduce((s, r) => s + (r.gated ? r.gated.usage.costUsd : 0), 0);
      const apiCost = rounds.reduce((s, r) => s + (r.kind === 'api' && r.res && Number(r.res.costUsd) > 0 ? Number(r.res.costUsd) : 0), 0);
      const toolCalls = rounds.reduce((s, r) => s + (r.gated ? r.gated.usage.tool_calls : 0), 0);
      const codexTokens = rounds.reduce((s, r) => s + (r.kind === 'codex' && Number(r.res && r.res.tokensUsed) > 0 ? Number(r.res.tokensUsed) : 0), 0);
      const usage = { tool_calls: toolCalls, minutes: totalMinutes, costUsd: gateCost + apiCost, codexTokens };
      const spend = addMonthSpend({ logDir: cfg.logDir, costUsd: usage.costUsd, capUsd: cfg.toolBudgetUsdMonth, now, fs });
      if (spend.reached) {
        addFlag('TOOL_BUDGET_MONTH');
        // ★ 1 ต.ค. 69 (W5): ถึงเพดานแล้ว = ทาง API หยุดจริงตั้งแต่งานถัดไป (apiPathBlock) · รอบ Codex ทำต่อพร้อมธงเตือน (เจ้าของ#18)
        //   ของเดิม: log('WARN', `ค่าเครื่องมือเดือนนี้ $${spend.spentAfter} ถึงเพดาน $${spend.capUsd} แล้ว (เตือนเท่านั้น ไม่หยุด)`);
        log('WARN', `ค่าเครื่องมือเดือนนี้ $${spend.spentAfter} ถึงเพดาน $${spend.capUsd} แล้ว (ทาง API หยุดตั้งแต่งานถัดไป · Codex ทำต่อพร้อมธงเตือน)`);
      }
      // tool_log รวมทุกรอบตามลำดับเวลา (ไม่เกินเพดาน)
      const mergedLog = [];
      for (const r of rounds) {
        if (good(r)) mergedLog.push(...r.gated.tool_log);
        else if (r.gated) mergedLog.push(workerNote(`${r.kind}/${r.effort}`, false, `ผลผิดสัญญา 2.2: ${r.gated.errors.join(' · ')}`));
        else mergedLog.push(workerNote(`${r.kind}/${r.effort}`, false, `${r.res.errorType || 'ล้ม'}: ${redactSecrets(r.res.error || '', secretValues)}`));
      }
      mergedLog.push(...toolLogExtra);
      const toolLog = mergedLog.slice(-LIMITS.toolLog);

      if (!good(final)) {
        addFlag('AGENT_FAILED');
        return finish(buildCardRecord({ jobId: job.id, status: 'failed', mode, brain, flags, usage, toolLog, nowIso: new Date(now()).toISOString() }));
      }
      // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 10 ข้อ 3 ข · W4): ไฟล์ผลเข้ารหัสผิดทั้งรอบ (เวลาไม่พอรันซ้ำ / รันซ้ำแล้วยังเสีย)
      //   → status 'failed' + ธง ENCODING_BROKEN · การ์ดทุกใบ gate=dropped (ไม่ส่งบรรณาธิการ/ไม่โชว์เป็นข้อเท็จจริง) ·
      //   ไม่ใส่แผน/ต้นทาง/ข้อแก้/มุมเสนอ/ธงของเอเจนต์ (ข้อความเสีย อ่านไม่ได้) · tool_log/usage จริงคงไว้ตรวจย้อนหลัง
      if (encodingFailed) {
        addFlag(ENCODING_FLAG);
        return finish(buildCardRecord({
          jobId: job.id, status: 'failed', mode, brain, gated: { cards: dropCardsForEncoding(final.gated.cards) }, flags, usage, toolLog,
          nowIso: new Date(now()).toISOString(),
        }));
      }
      if (final.gated.stats && final.gated.stats.browser) log('INFO', `งาน ${job.id} เบราว์เซอร์: ${String(final.gated.stats.browser).slice(0, 120)}`);
      return finish(buildCardRecord({
        jobId: job.id, status: 'done', mode, brain, gated: final.gated, flags, usage, toolLog, nowIso: new Date(now()).toISOString(),
      }));
    } finally {
      try { releaseBrowser(); } catch { /* ไม่สำคัญ — ล็อกค้างถูกยึดคืนได้ */ }
      try { stopBeat(); } catch { /* ไม่สำคัญ */ }
    }
  } catch (e) {
    log('ERROR', `งาน ${job.id} พังภายใน worker: ${redactSecrets(String((e && e.stack) || e), secretValues).slice(0, 400)}`);
    return finish(buildCardRecord({
      jobId: job.id, status: 'failed', mode, brain: { kind: cfg.brain, effort: cfg.effort, account: 'none' }, flags: ['AGENT_FAILED'],
      toolLog: [workerNote('worker', false, `พังภายใน: ${redactSecrets(String((e && e.message) || e), secretValues)}`)], nowIso: new Date(now()).toISOString(),
    }));
  }
}

/**
 * ลูปหลัก — คืนเหตุผลที่หยุด ('stopped' | 'idle' | 'done' | 'error')
 * ทำขนานได้ cfg.concurrency งาน (once = งานเดียวแล้วออก) · เต็มแล้วไม่ขอเพิ่ม (รองานใดงานหนึ่งจบก่อน) ·
 * ธงหยุด = ไม่รับงานใหม่ + รองานที่ค้างทุกงานส่งผลให้จบก่อนออก (forever.cmd จะรอจนลบธง)
 * @param {object} ctx { cfg, env, api, deps:{sleep, fs, log, now, every, ...processJob deps}, once }
 */
export async function workerLoop(ctx) {
  const { cfg, api, once = false } = ctx;
  const deps = ctx.deps || {};
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const fs = deps.fs || nodeFs;
  const log = deps.log || (() => {});
  const state = ctx.state || { cooldown: {} };
  const limit = once ? 1 : Math.min(MAX_CONCURRENCY, Math.max(1, Number(cfg.concurrency) || 1));
  const active = new Map(); // jobId → promise ของงานที่ยังรัน (ไม่ reject — runOne จับทุกอย่างเอง)
  let errors = 0;

  /** งาน 1 ชิ้น: ทำ → ส่งผล → เก็บกวาดโฟลเดอร์เก่า (ไม่ลบโฟลเดอร์ของงานที่ยังรันอยู่) */
  const runOne = async (job, leaseMode, jobId) => {
    try {
      const { record, summary } = await processJob(job, {
        cfg, env: ctx.env || process.env, state, leaseMode,
        deps: { ...deps, heartbeat: (id, extra) => api.heartbeat(id, extra) },
      });
      if (record) {
        try {
          await api.report(jobId, record);
          log('INFO', `ส่งผลงาน ${jobId}: ${summary.status} · การ์ด ${summary.cards} · ธง ${summary.flags.join(',') || '-'} · ${summary.brain}/${summary.effort}`);
        } catch (e) {
          log('ERROR', `ส่งผลงาน ${jobId} ไม่สำเร็จ (${e.status || 'เน็ต'}): ${e.message} — ไม่ทำซ้ำ (กันเผาโควตา) ปล่อยให้เส้นตายฝั่งเว็บจัดการ`);
        }
      }
    } catch (e) {
      log('ERROR', `งาน ${jobId} พังนอก processJob: ${redactSecrets(String((e && e.message) || e), deps.secretValues || []).slice(0, 300)}`);
    }
    try {
      pruneWorkdirs({ root: cfg.workdirRoot, keep: cfg.keepWorkdirs, fs, exceptDir: [...active.keys()].map((id) => path.join(cfg.workdirRoot, id)) });
    } catch { /* retention ล้มไม่เป็นไร */ }
  };

  /* eslint-disable no-await-in-loop -- ลูปรับงาน: รอ lease/ช่องว่างตามลำดับ (ตั้งใจ · งานรันขนานผ่าน runOne) */
  for (;;) {
    if (fs.existsSync(cfg.stopFile)) {
      if (active.size) {
        log('INFO', `พบธงหยุด ${cfg.stopFile} — ไม่รับงานใหม่ รองานที่ค้าง ${active.size} งานส่งผลให้จบก่อน`);
        await Promise.all(active.values());
      }
      log('INFO', `พบธงหยุด ${cfg.stopFile} — ไม่รับงานใหม่ ออกจาก worker`);
      return 'stopped';
    }
    if (active.size >= limit) {
      await Promise.race(active.values()); // เต็ม = ไม่ขอเพิ่ม รอให้ว่างสักช่อง
      continue;
    }
    let lease;
    try {
      lease = await api.lease();
      errors = 0;
    } catch (e) {
      errors++;
      const wait = Math.min(cfg.maxErrMs, cfg.errMs * errors);
      log('WARN', `ขอรับงานไม่สำเร็จ (${e.status || 'เน็ต'}): ${e.message} — รอ ${Math.round(wait / 1000)} วิ`);
      if (once && errors >= 3) return 'error';
      await sleep(wait);
      continue;
    }
    if (!lease.job) {
      if (once) return 'idle';
      await sleep(cfg.idleMs);
      continue;
    }
    const jobId = String(lease.job.id || '');
    if (active.has(jobId)) { // กันทำงานเดียวกันซ้อน (โฟลเดอร์งานเดียวกันจะถูกลบทิ้งกลางทาง)
      log('WARN', `ได้งาน ${jobId.slice(0, 80)} ซ้ำขณะยังทำอยู่ — ข้าม (รอบที่กำลังทำจะส่งผลเอง)`);
      await sleep(cfg.idleMs);
      continue;
    }
    log('INFO', `รับงาน ${jobId.slice(0, 80)}${limit > 1 ? ` (ทำพร้อมกัน ${active.size + 1}/${limit})` : ''}`);
    const p = runOne(lease.job, lease.mode, jobId).finally(() => { active.delete(jobId); });
    active.set(jobId, p);
    if (once) {
      await p;
      return 'done';
    }
  }
  /* eslint-enable no-await-in-loop */
}

// ── CLI ───────────────────────────────────────────────────────────────────
async function main(argv) {
  try { process.loadEnvFile(path.join(REPO_ROOT, '.env.local')); } catch (e) {
    if (e && e.code !== 'ENOENT') process.stderr.write(`[research-agent] โหลด .env.local ไม่ได้: ${e.message}\n`);
  }
  const cfg = loadConfig(process.env);
  if (argv.includes('--stop')) {
    nodeFs.mkdirSync(path.dirname(cfg.stopFile), { recursive: true });
    nodeFs.writeFileSync(cfg.stopFile, `stop requested ${new Date().toISOString()}\n`, 'utf8');
    process.stdout.write(`วางธงหยุดแล้ว: ${cfg.stopFile}\n`);
    return 0;
  }
  if (argv.includes('--resume')) {
    nodeFs.rmSync(cfg.stopFile, { force: true });
    process.stdout.write('ลบธงหยุดแล้ว\n');
    return 0;
  }
  const secretValues = secretValuesOf(process.env);
  const log = createLogger({ logDir: cfg.logDir, maxBytes: cfg.logMaxBytes, keep: cfg.logKeep, secretValues });
  if (argv.includes('--check')) {
    const lines = [
      `apiBase: ${cfg.apiBase || '(ไม่ได้ตั้ง)'} · secret: ${cfg.secret ? 'ตั้งแล้ว' : 'ไม่ได้ตั้ง'} · workerId: ${cfg.workerId}`,
      `brain: ${cfg.brain} · effort: ${cfg.effort} · ยก medium: ${cfg.allowMedium ? 'เปิด' : 'ปิด'} · งบ ${cfg.maxCalls} ครั้ง/${cfg.maxMinutes} นาที`,
      `เครื่องมือ: ${cfg.tools.join(',')} · เบราว์เซอร์: ${cfg.browser ? 'เปิด' : 'ปิด'} · บัญชี: ${cfg.accounts.join(',')} · เตือนโควตา ≤${cfg.quotaAlertPct}%`,
      `workdir: ${cfg.workdirRoot} · log: ${cfg.logDir} · ธงหยุด: ${nodeFs.existsSync(cfg.stopFile) ? 'มี' : 'ไม่มี'} · OPENAI_API_KEY (สำรอง): ${process.env.OPENAI_API_KEY ? 'มี' : 'ไม่มี'}`
        + ` · เครื่องมือ web-agent (อ่าน .env.local เอง — worker ไม่ส่งคีย์นี้ให้ Codex): ${envLocalHas('OPENAI_API_KEY', { repoRoot: cfg.repoRoot }) ? 'มีคีย์' : 'ไม่มีคีย์ใน .env.local'}`,
      `ทำพร้อมกัน: ${cfg.concurrency} งาน (เบราว์เซอร์ทีละงาน · ล็อก ${cfg.browserLockFile}: ${(() => { const h = readBrowserLock(cfg.browserLockFile); return h ? `ถือโดยงาน ${String(h.jobId || '?').slice(0, 80)} pid ${h.pid}` : 'ว่าง'; })()}) · เกณฑ์ข่าวเก่า: ${cfg.staleDays} วัน (ธงอย่างเดียว)`,
    ];
    // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): สถานะทาง API (เงินจริง) — ทางสำรองปิดเป็นค่าเริ่มต้น · งบเดือนถึงเพดาน = ทาง API หยุด
    lines.push(`ทางสำรอง OpenAI API: ${apiFallbackEnabled(process.env) ? 'เปิด (RESEARCH_AGENT_API_FALLBACK=1 · เสียเงินจริง $10/$50 ต่อ 1M)' : 'ปิด (ค่าเริ่มต้น — Codex ใช้ไม่ได้ = งานนั้นล้ม + ธง BRAIN_UNAVAILABLE)'}`
      + ` · งบเดือนนี้ (เพดาน $${cfg.toolBudgetUsdMonth}): ${monthSpendReached({ logDir: cfg.logDir, capUsd: cfg.toolBudgetUsdMonth }) ? 'ถึงเพดานแล้ว — ทาง API หยุด' : 'ยังไม่ถึง'}`);
    for (const name of cfg.accounts) {
      const q = await realReadQuota(name); // eslint-disable-line no-await-in-loop -- ทีละบัญชี
      lines.push(`บัญชี ${name}: ${q.status} · เหลือ ${q.remainingPct === null ? '-' : `${q.remainingPct}%`}${q.note ? ` · ${q.note}` : ''}`);
    }
    const probs = configProblems(cfg);
    if (probs.length) lines.push(`⚠️ ${probs.join(' · ')}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return probs.length ? 3 : 0;
  }
  const probs = configProblems(cfg);
  if (probs.length) {
    log('ERROR', `ค่าตั้งไม่ครบ: ${probs.join(' · ')}`);
    return 3;
  }
  const api = createApi({ apiBase: cfg.apiBase, secret: cfg.secret, workerId: cfg.workerId });
  log('INFO', `เริ่ม worker ${cfg.workerId} → ${cfg.apiBase} · brain ${cfg.brain}/${cfg.effort} · บัญชี ${cfg.accounts.join(',')}`);
  const every = (ms, fn) => { const t = setInterval(fn, ms); return () => clearInterval(t); };
  const why = await workerLoop({ cfg, api, env: process.env, once: argv.includes('--once'), deps: { log, every, secretValues } });
  log('INFO', `worker หยุด: ${why}`);
  return why === 'error' ? 1 : 0;
}

const isMain = (() => {
  try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`[research-agent] crashed: ${redactSecrets(String((e && e.stack) || e), secretValuesOf(process.env)).slice(0, 600)}\n`);
    process.exitCode = 1;
  });
}
