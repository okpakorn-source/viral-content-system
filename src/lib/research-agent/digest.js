// ============================================================
// 📊 src/lib/research-agent/digest.js — สรุปรีเสิร์ชรายช่วง (ตัวเลขล้วน) ให้บอท DM เจ้าของทุกเช้า
// ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7) — เจ้าของตอบ 2 ต.ค. 69: สรุปรายวัน 07:30 ส่งเป็น DM
//   (ข่าวกี่ชิ้น · เข้าเนื้อกี่ชิ้น · แก้/เพิ่มรวมกี่จุด · ธงที่พบ · ค่าเครื่องมือ + ประมาณ AI · 👍👎 ที่พนักงานกด · ข่าวที่ควรดู)
// ------------------------------------------------------------
// ไฟล์นี้ไม่ import อะไรเลย (pure + ตัวอ่านที่รับ Supabase client มาจากผู้เรียก) → เทสโหลดตรงได้ ไม่ต้องมี hook
//   · summarizeNews(rows)      แถว generation_logs {case_id, news_title, created_at, pipeline_info} → ตัวเลขข่าว/บรรณาธิการ
//     (pipeline_info.researchAgent = ฉบับย่อของ generationLogger.compactResearchAgentPipelineInfo · editor = compactEditorSummary)
//   · summarizeCards(rows, range)  แถว store_items research-cards {id, data, created_at, updated_at} → สถานะ/ธง/usage (การ์ดที่สร้างในช่วง)
//     + 👍👎 (feedback ที่ "กด" ในช่วง — feedback.at · kind 'editor' = ใบที่สอง · ไม่มี kind = ใบแรก)
//   · summarizeUsage(rows)     แถว api_usage_logs {cost_usd, feature} → ค่า AI ประมาณ (รวมทุกงานในช่วง — LLM ที่ logApiUsage บันทึก)
//   · buildWatchlist / buildDigest → JSON ที่ route ตอบ (ส่วนที่อ่านไม่ได้ = null + errors · ไม่ 500 ทั้งก้อน)
//   · collectResearchDigest({sb, range}) อ่าน 3 แหล่งขนานกัน · bounded 8 วิ (ไม่ทัน = ช่องนั้น null 'timeout' + abortSignal)
// ไม่คืนเนื้อข่าว: มีแค่ชื่อข่าว ≤ 60 ตัวอักษรในรายการ "ข่าวที่ควรดู" (≤ 3) · ไม่มีค่าลับ · ข้อความ error ดิบจาก DB ไม่ส่งออก (มีแค่รหัสเหตุ)
// ผู้ใช้: src/app/api/research/digest/route.js (GET · checkBotKey) ← บอท discord-bot/researchCard.js createResearchWatchdog
// ============================================================

export const DIGEST_DAY_MS = 24 * 60 * 60 * 1000;
/** ช่วงยาวสุดที่ขอได้ (8 วัน — สรุปรายวัน 1 วัน + เผื่อเรียกดูย้อนหลังรายสัปดาห์) */
export const DIGEST_MAX_RANGE_MS = 8 * DIGEST_DAY_MS;
/** until ล้ำอนาคตได้ไม่เกินนี้ (นาฬิกา Railway กับ Vercel ต่างกันเล็กน้อย) */
export const DIGEST_FUTURE_SKEW_MS = 10 * 60 * 1000;
/** เพดานเวลารวมของการอ่านทั้ง 3 แหล่ง (สเปกส่วน 12 ข้อ 4 "bounded 8 วิ") */
export const DIGEST_TIMEOUT_MS = 8_000;
export const DIGEST_GEN_LIMIT = 600;
export const DIGEST_CARDS_LIMIT = 600;
export const DIGEST_USAGE_PAGE = 1000;
export const DIGEST_USAGE_MAX_PAGES = 20;
export const DIGEST_WATCH_MAX = 3;
export const DIGEST_DOWN_JOBS_MAX = 10;
export const DIGEST_TITLE_MAX = 60;
export const DIGEST_FLAG_KEYS_MAX = 12;
export const DIGEST_FEATURES_MAX = 5;
/** = RESEARCH_CARDS_STORE ของ src/lib/research-agent/store.js (เทสยืนยันว่าตรงกัน — ไฟล์นี้ไม่ import store เพื่อคงความ pure) */
export const DIGEST_CARDS_STORE = 'research-cards';

