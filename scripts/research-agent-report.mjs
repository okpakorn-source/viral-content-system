#!/usr/bin/env node
/**
 * 📊 scripts/research-agent-report.mjs — รายงานผลเอเจนต์รีเสิร์ช v2 (อ่านอย่างเดียว)
 * ★ 1 ต.ค. 69 (SPEC-v2 ส่วน 10 · เลน D ops+docs · สเปกล็อกตามคำตอบเจ้าของ 25 ข้อ 1 ต.ค. 69)
 * ─────────────────────────────────────────────────────────────
 * อ่านจาก Supabase REST ด้วย GET เท่านั้น (ไฟล์นี้ไม่มี POST/PATCH/DELETE · ไม่ import โค้ดใน src/):
 *   1) store_items   store_name = 'research-cards'  การ์ดที่ worker รายงานผ่าน /api/research/report (สัญญาสเปกข้อ 2.2)
 *   2) pipeline_logs step = 'research-agent'         สิ่งที่ท่อข่าวเห็นตอน PRE-GENERATE (สเปกข้อ 9–10)
 * สรุป: งาน/วัน · พบต้นทาง % · การ์ด/งาน · 👍/👎 · เวลา p50/p90 · โควตา Codex ใช้/วัน · ค่าเครื่องมือ (ช่วงนี้ + เดือนนี้เทียบเพดาน)
 *
 * ใช้ (รันจากโฟลเดอร์ไหนก็ได้ — ค่าเริ่มต้นโหลด <ราก repo>/.env.local · ค่าที่ตั้งใน shell อยู่แล้วชนะไฟล์):
 *   node scripts/research-agent-report.mjs                    7 วันปฏิทินเวลาไทยล่าสุด (รวมวันนี้)
 *   node scripts/research-agent-report.mjs --days 3           3 วัน (1–90)
 *   node scripts/research-agent-report.mjs --json             พิมพ์ JSON ทั้งก้อน (ต่อสคริปต์/แดชบอร์ดอื่น)
 *   node scripts/research-agent-report.mjs --env <path>       ใช้ไฟล์ env อื่น (เช่นรันจาก worktree ที่ไม่มี .env.local)
 *   ⚠️ ห้ามตั้งชื่อธงเป็น --env-file: Node 24 สแกน --env-file แม้อยู่หลังชื่อสคริปต์ — ไฟล์ไม่มีจริง = node ตายเอง exit 9
 *      ก่อนสคริปต์ได้รัน (ทดสอบจริง 1 ต.ค. 69 · node v24.15.0) จึงใช้ --env
 * env ที่อ่าน (ชื่อเท่านั้น — สคริปต์ไม่พิมพ์ค่า URL/คีย์ใดๆ แม้ตอน error):
 *   NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL · SUPABASE_SERVICE_KEY | SUPABASE_SERVICE_ROLE_KEY | NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH (ไม่ตั้ง = 10) · RESEARCH_AGENT_QUOTA_ALERT_PCT (ไม่ตั้ง = 15)
 * exit: 0 สำเร็จ (ไม่มีข้อมูลก็ 0) · 1 อ่านฐานข้อมูลไม่สำเร็จ (ยังพิมพ์ส่วนที่อ่านได้ + ⚠️) · 2 อาร์กิวเมนต์/env ไม่ครบ
 *
 * นิยามตัวเลข (เทสกัดจริง + mutation อยู่ที่ tests/research-agent-report.test.mjs):
 *   - วัน = ปฏิทิน Asia/Bangkok (UTC+7 ไม่มีเวลาออมแสง) จาก createdAt ของการ์ด / created_at ของ pipeline_logs
 *   - งาน = แถว research-cards 1 แถว (id = jobId) แยก done/failed/skipped
 *   - พบต้นทาง = origin_post.url เป็น http(s) · ไม่ใช่เพจเราเอง (facebook.com/IG.dara) · ไม่มีธง ORIGIN_NOT_FOUND — % คิดจากงาน done
 *   - การ์ด/งาน = จำนวน cards[] เฉลี่ยต่องาน done (แยก gate pass/staff_only/dropped)
 *   - 👍/👎 = feedback[] หลังตัดซ้ำ (คนเดิม + การ์ดเดิม เอาโหวตที่ at ล่าสุด)
 *   - p50/p90 = nearest-rank · เวลาเอเจนต์ = usage.minutes
 *   - เวลาท่อรอ = "เวลาที่ท่อข่าวรอเพิ่มจริง" ที่ PRE-GENERATE หลัง Blueprint จบ = metadata.waitedMs ของ pipeline_logs
 *     (readCards เลน B · shadow ปกติ 0) — ★ contract-check #5 (1 ต.ค. 69): metadata.ms คือเวลาตั้งแต่เริ่ม poll ขนานกับ Blueprint
 *     (ไม่ใช่เวลารอ) จึงใช้เป็นค่าสำรองเฉพาะแถวที่ไม่มี waitedMs → ไม่มีทั้งคู่ใช้คอลัมน์ duration_ms
 *     (waitedMs = 0 เป็นค่าจริง "ไม่ได้รอ" ห้ามตกไปใช้ ms)
 *   - โควตาใช้ = ผลรวม "ส่วนที่ลดลง" ของ brain.quotaPctAfter (% คงเหลือหลังงาน — สเปกข้อ 8: ≤15% = QUOTA_LOW)
 *     ระหว่างงานติดกันของบัญชีเดียวกัน (ค่าที่เพิ่มขึ้น = รอบโควตารีเซ็ต ไม่นับ) — เป็นค่าประมาณ
 *   - ค่าเครื่องมือ = ผลรวม usage.costUsd (worker คิดจาก tool_log ตามตารางราคา) · เดือนนี้นับตั้งแต่วันที่ 1 เวลาไทย
 */
