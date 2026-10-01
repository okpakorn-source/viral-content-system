/**
 * 🔑 scripts/research-agent/accounts.mjs — บัญชี Codex ของเอเจนต์รีเสิร์ช + ตัวอ่านโควตา (SPEC-v2 ข้อ 16 · ส่วน 8)
 * ─────────────────────────────────────────────────────────────────────────────
 * - ลำดับบัญชี: RESEARCH_AGENT_CODEX_ACCOUNTS="main,b,c" → ไม่ตั้ง = CODEX_ACCOUNT (บัญชีเดียว) → ไม่ตั้ง = main
 *   main = ~/.codex · ตัวอักษร x = ~/.codex-x (แบบเดียวกับ add-codex-account.ps1 ของ skill auto-account)
 * - โควตา: อ่าน auth.json ของบัญชีแล้วถาม endpoint เดียวกับ /status ของ CLI (chatgpt.com/backend-api/wham/usage)
 *   ฟรี ไม่เผาโทเคน (ตรรกะเดียวกับ ~/.claude/skills/auto-account/scripts/quota.mjs แต่เขียนใหม่ใน repo
 *   ให้เครื่องทีม/แผนสำรองใช้ได้ และฉีด fetch/fs ได้ตอนเทส) · ไม่ refresh โทเคนเอง (refresh = เรียก codex = ใช้โควตา)
 *   ห้ามพิมพ์/คืนค่าโทเคน — คืนเฉพาะ % ที่ใช้/เหลือ เวลารีเซ็ต สถานะ (และอีเมลเฉพาะตาราง CLI ของเจ้าของ)
 * - เลือกบัญชี: เหลือ ≤ 5% (RESEARCH_AGENT_QUOTA_SWITCH_PCT ไม่มี — ค่าคงที่ตามสเปก) → ข้ามไปบัญชีถัดไป ·
 *   ทุกบัญชีใช้ไม่ได้ → โหมด api · บัญชีที่เลือกเหลือ ≤ RESEARCH_AGENT_QUOTA_ALERT_PCT (15) → ธง QUOTA_LOW
 * - CLI (เรียกจาก scripts/research-agent-account.cmd ที่ cd ไปรากโปรเจกต์แล้ว):
 *     node scripts/research-agent/accounts.mjs status            ตารางโควตาทุกบัญชีในเครื่อง
 *     node scripts/research-agent/accounts.mjs use b[,main,...]  เขียน RESEARCH_AGENT_CODEX_ACCOUNTS ใน .env.local
 *     node scripts/research-agent/accounts.mjs list              ลำดับบัญชีที่ worker จะใช้
 *     node scripts/research-agent/accounts.mjs check-name b      ตรวจชื่อบัญชี (exit 2 = ผิดรูป)
 * ไม่อ้างตำแหน่งไฟล์ตัวเอง (เทสกลายพันธุ์โหลดสำเนาได้) — CLI ใช้ process.cwd() เป็นรากโปรเจกต์
 */
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const QUOTA_SWITCH_PCT = 5;
export const DEFAULT_ALERT_PCT = 15;
const NAME_RE = /^[A-Za-z0-9_]{1,32}$/;

/** ตรวจชื่อบัญชี: main หรือ ตัวอักษร/ตัวเลข/ขีดล่าง ≤ 32 */
export function isValidAccountName(name) {
  const s = String(name == null ? '' : name).trim();
  return s === 'main' || NAME_RE.test(s);
}

/** ลำดับบัญชีจาก env (ซ้ำ/ผิดรูปถูกตัด · สูงสุด 6) */
export function accountOrder(env = process.env) {
  const raw = String(env.RESEARCH_AGENT_CODEX_ACCOUNTS || '').trim() || String(env.CODEX_ACCOUNT || '').trim() || 'main';
  const out = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (s && isValidAccountName(s) && !out.includes(s)) out.push(s);
  }
  return (out.length ? out : ['main']).slice(0, 6);
}