/**
 * ตัวตั้งเวลาของเพดาน 8 วิ — ช่องฉีดของเทส (route ไม่ส่ง timers เอง จึงใช้ตัวนี้)
 * เทสแทนที่ setTimeout/clearTimeout ชั่วคราวเพื่อไม่ใช้ timer จริง · production = timer ของ Node (ref · ล้างทุกทางใน finally)
 */
export const digestTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

const AGENT_STATUSES = Object.freeze(['done', 'failed', 'skipped', 'pending', 'not_ready', 'expired', 'offline', 'error', 'no_request', 'no_job', 'unavailable']);
const EDITOR_STATUSES = Object.freeze(['done', 'not_ready', 'skipped', 'failed']);
const CARD_STATUSES = Object.freeze(['done', 'failed', 'skipped']);
const MODES = Object.freeze(['shadow', 'assist', 'write']);
const SECTION_LABELS = Object.freeze({ news: 'generation_logs', cards: 'research_cards', usage: 'api_usage_logs' });
const FLAG_RE = /^[A-Z][A-Z0-9_]{1,47}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** jsonb จาก Supabase = object อยู่แล้ว · เผื่อแถวเก่าที่เป็นข้อความ JSON */
function jsonObject(value) {
  if (isPlain(value)) return value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value);
    return isPlain(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** จำนวนนับ (≥ 0 · ปัดเป็นจำนวนเต็ม) · อื่นๆ = 0 */
function count(value) {
  const n = num(value);
  return n !== null && n > 0 ? Math.round(n) : 0;
}

function average(list, digits = 0) {
  if (list.length === 0) return null;
  const value = list.reduce((sum, n) => sum + n, 0) / list.length;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const round4 = (n) => Math.round(n * 10_000) / 10_000;

/** ข้อความบรรทัดเดียว ตัดความยาว (ชื่อข่าว/ชื่อ feature) */
function shortText(value, max) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function jobIdOf(value) {
  return typeof value === 'string' && JOB_ID_RE.test(value) ? value : null;
}

function caseIdOf(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,20}$/u.test(value.trim()) ? value.trim() : null;
}

/**
 * ช่วงเวลาของคำขอ → { ok, since, until, sinceMs, untilMs } | { ok:false, error }
 * until ไม่ส่ง = ตอนนี้ · since ไม่ส่ง = until − 24 ชม. · ต้อง since < until · ยาว ≤ 8 วัน · until ≤ ตอนนี้ + 10 นาที
 * @param {{since?: string|null, until?: string|null}} query
 * @param {number} nowMs
 */
export function parseDigestRange({ since = null, until = null } = {}, nowMs = Date.now()) {
  const parse = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return null;
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : Number.NaN;
  };
  const untilParsed = parse(until);
  const sinceParsed = parse(since);
  if (Number.isNaN(untilParsed)) return { ok: false, error: 'until ต้องเป็นวันที่ ISO เช่น 2026-10-02T00:30:00.000Z' };
  if (Number.isNaN(sinceParsed)) return { ok: false, error: 'since ต้องเป็นวันที่ ISO เช่น 2026-10-01T00:30:00.000Z' };
  if (!Number.isFinite(nowMs)) return { ok: false, error: 'นาฬิกาเซิร์ฟเวอร์อ่านไม่ได้' };
  const untilMs = untilParsed === null ? nowMs : untilParsed;
  const sinceMs = sinceParsed === null ? untilMs - DIGEST_DAY_MS : sinceParsed;
  if (!(sinceMs < untilMs)) return { ok: false, error: 'since ต้องมาก่อน until' };
  if (untilMs - sinceMs > DIGEST_MAX_RANGE_MS) return { ok: false, error: `ช่วงเวลายาวเกิน ${DIGEST_MAX_RANGE_MS / DIGEST_DAY_MS} วัน` };
  if (untilMs > nowMs + DIGEST_FUTURE_SKEW_MS) return { ok: false, error: 'until อยู่ในอนาคต' };
  const sinceDate = new Date(sinceMs);
  const untilDate = new Date(untilMs);
  if (!Number.isFinite(sinceDate.getTime()) || !Number.isFinite(untilDate.getTime())) return { ok: false, error: 'วันที่อยู่นอกช่วงที่รองรับ' };
  return { ok: true, sinceMs, untilMs, since: sinceDate.toISOString(), until: untilDate.toISOString() };
}