import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CARDS_STORE = 'research-cards';
export const PIPELINE_STEP = 'research-agent';
export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 90;
export const PAGE_SIZE = 500;
export const MAX_PAGES = 200; // เพดานกันวนไม่จบ: 100,000 แถวต่อแหล่ง
export const REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_TOOL_BUDGET_USD_MONTH = 10;
export const DEFAULT_QUOTA_ALERT_PCT = 15;
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok = UTC+7 ตลอดปี
const DAY_MS = 24 * 60 * 60 * 1000;
const OWN_PAGE_RE = /(^|[/.])facebook\.com\/ig\.dara(?:[/?#]|$)/i; // เพจเราเอง — ห้ามนับเป็นต้นทาง (สเปกข้อ 4/6)
const URL_ENV_NAMES = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'];
const KEY_ENV_NAMES = ['SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const CARD_STATUSES = ['done', 'failed', 'skipped'];
const GATES = ['pass', 'staff_only', 'dropped'];

// ดึงเฉพาะช่องที่ใช้ (ไม่ดึง tool_log/plan/หลักฐานเต็ม — แถวการ์ดใหญ่) · ไวยากรณ์ PostgREST: alias:column->key
const CARD_SELECT = [
  'id', 'created_at',
  'createdAt:data->>createdAt', 'status:data->>status', 'mode:data->>mode',
  'brain:data->brain', 'origin_post:data->origin_post', 'cards:data->cards', 'flags:data->flags',
  'raw_corrections:data->raw_corrections', 'usage:data->usage', 'feedback:data->feedback',
].join(',');
const LOG_SELECT = 'id,workflow_id,status,duration_ms,metadata,created_at';

export const USAGE = [
  'ใช้: node scripts/research-agent-report.mjs [--days N] [--json] [--env <path>]',
  `  --days N       จำนวนวันปฏิทินเวลาไทยล่าสุด รวมวันนี้ (1–${MAX_DAYS} · ค่าเริ่มต้น ${DEFAULT_DAYS})`,
  '  --json         พิมพ์ผลเป็น JSON',
  '  --env <path>   ไฟล์ env ที่จะโหลด (ค่าเริ่มต้น <ราก repo>/.env.local · ค่าใน shell ชนะไฟล์)',
  '  --help         แสดงวิธีใช้',
  '',
].join('\n');

export class UsageError extends Error {}

export class RestError extends Error {
  constructor(table, status, body) {
    super(`HTTP ${status}`);
    this.name = 'RestError';
    this.table = table;
    this.status = status;
    this.body = typeof body === 'string' ? body : '';
  }
}

// ── อาร์กิวเมนต์ ───────────────────────────────────────────────
export function parseArgs(argv = []) {
  const out = { days: DEFAULT_DAYS, json: false, envFile: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const takeValue = () => {
      if (inline !== null) return inline;
      i += 1;
      if (i >= argv.length) throw new UsageError(`${flag} ต้องมีค่าตามหลัง`);
      return String(argv[i]);
    };
    if (flag === '--json') out.json = true;
    else if (flag === '--help' || flag === '-h') out.help = true;
    else if (flag === '--days') {
      const raw = takeValue().trim();
      const days = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new UsageError(`--days ต้องเป็นจำนวนเต็ม 1–${MAX_DAYS} (ได้ "${raw}")`);
      out.days = days;
    } else if (flag === '--env') {
      const file = takeValue().trim();
      if (!file) throw new UsageError('--env ต้องมี path');
      out.envFile = file;
    } else throw new UsageError(`ไม่รู้จักอาร์กิวเมนต์ "${arg}"`);
  }
  return out;
}

// ── env ────────────────────────────────────────────────────────
/** คืน {baseUrl, key, urlName, keyName} หรือ null ถ้าไม่ครบ · ชื่อ env ใช้แสดงผลได้ ค่าห้ามพิมพ์ */
export function resolveSupabaseConfig(env = {}) {
  const pick = (names) => {
    for (const name of names) {
      const value = typeof env[name] === 'string' ? env[name].trim() : '';
      if (value) return { name, value };
    }
    return null;
  };
  const url = pick(URL_ENV_NAMES);
  const key = pick(KEY_ENV_NAMES);
  if (!url || !key) return null;
  return { baseUrl: url.value.replace(/\/+$/, ''), key: key.value, urlName: url.name, keyName: key.name };
}

function envNumber(env, name, fallback) {
  const n = finite(env[name]);
  return n !== null && n >= 0 ? n : fallback;
}

export function defaultEnvFile(metaUrl = import.meta.url, cwd = process.cwd()) {
  try {
    if (String(metaUrl).startsWith('file:')) return resolvePath(dirname(fileURLToPath(metaUrl)), '..', '.env.local');
  } catch {
    // import จาก data: URL (เทสกลายพันธุ์) หรือ path แปลก → ใช้โฟลเดอร์ปัจจุบัน
  }
  return resolvePath(cwd, '.env.local');
}

function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

/** ลบค่าลับทุกตัว (คีย์ · URL · host) ออกจากข้อความก่อนพิมพ์ — ยาวก่อนสั้น กันเหลือท่อน */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '');
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 4).sort((a, b) => b.length - a.length);
  for (const secret of list) {
    out = out.split(secret).join('***');
  }
  return out;
}