/** โฟลเดอร์ CODEX_HOME ของบัญชี */
export function accountDir(name, homeDir = os.homedir()) {
  return name === 'main' ? path.join(homeDir, '.codex') : path.join(homeDir, `.codex-${name}`);
}

/** บัญชีที่มีโฟลเดอร์อยู่ในเครื่อง (~/.codex, ~/.codex-*) */
export function discoverAccounts({ homeDir = os.homedir(), fs = nodeFs } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(homeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\.codex(-[A-Za-z0-9_]+)?$/.test(d.name))
      .map((d) => (d.name === '.codex' ? 'main' : d.name.slice('.codex-'.length)));
  } catch { names = []; }
  return names.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)));
}

const jwtClaims = (t) => {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
};
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * อ่านโควตาบัญชีเดียว (ฟรี) — ไม่โยน error
 * @returns {Promise<{account:string, dir:string, status:string, usedPct:number|null, remainingPct:number|null,
 *   resetAt:string|null, plan:string|null, email:string|null, note:string}>}
 */
export async function readQuota(name, { homeDir = os.homedir(), fs = nodeFs, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  return readQuotaAtDir(accountDir(name, homeDir), name, { fs, fetchImpl, timeoutMs });
}

/** อ่านโควตาจากโฟลเดอร์บัญชีตรง (ใช้กับ CODEX_HOME ที่ตั้งไว้ — เครื่องมือ tools/quota.mjs) */
export async function readQuotaAtDir(dir, name = 'main', { fs = nodeFs, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const base = { account: name, dir, status: 'LOGGED_OUT', usedPct: null, remainingPct: null, resetAt: null, plan: null, email: null, note: '' };
  let auth = null;
  try { auth = JSON.parse(fs.readFileSync(path.join(dir, 'auth.json'), 'utf8')); } catch { auth = null; }
  const tok = auth && auth.tokens && auth.tokens.access_token;
  if (!tok) return { ...base, note: auth && auth.OPENAI_API_KEY ? 'โหมด API key ไม่ใช่แพ็กเกจ ChatGPT' : 'ยังไม่ได้ล็อกอิน' };
  const idc = jwtClaims(auth.tokens.id_token) || {};
  const oa = (jwtClaims(tok) || {})['https://api.openai.com/auth'] || idc['https://api.openai.com/auth'] || {};
  const accountId = oa.chatgpt_account_id || auth.tokens.account_id || null;
  base.email = idc.email || null;
  base.plan = oa.chatgpt_plan_type || null;
  let res;
  try {
    const headers = { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'User-Agent': 'codex-cli' };
    if (accountId) headers['chatgpt-account-id'] = accountId;
    const r = await fetchImpl(CODEX_USAGE_URL, { headers, signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    res = { status: r.status, body };
  } catch (e) {
    return { ...base, status: 'ERROR', note: `เรียกโควตาไม่ได้: ${String((e && e.message) || e).slice(0, 120)}` };
  }
  if (res.status === 401 || res.status === 403) return { ...base, status: 'TOKEN_STALE', note: 'โทเคนเก่า — เปิด codex บัญชีนี้สักครั้งให้ต่ออายุ' };
  if (res.status !== 200 || !res.body) return { ...base, status: 'ERROR', note: `HTTP ${res.status}` };
  const b = res.body;
  const rl = b.rate_limit || {};
  const p1 = Number(rl.primary_window && rl.primary_window.used_percent);
  const p2 = Number(rl.secondary_window && rl.secondary_window.used_percent);
  const used = Math.max(Number.isFinite(p1) ? p1 : 0, Number.isFinite(p2) ? p2 : 0);
  const resetSec = [rl.primary_window, rl.secondary_window]
    .filter((w) => w && Number.isFinite(Number(w.used_percent)) && Number(w.used_percent) === used && w.reset_at)
    .map((w) => Number(w.reset_at))[0];
  const out = {
    ...base,
    email: b.email || base.email,
    plan: b.plan_type || base.plan,
    usedPct: round1(used),
    remainingPct: round1(Math.max(0, 100 - used)),
    resetAt: Number.isFinite(resetSec) ? new Date(resetSec * 1000).toISOString() : null,
    status: 'OK',
  };
  if (rl.allowed === false) return { ...out, status: 'LOCKED', remainingPct: 0, note: 'ถูกล็อก' };
  if (rl.limit_reached) return { ...out, status: 'FULL', remainingPct: 0, note: 'ใช้ครบเพดานแล้ว' };
  return out;
}

/**
 * เลือกบัญชีสำหรับงานถัดไป (ตามสเปกส่วน 8)
 * @param {string[]} order
 * @param {Record<string, object>} quotas  ผล readQuota ต่อบัญชี (ไม่มี = ไม่รู้โควตา → ถือว่าใช้ได้)
 * @param {{alertPct?:number, switchPct?:number}} [opts]
 * @returns {{account:string|null, useApi:boolean, quotaLow:boolean, remainingPct:number|null, reason:string, skipped:string[]}}
 */
export function chooseAccount(order, quotas = {}, { alertPct = DEFAULT_ALERT_PCT, switchPct = QUOTA_SWITCH_PCT } = {}) {
  const skipped = [];
  for (const name of order) {
    const q = quotas[name];
    const unusable = q && (q.status === 'LOGGED_OUT' || q.status === 'FULL' || q.status === 'LOCKED'
      || (Number.isFinite(q.remainingPct) && q.remainingPct <= switchPct));
    if (unusable) { skipped.push(`${name}:${q.status}${Number.isFinite(q.remainingPct) ? `(${q.remainingPct}%)` : ''}`); continue; }
    const rem = q && Number.isFinite(q.remainingPct) ? q.remainingPct : null;
    return {
      account: name, useApi: false, quotaLow: rem !== null && rem <= alertPct, remainingPct: rem,
      reason: skipped.length ? `สลับจาก ${skipped.join(', ')}` : 'บัญชีแรกในลำดับ', skipped,
    };
  }
  return { account: null, useApi: true, quotaLow: true, remainingPct: null, reason: `ทุกบัญชีใช้ไม่ได้ (${skipped.join(', ')})`, skipped };
}

/** เขียน/แทนบรรทัด KEY=VALUE ใน .env.local (คงบรรทัดอื่น + รูปแบบขึ้นบรรทัดเดิม) — คืนข้อความใหม่ */
export function upsertEnvLine(text, key, value) {
  const src = String(text || '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.length ? src.split(/\r?\n/) : [];
  const re = new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  let replaced = false;
  const out = lines.map((l) => {
    if (re.test(l)) { replaced = true; return `${key}=${value}`; }
    return l;
  });
  if (!replaced) {
    if (out.length && out[out.length - 1] === '') out.splice(out.length - 1, 0, `${key}=${value}`);
    else out.push(`${key}=${value}`);
  }
  let joined = out.join(eol);
  if (!joined.endsWith(eol)) joined += eol;
  return joined;
}

/** ลำดับใหม่เมื่อสั่ง use: ชื่อที่สั่งก่อน ตามด้วยบัญชีอื่นที่มีในเครื่อง (ไม่ซ้ำ) */
export function orderForUse(requested, discovered) {
  const req = String(requested || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const r of req) if (!isValidAccountName(r)) throw new Error(`ชื่อบัญชีผิดรูป: ${r.slice(0, 40)}`);
  const out = [];
  for (const n of [...req, ...(discovered || [])]) if (!out.includes(n)) out.push(n);
  return out.slice(0, 6);
}

function pad(s, n) { return String(s == null ? '-' : s).padEnd(n); }

/** ตารางโควตา (ข้อความ) — แสดงในเครื่องเจ้าของเท่านั้น */
export function formatQuotaTable(rows, order) {
  const lines = [];
  lines.push(`${pad('บัญชี', 8)}${pad('ลำดับ', 7)}${pad('ใช้ไป', 8)}${pad('เหลือ', 8)}${pad('สถานะ', 12)}${pad('รีเซ็ต', 20)}อีเมล/หมายเหตุ`);
  for (const r of rows) {
    const idx = order.indexOf(r.account);
    lines.push(`${pad(r.account, 8)}${pad(idx >= 0 ? idx + 1 : '-', 7)}${pad(r.usedPct === null ? '-' : `${r.usedPct}%`, 8)}`
      + `${pad(r.remainingPct === null ? '-' : `${r.remainingPct}%`, 8)}${pad(r.status, 12)}${pad(r.resetAt ? r.resetAt.slice(0, 16).replace('T', ' ') : '-', 20)}`
      + `${[r.email, r.note].filter(Boolean).join(' · ')}`);
  }
  return lines.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────
async function cli(argv) {
  const [cmd, arg] = argv;
  const root = process.cwd();
  const envFile = path.join(root, '.env.local');
  try { process.loadEnvFile(envFile); } catch { /* ไม่มีไฟล์ก็ได้ */ }
  const write = (s) => process.stdout.write(`${s}\n`);
  if (cmd === 'check-name') {
    if (!isValidAccountName(arg)) { process.stderr.write(`ชื่อบัญชีผิดรูป (ใช้ main หรือ a-z 0-9 _): ${String(arg || '').slice(0, 40)}\n`); return 2; }
    return 0;
  }
  if (cmd === 'list') { write(accountOrder().join(',')); return 0; }
  if (cmd === 'use') {
    if (!arg) { process.stderr.write('ใช้: use <บัญชี>[,<บัญชี>...]\n'); return 2; }
    let order;
    try { order = orderForUse(arg, discoverAccounts()); } catch (e) { process.stderr.write(`${e.message}\n`); return 2; }
    let text = '';
    try { text = nodeFs.readFileSync(envFile, 'utf8'); } catch { text = ''; }
    nodeFs.writeFileSync(envFile, upsertEnvLine(text, 'RESEARCH_AGENT_CODEX_ACCOUNTS', order.join(',')), 'utf8');
    process.env.RESEARCH_AGENT_CODEX_ACCOUNTS = order.join(',');
    write(`ตั้ง RESEARCH_AGENT_CODEX_ACCOUNTS=${order.join(',')} ใน .env.local แล้ว (รีสตาร์ต worker ให้มีผล)`);
  }
  if (cmd === 'status' || cmd === 'use') {
    const order = accountOrder();
    const names = [...new Set([...order, ...discoverAccounts()])];
    const rows = [];
    for (const n of names) rows.push(await readQuota(n)); // eslint-disable-line no-await-in-loop -- ทีละบัญชี (ไม่ยิงพร้อมกัน)
    write(formatQuotaTable(rows, order));
    const pick = chooseAccount(order, Object.fromEntries(rows.map((r) => [r.account, r])), {
      alertPct: Number(process.env.RESEARCH_AGENT_QUOTA_ALERT_PCT) || DEFAULT_ALERT_PCT,
    });
    write(pick.account ? `worker จะใช้: ${pick.account}${pick.quotaLow ? ' (⚠️ โควตาเหลือน้อย)' : ''}` : `⚠️ ${pick.reason} → worker จะใช้โหมด API`);
    return 0;
  }
  process.stderr.write('ใช้: node scripts/research-agent/accounts.mjs status | use <บัญชี> | list | check-name <บัญชี>\n');
  return 2;
}

const invokedDirectly = (() => {
  try { return /[\\/]research-agent[\\/]accounts\.mjs$/i.test(path.resolve(process.argv[1] || '')); } catch { return false; }
})();
if (invokedDirectly) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`accounts: ${String((e && e.message) || e).slice(0, 200)}\n`);
    process.exitCode = 1;
  });
}