/**
 * แถว generation_logs ในช่วง → { summary, byJob }
 *   summary: total (ข่าวทั้งหมด) · withAgent (ผ่านระบบใหม่ = มี pipeline_info.researchAgent) · modes · agentStatus
 *     · editor (โหมด write: done = เข้าเนื้อ · not_ready · skipped · failed) · encodingBroken (ธง ENCODING_BROKEN ต่อข่าว)
 *     · corrections/additions (รวมจาก editor) · avgWaitMs (รอการ์ด: write = editor.waitedMs · assist = researchAgent.waitedMs)
 *     · avgEditorMs · avgTotalSec (pipeline_info.totalTime เป็นวินาที — ทุกข่าว) · capped (แถวชนเพดาน limit)
 *   byJob: Map jobId → {jobId, caseId, title, corrections, additions} (ใช้ทำรายการ "ข่าวที่ควรดู")
 */
export function summarizeNews(rows, { limit = DIGEST_GEN_LIMIT } = {}) {
  const list = Array.isArray(rows) ? rows.filter(isPlain) : [];
  const summary = {
    total: list.length,
    capped: list.length >= limit,
    withAgent: 0,
    modes: { shadow: 0, assist: 0, write: 0, other: 0 },
    agentStatus: {},
    editor: { done: 0, not_ready: 0, skipped: 0, failed: 0 },
    encodingBroken: 0,
    corrections: 0,
    additions: 0,
    avgWaitMs: null,
    avgEditorMs: null,
    avgTotalSec: null,
  };
  const byJob = new Map();
  const waits = [];
  const editorTimes = [];
  const totals = [];
  for (const row of list) {
    const info = jsonObject(row.pipeline_info);
    const total = num(info?.totalTime);
    if (total !== null && total > 0) totals.push(total);
    const ra = isPlain(info?.researchAgent) ? info.researchAgent : null;
    if (!ra) continue;
    summary.withAgent += 1;
    const mode = MODES.includes(ra.mode) ? ra.mode : 'other';
    summary.modes[mode] += 1;
    const status = AGENT_STATUSES.includes(ra.status) ? ra.status : 'other';
    summary.agentStatus[status] = (summary.agentStatus[status] || 0) + 1;
    if (Array.isArray(ra.flags) && ra.flags.includes('ENCODING_BROKEN')) summary.encodingBroken += 1;
    const editor = isPlain(ra.editor) ? ra.editor : null;
    let corrections = 0;
    let additions = 0;
    if (editor) {
      if (EDITOR_STATUSES.includes(editor.status)) summary.editor[editor.status] += 1;
      corrections = count(editor.corrections);
      additions = count(editor.additions);
      summary.corrections += corrections;
      summary.additions += additions;
      const waited = num(editor.waitedMs);
      if (waited !== null && waited >= 0) waits.push(waited);
      const editorMs = num(editor.editorMs);
      if (editorMs !== null && editorMs > 0) editorTimes.push(editorMs);
    } else if (mode === 'assist') {
      const waited = num(ra.waitedMs);
      if (waited !== null && waited >= 0) waits.push(waited);
    }
    const jobId = jobIdOf(info.jobId);
    if (jobId && !byJob.has(jobId)) {
      byJob.set(jobId, { jobId, caseId: caseIdOf(row.case_id), title: shortText(row.news_title, DIGEST_TITLE_MAX) || null, corrections, additions });
    }
  }
  summary.agentStatus = Object.fromEntries(Object.entries(summary.agentStatus).sort(([a], [b]) => a.localeCompare(b)));
  summary.avgWaitMs = average(waits);
  summary.avgEditorMs = average(editorTimes);
  summary.avgTotalSec = average(totals, 1);
  return { summary, byJob };
}