// ── เวลาไทย ───────────────────────────────────────────────────
export function bangkokDay(ms) {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function bangkokDayStartMs(ms) {
  const shifted = ms + BANGKOK_OFFSET_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - BANGKOK_OFFSET_MS;
}

export function bangkokMonthStartMs(ms) {
  const d = new Date(ms + BANGKOK_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - BANGKOK_OFFSET_MS;
}

/** ช่วงรายงาน = N วันปฏิทินเวลาไทยล่าสุด (รวมวันนี้) · การ์ดดึงย้อนถึงต้นเดือนด้วย (ค่าเครื่องมือเดือนนี้ + ค่าโควตาก่อนหน้า) */
export function windowFor(nowMs, days) {
  const fromMs = bangkokDayStartMs(nowMs) - (days - 1) * DAY_MS;
  const monthStartMs = bangkokMonthStartMs(nowMs);
  return { fromMs, toMs: nowMs, monthStartMs, cardsFetchFromMs: Math.min(fromMs, monthStartMs) };
}

// ── สถิติ ────────────────────────────────────────────────────
/** percentile แบบ nearest-rank (ค่าจริงในชุด ไม่เฉลี่ย) · ชุดว่าง = null */
export function percentile(values, p) {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p * sorted.length) / 100 - 1e-9);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function stats(values) {
  return { n: values.length, p50: percentile(values, 50), p90: percentile(values, 90) };
}

function round(n, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function pct(part, whole) {
  return whole > 0 ? round((part / whole) * 100, 1) : null;
}

function inc(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

function finite(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function asObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// ── แปลงแถว ──────────────────────────────────────────────────
/** แถว research-cards → การ์ดที่ใช้สรุป · รับทั้งแบบดึงเฉพาะช่อง (CARD_SELECT) และแบบ data เต็มก้อน · ไม่มีเวลา = null */
export function normalizeCardRow(row) {
  if (!row || typeof row !== 'object') return null;
  const src = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...row, ...row.data } : row;
  const createdMs = toMs(src.createdAt) ?? toMs(row.created_at);
  if (createdMs === null) return null;
  const brain = asObject(src.brain);
  return {
    id: String(src.id ?? row.id ?? ''),
    createdMs,
    status: typeof src.status === 'string' && src.status ? src.status : 'unknown',
    mode: typeof src.mode === 'string' && src.mode ? src.mode : 'unknown',
    brain: { ...brain, account: typeof brain.account === 'string' && brain.account ? brain.account : 'unknown' },
    originPost: asObject(src.origin_post),
    cards: asArray(src.cards),
    flags: [...new Set(asArray(src.flags).filter((f) => typeof f === 'string' && f))],
    rawCorrections: asArray(src.raw_corrections),
    usage: asObject(src.usage),
    feedback: asArray(src.feedback),
  };
}

/**
 * แถว pipeline_logs → {createdMs, status, waitMs, jobId} · metadata อาจเป็นสตริง JSON (pipelineLogger ใช้ JSON.stringify)
 * waitMs = เวลาที่ท่อรอเพิ่มจริง: waitedMs ก่อน (0 = ไม่ได้รอ ใช้ได้) → ms (แถวไม่มี waitedMs) → duration_ms (ไม่มี metadata)
 */
export function normalizeLogRow(row) {
  if (!row || typeof row !== 'object') return null;
  const createdMs = toMs(row.created_at);
  if (createdMs === null) return null;
  const meta = asObject(row.metadata);
  const status = typeof meta.status === 'string' && meta.status ? meta.status
    : (typeof row.status === 'string' && row.status ? row.status : 'unknown');
  const workflowId = typeof row.workflow_id === 'string' ? row.workflow_id : '';
  const jobId = typeof meta.jobId === 'string' && meta.jobId ? meta.jobId
    : (workflowId.startsWith('unify_') ? workflowId.slice('unify_'.length) : '');
  return { createdMs, status, waitMs: finite(meta.waitedMs) ?? finite(meta.ms) ?? finite(row.duration_ms), jobId };
}

/** พบต้นทางจริงไหม (ข้อ 15: ไม่พบ = ทำข่าวปกติ + ธง) */
export function isOriginFound(card) {
  if (card.flags.includes('ORIGIN_NOT_FOUND')) return false;
  const url = typeof card.originPost.url === 'string' ? card.originPost.url.trim() : '';
  if (!/^https?:\/\/\S+$/i.test(url)) return false;
  return !OWN_PAGE_RE.test(url);
}

/** นับ 👍/👎 หลังตัดซ้ำ: คนเดิม + การ์ดเดิม เอาโหวตที่ at ล่าสุด (at เท่ากัน/ไม่มี = ตัวท้ายในอาร์เรย์) */
export function tallyFeedback(feedback = []) {
  const latest = new Map();
  feedback.forEach((f, index) => {
    if (!f || (f.vote !== 'up' && f.vote !== 'down')) return;
    const key = `${f.userId ?? '?'}|${f.cardId ?? 'all'}`;
    const at = toMs(f.at) ?? -Infinity;
    const prev = latest.get(key);
    if (!prev || at > prev.at || (at === prev.at && index > prev.index)) latest.set(key, { vote: f.vote, at, index, userId: f.userId });
  });
  let up = 0;
  let down = 0;
  const voters = new Set();
  for (const v of latest.values()) {
    if (v.vote === 'up') up += 1;
    else down += 1;
    if (v.userId !== undefined && v.userId !== null) voters.add(String(v.userId));
  }
  return { up, down, voters: [...voters] };
}

function emptyDay(day) {
  return {
    day, jobs: 0, done: 0, failed: 0, skipped: 0, originFound: 0, cards: 0,
    up: 0, down: 0, costUsd: 0, quotaUsedPct: 0, pipelineRows: 0, readyAtGenerate: 0,
  };
}

// ── สรุป ─────────────────────────────────────────────────────
export function summarize({
  cardRows = [], logRows = [], days = DEFAULT_DAYS, nowMs,
  budgetUsdMonth = DEFAULT_TOOL_BUDGET_USD_MONTH, quotaAlertPct = DEFAULT_QUOTA_ALERT_PCT,
  errors = [], truncated = {}, keyName = null,
} = {}) {
  const win = windowFor(nowMs, days);
  const daily = new Map();
  for (let t = win.fromMs; t <= nowMs; t += DAY_MS) daily.set(bangkokDay(t), emptyDay(bangkokDay(t)));
  const dayOf = (ms) => {
    const key = bangkokDay(ms);
    if (!daily.has(key)) daily.set(key, emptyDay(key));
    return daily.get(key);
  };

  const all = [];
  let skippedCards = 0;
  for (const row of cardRows) {
    const card = normalizeCardRow(row);
    if (card) all.push(card);
    else skippedCards += 1;
  }
  all.sort((a, b) => a.createdMs - b.createdMs);
  const inWindow = all.filter((c) => c.createdMs >= win.fromMs);
  const done = inWindow.filter((c) => c.status === 'done');

  // งาน/วัน
  const byStatus = { done: 0, failed: 0, skipped: 0, other: 0 };
  for (const c of inWindow) {
    const d = dayOf(c.createdMs);
    d.jobs += 1;
    if (CARD_STATUSES.includes(c.status)) {
      byStatus[c.status] += 1;
      d[c.status] += 1;
    } else byStatus.other += 1;
  }

  // ต้นทาง + การ์ด (นับจากงาน done)
  let originFound = 0;
  let cardsTotal = 0;
  const byGate = { pass: 0, staff_only: 0, dropped: 0, other: 0 };
  for (const c of done) {
    const d = dayOf(c.createdMs);
    if (isOriginFound(c)) {
      originFound += 1;
      d.originFound += 1;
    }
    cardsTotal += c.cards.length;
    d.cards += c.cards.length;
    for (const item of c.cards) {
      const gate = item && typeof item === 'object' ? item.gate : undefined;
      if (GATES.includes(gate)) byGate[gate] += 1;
      else byGate.other += 1;
    }
  }

  // 👍/👎
  let up = 0;
  let down = 0;
  let jobsRated = 0;
  const voters = new Set();
  for (const c of inWindow) {
    const t = tallyFeedback(c.feedback);
    if (t.up + t.down > 0) jobsRated += 1;
    up += t.up;
    down += t.down;
    t.voters.forEach((v) => voters.add(v));
    const d = dayOf(c.createdMs);
    d.up += t.up;
    d.down += t.down;
  }

  // เวลา + จำนวนเรียกเครื่องมือ
  const agentMs = inWindow.map((c) => finite(c.usage.minutes)).filter((m) => m !== null && m >= 0).map((m) => Math.round(m * 60_000));
  const toolCalls = inWindow.map((c) => finite(c.usage.tool_calls)).filter((n) => n !== null && n >= 0);

  // ค่าเครื่องมือ (ช่วงนี้ + เดือนนี้)
  let windowUsd = 0;
  let monthToDate = 0;
  let jobsWithCost = 0;
  for (const c of all) {
    const cost = finite(c.usage.costUsd);
    if (cost === null || cost < 0) continue;
    if (c.createdMs >= win.monthStartMs) monthToDate += cost;
    if (c.createdMs >= win.fromMs) {
      windowUsd += cost;
      jobsWithCost += 1;
      dayOf(c.createdMs).costUsd += cost;
    }
  }

  // โควตา Codex (% คงเหลือ) แยกบัญชี — ค่าก่อนช่วงใช้เป็นจุดตั้งต้นเท่านั้น
  const observations = new Map();
  for (const c of all) {
    const left = finite(c.brain.quotaPctAfter);
    if (left === null) continue;
    if (!observations.has(c.brain.account)) observations.set(c.brain.account, []);
    observations.get(c.brain.account).push({ ms: c.createdMs, pct: left });
  }
  const accounts = {};
  for (const [account, obs] of observations) {
    let prev = null;
    let used = 0;
    let minPct = null;
    let jobs = 0;
    for (const o of obs) {
      if (o.ms >= win.fromMs) {
        jobs += 1;
        minPct = minPct === null ? o.pct : Math.min(minPct, o.pct);
        if (prev !== null && prev > o.pct) {
          used += prev - o.pct;
          dayOf(o.ms).quotaUsedPct += prev - o.pct;
        }
      }
      prev = o.pct;
    }
    const latest = obs[obs.length - 1];
    accounts[account] = {
      jobs, latestPct: latest.pct, latestAt: iso(latest.ms), minPct,
      usedPctEstimate: round(used, 1), belowAlert: latest.pct <= quotaAlertPct,
    };
  }

  // ธง · สมอง · โหมด · การแก้ตามต้นทาง (ข้อ 13)
  const flags = {};
  const brain = { byKind: {}, byEffort: {}, byAccount: {}, byMode: {}, mediumEffort: 0 };
  let rcJobs = 0;
  let rcTotal = 0;
  for (const c of inWindow) {
    for (const f of c.flags) inc(flags, f);
    inc(brain.byKind, typeof c.brain.kind === 'string' && c.brain.kind ? c.brain.kind : 'unknown');
    inc(brain.byEffort, typeof c.brain.effort === 'string' && c.brain.effort ? c.brain.effort : 'unknown');
    inc(brain.byAccount, c.brain.account);
    inc(brain.byMode, c.mode);
    if (c.brain.effort === 'medium') brain.mediumEffort += 1;
    if (c.rawCorrections.length > 0) {
      rcJobs += 1;
      rcTotal += c.rawCorrections.length;
    }
  }

  // ฝั่งท่อข่าว (pipeline_logs)
  const jobIds = new Set(all.map((c) => c.id));
  const pipelineByStatus = {};
  const waitMs = [];
  let logRowsInWindow = 0;
  let ready = 0;
  let withCards = 0;
  let skippedLogs = 0;
  for (const row of logRows) {
    const l = normalizeLogRow(row);
    if (!l) {
      skippedLogs += 1;
      continue;
    }
    if (l.createdMs < win.fromMs) continue;
    logRowsInWindow += 1;
    inc(pipelineByStatus, l.status);
    const d = dayOf(l.createdMs);
    d.pipelineRows += 1;
    if (l.status === 'done') {
      ready += 1;
      d.readyAtGenerate += 1;
    }
    if (l.jobId && jobIds.has(l.jobId)) withCards += 1;
    if (l.waitMs !== null && l.waitMs >= 0) waitMs.push(l.waitMs);
  }

  const total = inWindow.length;
  return {
    generatedAt: iso(nowMs),
    window: {
      days, from: bangkokDay(win.fromMs), to: bangkokDay(nowMs), timezone: 'Asia/Bangkok',
      fromIso: iso(win.fromMs), toIso: iso(nowMs), monthStartIso: iso(win.monthStartMs),
    },
    source: { cardsStore: CARDS_STORE, pipelineStep: PIPELINE_STEP, keyName, truncated: { cards: !!truncated.cards, logs: !!truncated.logs } },
    jobs: { total, byStatus, perDayAvg: round(total / days, 1) },
    origin: { found: originFound, of: done.length, pct: pct(originFound, done.length) },
    cards: { total: cardsTotal, perJob: done.length ? round(cardsTotal / done.length, 1) : null, byGate },
    feedback: { up, down, approvalPct: pct(up, up + down), jobsRated, voters: voters.size },
    timing: { agentMs: stats(agentMs), pipelineWaitMs: stats(waitMs) },
    toolCalls: {
      n: toolCalls.length,
      avg: toolCalls.length ? round(toolCalls.reduce((a, b) => a + b, 0) / toolCalls.length, 1) : null,
      p90: percentile(toolCalls, 90),
    },
    cost: {
      windowUsd: round(windowUsd, 6), monthToDateUsd: round(monthToDate, 6), budgetUsdMonth,
      budgetPct: budgetUsdMonth > 0 ? pct(monthToDate, budgetUsdMonth) : null,
      budgetReached: budgetUsdMonth > 0 && monthToDate >= budgetUsdMonth, jobsWithCost,
    },
    quota: {
      alertPct: quotaAlertPct, accounts, lowFlags: flags.QUOTA_LOW || 0,
      belowAlert: Object.keys(accounts).filter((a) => accounts[a].belowAlert),
    },
    flags,
    brain,
    rawCorrections: { jobs: rcJobs, total: rcTotal },
    pipeline: {
      rows: logRowsInWindow, byStatus: pipelineByStatus, readyAtGenerate: ready, readyPct: pct(ready, logRowsInWindow),
      withCards, coveragePct: pct(withCards, logRowsInWindow),
    },
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({
      ...d,
      cardsPerJob: d.done ? round(d.cards / d.done, 1) : null,
      costUsd: round(d.costUsd, 6),
      quotaUsedPct: round(d.quotaUsedPct, 1),
    })),
    skippedRows: { cards: skippedCards, logs: skippedLogs },
    errors: [...errors],
  };
}

// ── พิมพ์ ─────────────────────────────────────────────────────
function fmtNum(n) {
  return n === null || n === undefined ? '–' : String(n);
}

function fmtPct(n) {
  return n === null || n === undefined ? '–' : `${n.toFixed(1)}%`;
}

function fmtUsd(n) {
  if (n === null || n === undefined) return '–';
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}

function fmtDur(ms) {
  if (ms === null || ms === undefined) return '–';
  return ms < 60_000 ? `${Math.round(ms / 1000)} วิ` : `${(ms / 60_000).toFixed(1)} นาที`;
}

function fmtCounts(obj) {
  const entries = Object.entries(obj || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(' · ') : '–';
}

export function formatReport(s) {
  const lines = [];
  lines.push(`🔎 รายงานเอเจนต์รีเสิร์ช — ${s.window.days} วัน (${s.window.from} → ${s.window.to} เวลาไทย)`);
  for (const e of s.errors) lines.push(`⚠️ ${e}`);
  if (s.source.keyName === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
    lines.push('ℹ️ ใช้คีย์ anon (NEXT_PUBLIC_SUPABASE_ANON_KEY) — ถ้า RLS ปิดกั้นตาราง ผลจะว่าง · ใช้ SUPABASE_SERVICE_KEY แทน');
  }
  if (s.source.truncated.cards || s.source.truncated.logs) {
    lines.push(`⚠️ ข้อมูลเกินเพดาน ${MAX_PAGES * PAGE_SIZE} แถวต่อแหล่ง — ตัวเลขนับไม่ครบ ให้ลด --days`);
  }
  if (s.jobs.total === 0 && s.pipeline.rows === 0 && s.errors.length === 0) {
    lines.push('ยังไม่มีข้อมูลในช่วงนี้ — ตั้ง RESEARCH_AGENT=1 บน Vercel และรัน worker แล้วหรือยัง (ดู docs/RESEARCH-AGENT.md)');
  }
  const b = s.jobs.byStatus;
  lines.push(`งาน: ${s.jobs.total} (done ${b.done} · failed ${b.failed} · skipped ${b.skipped}${b.other ? ` · อื่นๆ ${b.other}` : ''}) · เฉลี่ย ${fmtNum(s.jobs.perDayAvg)} งาน/วัน · โหมด ${fmtCounts(s.brain.byMode)}`);
  lines.push(`พบต้นทาง: ${s.origin.found}/${s.origin.of} งาน = ${fmtPct(s.origin.pct)}`);
  const g = s.cards.byGate;
  lines.push(`การ์ด: ${s.cards.total} ใบ = ${fmtNum(s.cards.perJob)} ใบ/งาน (pass ${g.pass} · staff_only ${g.staff_only} · dropped ${g.dropped}${g.other ? ` · อื่นๆ ${g.other}` : ''}) · งานที่แก้ตามต้นทาง ${s.rawCorrections.jobs}`);
  lines.push(`คะแนน: 👍 ${s.feedback.up} · 👎 ${s.feedback.down} = ชอบ ${fmtPct(s.feedback.approvalPct)} · งานที่มีคนให้คะแนน ${s.feedback.jobsRated}/${s.jobs.total} · ผู้ให้คะแนน ${s.feedback.voters} คน`);
  const a = s.timing.agentMs;
  lines.push(`เวลาเอเจนต์: p50 ${fmtDur(a.p50)} · p90 ${fmtDur(a.p90)} (n=${a.n}) · เรียกเครื่องมือ/งาน เฉลี่ย ${fmtNum(s.toolCalls.avg)} (p90 ${fmtNum(s.toolCalls.p90)})`);
  const p = s.pipeline;
  const w = s.timing.pipelineWaitMs;
  lines.push(`ท่อข่าว: ${p.rows} ข่าว · การ์ดพร้อมตอน PRE-GENERATE ${p.readyAtGenerate} (${fmtPct(p.readyPct)}) · มีการ์ดในฐาน ${p.withCards} (${fmtPct(p.coveragePct)}) · ท่อรอการ์ด p50 ${fmtDur(w.p50)} · p90 ${fmtDur(w.p90)}`);
  lines.push(`  สถานะที่ท่อเห็น: ${fmtCounts(p.byStatus)}`);
  const c = s.cost;
  lines.push(`ค่าเครื่องมือ: ช่วงนี้ ${fmtUsd(c.windowUsd)} · เดือนนี้ ${fmtUsd(c.monthToDateUsd)} / เพดาน ${fmtUsd(c.budgetUsdMonth)} (${fmtPct(c.budgetPct)})`);
  if (c.budgetReached) lines.push('⚠️ ค่าเครื่องมือเดือนนี้ถึงเพดานแล้ว — ดูวิธีจำกัดเครื่องมือ/งบใน docs/RESEARCH-AGENT.md');
  const accountsText = Object.entries(s.quota.accounts)
    .map(([name, q]) => `${name} ล่าสุด ${q.latestPct}% (ต่ำสุดในช่วง ${q.minPct === null ? '–' : `${q.minPct}%`}) ใช้ไป≈${q.usedPctEstimate}%`)
    .join(' · ');
  lines.push(`โควตา Codex (% คงเหลือ · เตือนที่ ≤${s.quota.alertPct}%): ${accountsText || '–'} · ธง QUOTA_LOW ${s.quota.lowFlags}`);
  for (const name of s.quota.belowAlert) {
    lines.push(`⚠️ บัญชี ${name} เหลือ ${s.quota.accounts[name].latestPct}% — สลับ/เพิ่มบัญชีตาม docs/RESEARCH-AGENT.md`);
  }
  lines.push(`สมอง: ${fmtCounts(s.brain.byKind)} · ยก medium ${s.brain.mediumEffort} · บัญชี ${fmtCounts(s.brain.byAccount)}`);
  lines.push(`ธง: ${fmtCounts(s.flags)}`);
  lines.push('รายวัน (เวลาไทย):');
  for (const d of s.daily) {
    lines.push(`  ${d.day}  งาน ${d.jobs} (done ${d.done}) · ต้นทาง ${d.originFound} · การ์ด/งาน ${fmtNum(d.cardsPerJob)} · 👍${d.up} 👎${d.down} · ท่อ ${d.pipelineRows} (ทัน ${d.readyAtGenerate}) · ${fmtUsd(d.costUsd)} · โควตาใช้ ${d.quotaUsedPct}%`);
  }
  return `${lines.join('\n')}\n`;
}

// ── อ่าน Supabase REST (GET เท่านั้น) ─────────────────────────
export function buildRestUrl(baseUrl, table, params) {
  return `${baseUrl}/rest/v1/${table}?${new URLSearchParams(params).toString()}`;
}

/** ดึงทุกหน้า (order created_at,id · limit/offset) จนได้หน้าไม่เต็ม · เกิน maxPages = truncated */
export async function fetchAllRows({
  baseUrl, key, table, select, filters = {}, fetchImpl,
  timeoutMs = REQUEST_TIMEOUT_MS, pageSize = PAGE_SIZE, maxPages = MAX_PAGES,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('ไม่มี fetch (ต้องใช้ Node 18+)');
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const params = { select, ...filters, order: 'created_at.asc,id.asc', limit: String(pageSize), offset: String(page * pageSize) };
    const init = { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } };
    if (timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs);
    // eslint-disable-next-line no-await-in-loop -- แบ่งหน้าตามลำดับ: หน้าถัดไปขึ้นกับจำนวนแถวของหน้านี้
    const res = await fetchImpl(buildRestUrl(baseUrl, table, params), init);
    if (!res.ok) {
      let body = '';
      try {
        // eslint-disable-next-line no-await-in-loop -- อ่านเนื้อ error ของหน้านี้ก่อนโยน
        body = await res.text();
      } catch {
        body = '';
      }
      throw new RestError(table, res.status, body);
    }
    // eslint-disable-next-line no-await-in-loop -- หน้าเดียวกับ fetch ข้างบน
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new RestError(table, res.status, 'คำตอบไม่ใช่ array');
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function describeError(error) {
  if (error instanceof RestError) {
    const body = error.body.replace(/\s+/g, ' ').trim().slice(0, 300);
    return `HTTP ${error.status}${body ? ` — ${body}` : ''}`;
  }
  const cause = error?.cause?.code ? ` (${error.cause.code})` : '';
  return `${error?.name || 'Error'}: ${error?.message || String(error)}${cause}`;
}

// ── main ──────────────────────────────────────────────────────
/**
 * @param {string[]} argv
 * @param {{ env?: object, fetchImpl?: Function, now?: () => number, stdout?: (s: string) => void,
 *           stderr?: (s: string) => void, loadEnvFile?: (path: string) => void, fileExists?: (path: string) => boolean,
 *           timeoutMs?: number }} [deps]  ฉีดได้ทุกตัว (เทสใช้ fetch ปลอม — ไม่ยิงฐานข้อมูลจริง)
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`[research-agent-report] ${error.message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }

  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? existsSync;
  const loadEnvFile = deps.loadEnvFile ?? ((path) => process.loadEnvFile(path));
  const envFile = args.envFile ?? defaultEnvFile();
  if (fileExists(envFile)) {
    try {
      loadEnvFile(envFile);
    } catch (error) {
      err(`[research-agent-report] โหลดไฟล์ env ไม่สำเร็จ (${error?.code || error?.name || 'error'}) — ใช้ env ที่มีอยู่\n`);
    }
  } else if (args.envFile) {
    err(`[research-agent-report] ไม่พบไฟล์ env ที่ระบุ: ${args.envFile}\n`);
    return 2;
  }

  if (env.SUPABASE_DISABLED === '1') {
    err('[research-agent-report] SUPABASE_DISABLED=1 — ไม่อ่านฐานข้อมูล\n');
    return 2;
  }
  const cfg = resolveSupabaseConfig(env);
  if (!cfg) {
    err(`[research-agent-report] ไม่พบ env ของ Supabase — ต้องมี ${URL_ENV_NAMES.join(' หรือ ')} และ ${KEY_ENV_NAMES.join(' หรือ ')} (ใน shell หรือ ${envFile})\n`);
    return 2;
  }
  if (!/^https?:\/\//i.test(cfg.baseUrl)) {
    err(`[research-agent-report] ค่า ${cfg.urlName} ต้องขึ้นต้นด้วย http(s):// (ไม่พิมพ์ค่าเพื่อความปลอดภัย)\n`);
    return 2;
  }
  const secrets = [cfg.key, cfg.baseUrl, hostOf(cfg.baseUrl)];

  try {
    const nowMs = (deps.now ?? Date.now)();
    const win = windowFor(nowMs, args.days);
    const common = {
      baseUrl: cfg.baseUrl, key: cfg.key, fetchImpl: deps.fetchImpl ?? globalThis.fetch,
      timeoutMs: deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
    };
    const [cardsRes, logsRes] = await Promise.all([
      fetchAllRows({
        ...common, table: 'store_items', select: CARD_SELECT,
        filters: { store_name: `eq.${CARDS_STORE}`, created_at: `gte.${iso(win.cardsFetchFromMs)}` },
      }).catch((error) => ({ error })),
      fetchAllRows({
        ...common, table: 'pipeline_logs', select: LOG_SELECT,
        filters: { step: `eq.${PIPELINE_STEP}`, created_at: `gte.${iso(win.fromMs)}` },
      }).catch((error) => ({ error })),
    ]);
    const errors = [];
    if (cardsRes.error) errors.push(redactSecrets(`อ่าน store_items (${CARDS_STORE}) ไม่สำเร็จ: ${describeError(cardsRes.error)}`, secrets));
    if (logsRes.error) errors.push(redactSecrets(`อ่าน pipeline_logs (${PIPELINE_STEP}) ไม่สำเร็จ: ${describeError(logsRes.error)}`, secrets));

    const summary = summarize({
      cardRows: cardsRes.rows || [], logRows: logsRes.rows || [], days: args.days, nowMs,
      budgetUsdMonth: envNumber(env, 'RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH', DEFAULT_TOOL_BUDGET_USD_MONTH),
      quotaAlertPct: envNumber(env, 'RESEARCH_AGENT_QUOTA_ALERT_PCT', DEFAULT_QUOTA_ALERT_PCT),
      errors, truncated: { cards: cardsRes.truncated, logs: logsRes.truncated }, keyName: cfg.keyName,
    });
    out(args.json ? `${JSON.stringify(summary, null, 2)}\n` : formatReport(summary));
    for (const e of errors) err(`[research-agent-report] ${e}\n`);
    return errors.length ? 1 : 0;
  } catch (error) {
    err(`[research-agent-report] ผิดพลาดไม่คาดคิด: ${redactSecrets(describeError(error), secrets)}\n`);
    return 1;
  }
}

export function isMainModule(metaUrl, argv1) {
  if (!argv1 || !String(metaUrl).startsWith('file:')) return false;
  try {
    const self = resolvePath(fileURLToPath(metaUrl));
    const entry = resolvePath(argv1);
    return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`[research-agent-report] ผิดพลาดไม่คาดคิด: ${error?.message || error}\n`);
      process.exitCode = 1;
    },
  );
}