/**
 * แถว store_items research-cards → สรุปการ์ด + 👍👎
 *   การ์ดที่ "สร้าง" ในช่วง (created_at ของแถว · ไม่มี = data.createdAt): สถานะ · ธง (นับต่องาน · ≤ 12 ธงที่พบบ่อยสุด)
 *     · ค่าเครื่องมือ usage.costUsd · นาที · tool_calls
 *   👍👎 = feedback ที่ "กด" ในช่วง (feedback.at) ของการ์ดทุกใบที่อ่านมา (ผู้เรียกอ่านแถวที่ updated_at ≥ since จึงเห็นโหวตของการ์ดเก่าด้วย)
 *     first = ใบแรก (บัตรข้อเท็จจริง) · second = ใบที่สอง (kind 'editor') · downJobs = งานที่ได้ 👎 (เรียงมาก→น้อย ≤ 10)
 */
export function summarizeCards(rows, { sinceMs, untilMs, limit = DIGEST_CARDS_LIMIT } = {}) {
  const list = Array.isArray(rows) ? rows.filter(isPlain) : [];
  const inWindow = (ms) => Number.isFinite(ms) && ms >= sinceMs && ms < untilMs;
  const out = {
    total: 0,
    capped: list.length >= limit,
    status: { done: 0, failed: 0, skipped: 0, other: 0 },
    flags: {},
    toolCostUsd: 0,
    minutes: 0,
    avgMinutes: null,
    toolCalls: 0,
    votes: { first: { up: 0, down: 0 }, second: { up: 0, down: 0 }, downJobs: [] },
  };
  const flagCounts = new Map();
  const downByJob = new Map();
  const minutesList = [];
  for (const row of list) {
    const doc = jsonObject(row.data);
    if (!doc) continue;
    const jobId = jobIdOf(doc.id);
    const createdMs = Date.parse(String(row.created_at ?? doc.createdAt ?? ''));
    if (inWindow(createdMs)) {
      out.total += 1;
      out.status[CARD_STATUSES.includes(doc.status) ? doc.status : 'other'] += 1;
      const flags = new Set((Array.isArray(doc.flags) ? doc.flags : []).filter((f) => typeof f === 'string' && FLAG_RE.test(f)));
      for (const flag of flags) flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
      const usage = isPlain(doc.usage) ? doc.usage : {};
      const cost = num(usage.costUsd);
      if (cost !== null && cost >= 0) out.toolCostUsd += cost;
      const minutes = num(usage.minutes);
      if (minutes !== null && minutes >= 0) {
        out.minutes += minutes;
        minutesList.push(minutes);
      }
      out.toolCalls += count(usage.tool_calls);
    }
    for (const vote of Array.isArray(doc.feedback) ? doc.feedback : []) {
      if (!isPlain(vote) || (vote.vote !== 'up' && vote.vote !== 'down')) continue;
      if (!inWindow(Date.parse(String(vote.at ?? '')))) continue;
      const bucket = vote.kind === 'editor' ? out.votes.second : out.votes.first;
      bucket[vote.vote] += 1;
      if (vote.vote === 'down' && jobId) downByJob.set(jobId, (downByJob.get(jobId) || 0) + 1);
    }
  }
  out.flags = Object.fromEntries([...flagCounts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, DIGEST_FLAG_KEYS_MAX));
  out.toolCostUsd = round4(out.toolCostUsd);
  out.minutes = Math.round(out.minutes * 10) / 10;
  out.avgMinutes = average(minutesList, 1);
  out.votes.downJobs = [...downByJob.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, DIGEST_DOWN_JOBS_MAX)
    .map(([jobId, down]) => ({ jobId, down }));
  return out;
}

/** แถว api_usage_logs → { usd, calls, capped, byFeature (≤ 5 ตัวที่แพงสุด) } — ประมาณค่า AI ของทุกงานในช่วง */
export function summarizeUsage(rows, { capped = false } = {}) {
  const list = Array.isArray(rows) ? rows.filter(isPlain) : [];
  let usd = 0;
  const byFeature = new Map();
  for (const row of list) {
    const cost = num(row.cost_usd);
    const value = cost !== null && cost > 0 ? cost : 0;
    usd += value;
    const feature = shortText(row.feature, 40) || '?';
    const entry = byFeature.get(feature) || { feature, usd: 0, calls: 0 };
    entry.usd += value;
    entry.calls += 1;
    byFeature.set(feature, entry);
  }
  return {
    usd: round4(usd),
    calls: list.length,
    capped: capped === true,
    byFeature: [...byFeature.values()]
      .sort((a, b) => b.usd - a.usd || b.calls - a.calls || a.feature.localeCompare(b.feature))
      .slice(0, DIGEST_FEATURES_MAX)
      .map((entry) => ({ ...entry, usd: round4(entry.usd) })),
  };
}

/**
 * "ข่าวที่ควรดู" ≤ 3: งานที่ได้ 👎 ก่อน (มาก→น้อย) แล้วงานที่บรรณาธิการแก้ข้อผิด (corrections มาก→น้อย)
 * @param {Map<string, object>|null} byJob   จาก summarizeNews (caseId/ชื่อข่าว/แก้/เพิ่ม ต่อ jobId)
 * @param {Array<{jobId: string, down: number}>} downJobs  จาก summarizeCards
 */
export function buildWatchlist(byJob, downJobs = [], max = DIGEST_WATCH_MAX) {
  const index = byJob instanceof Map ? byJob : new Map();
  const picked = new Map();
  for (const { jobId, down } of Array.isArray(downJobs) ? downJobs : []) {
    if (!jobIdOf(jobId) || !(down > 0)) continue;
    const news = index.get(jobId);
    picked.set(jobId, {
      jobId,
      caseId: news?.caseId ?? null,
      title: news?.title ?? null,
      corrections: news?.corrections ?? 0,
      additions: news?.additions ?? 0,
      down,
    });
  }
  for (const news of index.values()) {
    if (picked.has(news.jobId) || !(news.corrections > 0)) continue;
    picked.set(news.jobId, { ...news, down: 0 });
  }
  return [...picked.values()]
    .sort((a, b) => b.down - a.down || b.corrections - a.corrections || b.additions - a.additions || a.jobId.localeCompare(b.jobId))
    .slice(0, max);
}

/**
 * รวมเป็นคำตอบของ route (สัญญาที่บอทอ่าน — ดู contract ใน discord-bot/researchCard.js renderDigestMessage)
 * @param {{ range: {since: string, until: string}, news?: {summary: object, byJob: Map}|null, cards?: object|null,
 *   usage?: object|null, errors?: string[] }} parts
 */
export function buildDigest({ range, news = null, cards = null, usage = null, errors = [] }) {
  const list = Array.isArray(errors) ? errors.filter((e) => typeof e === 'string' && e) : [];
  return {
    since: range?.since ?? null,
    until: range?.until ?? null,
    news: news ? news.summary : null,
    cards: cards || null,
    aiCost: usage || null,
    watchlist: buildWatchlist(news ? news.byJob : null, cards ? cards.votes.downJobs : []),
    partial: list.length > 0,
    errors: list,
  };
}

// ─── ตัวอ่าน Supabase (ผู้เรียกส่ง client มา · ไม่มีข้อความดิบจาก DB ออกไปนอกฟังก์ชัน) ───
function readFailure(code) {
  const error = new Error(code);
  error.digestReason = code;
  return error;
}

function withSignal(query, signal) {
  return signal && query && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query;
}

async function readGenerationRows({ sb, range, signal }) {
  const query = sb.from('generation_logs')
    .select('case_id,news_title,created_at,pipeline_info')
    .gte('created_at', range.since)
    .lt('created_at', range.until)
    .order('created_at', { ascending: true })
    .limit(DIGEST_GEN_LIMIT);
  const result = await withSignal(query, signal);
  if (!result || result.error || !Array.isArray(result.data)) throw readFailure('query_error');
  return result.data;
}

/** การ์ดที่สร้างก่อน until และมีการเปลี่ยน (เช่น มีคนกด 👍👎) ตั้งแต่ since — ครอบทั้งการ์ดในช่วงและโหวตในช่วงของการ์ดเก่า */
async function readCardRows({ sb, range, signal }) {
  const query = sb.from('store_items')
    .select('id,data,created_at,updated_at')
    .eq('store_name', DIGEST_CARDS_STORE)
    .gte('updated_at', range.since)
    .lt('created_at', range.until)
    .order('created_at', { ascending: true })
    .limit(DIGEST_CARDS_LIMIT);
  const result = await withSignal(query, signal);
  if (!result || result.error || !Array.isArray(result.data)) throw readFailure('query_error');
  return result.data;
}

/** api_usage_logs ทีละ 1,000 แถว (แบบ /api/usage-cost) · ≤ 20 หน้า (เกิน = capped) · หมดเวลาแล้วไม่ขอหน้าถัดไป */
async function readUsageRows({ sb, range, signal, stopped }) {
  const rows = [];
  for (let page = 0; page < DIGEST_USAGE_MAX_PAGES; page += 1) {
    if (stopped()) throw readFailure('timeout');
    const from = page * DIGEST_USAGE_PAGE;
    const query = sb.from('api_usage_logs')
      .select('cost_usd,feature,created_at')
      .gte('created_at', range.since)
      .lt('created_at', range.until)
      .order('created_at', { ascending: true })
      .range(from, from + DIGEST_USAGE_PAGE - 1);
    // eslint-disable-next-line no-await-in-loop -- อ่านทีละหน้าตามลำดับ (หน้าถัดไปขึ้นกับว่าหน้านี้เต็มไหม)
    const result = await withSignal(query, signal);
    if (!result || result.error || !Array.isArray(result.data)) throw readFailure('query_error');
    rows.push(...result.data);
    if (result.data.length < DIGEST_USAGE_PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

/**
 * อ่าน 3 แหล่งพร้อมกันแล้วสรุป · ไม่โยน (ส่วนที่ล้ม/ไม่ทัน = null + errors 'แหล่ง: เหตุ')
 * @param {{ sb: object|null, range: {since: string, until: string, sinceMs: number, untilMs: number},
 *   timeoutMs?: number, timers?: {setTimeout: Function, clearTimeout: Function} }} input
 */
export async function collectResearchDigest({ sb, range, timeoutMs = DIGEST_TIMEOUT_MS, timers = digestTimers } = {}) {
  if (!sb || typeof sb.from !== 'function') {
    return buildDigest({ range, errors: Object.values(SECTION_LABELS).map((label) => `${label}: supabase_unavailable`) });
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let expired = false;
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = timers.setTimeout(() => {
      expired = true;
      resolve();
    }, timeoutMs);
  });
  const reasons = {};
  const guard = (key, task) => Promise.race([
    Promise.resolve()
      .then(task)
      .then((value) => ({ ok: true, value }), (error) => ({ ok: false, reason: error?.digestReason || 'exception' })),
    deadline.then(() => ({ ok: false, reason: 'timeout' })),
  ]).then((result) => {
    if (result.ok) return result.value;
    reasons[key] = result.reason;
    return null;
  });
  try {
    const ctx = { sb, range, signal: controller ? controller.signal : null, stopped: () => expired };
    const [genRows, cardRows, usageRead] = await Promise.all([
      guard('news', () => readGenerationRows(ctx)),
      guard('cards', () => readCardRows(ctx)),
      guard('usage', () => readUsageRows(ctx)),
    ]);
    const errors = Object.keys(SECTION_LABELS).filter((key) => reasons[key]).map((key) => `${SECTION_LABELS[key]}: ${reasons[key]}`);
    return buildDigest({
      range,
      news: genRows ? summarizeNews(genRows) : null,
      cards: cardRows ? summarizeCards(cardRows, range) : null,
      usage: usageRead ? summarizeUsage(usageRead.rows, { capped: usageRead.capped }) : null,
      errors,
    });
  } finally {
    try { timers.clearTimeout(timer); } catch { /* timer หายไปแล้ว */ }
    if (controller) {
      try { controller.abort(); } catch { /* ยกเลิกคำขอที่ค้าง (หลังหมดเวลา) — เสร็จแล้วไม่มีผล */ }
    }
  }
}
