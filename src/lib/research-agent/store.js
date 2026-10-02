// ============================================================
// 🗄️ src/lib/research-agent/store.js — ที่เก็บของ Research Agent v2 ฝั่งเว็บ (เลน B · 1 ต.ค. 69)
// ------------------------------------------------------------
// สเปก C:\tmp\research-agent-lab\SPEC-v2.md ส่วน 2.1–2.3 · ตาราง Supabase store_items (ไม่แก้ schema — prisma ห้ามแตะ)
//   store 'research-requests' (ใบขอค้นคว้า 1 ใบ/งานคิว) · 'research-cards' (ผลการ์ด) · 'bot-posted' (บอทจดว่าโพสต์ผลที่ไหน)
//   + 'research-workers' (ชีพจร/โควตาของ worker ต่อเครื่อง — ใช้ตอบ /api/research/status และตัดสิน "ออฟไลน์")
//   + ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): 'research-editor' (ผลบรรณาธิการเรียบเรียง · row 'redit_<jobId>')
//     saveEditorResult/getEditorResult · ไม่เก็บฉบับเสริมเต็ม (พรีวิว ≤400) · บอทอ่านผ่านช่อง editor ของ GET /api/research/cards
//   + ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7): 'bot-state' (สถานะถาวรของบอท · row 'bstate_<key>' · insert/cas)
//     getBotState/saveBotState · บอทอ่าน/เขียนผ่าน /api/research/bot-state (กันสรุปรายวันส่งซ้ำหลัง redeploy)
// ⚠️ กับดักที่ต้องรู้: store_items.id เป็น PK ทั้งตาราง (โค้ดเดิม upsert onConflict:'id' — ytJobStore/megaJobStore ฯลฯ)
//   ไม่ใช่ต่อ store → job_queue ใช้ jobId (q_…) เป็น id อยู่แล้ว ถ้าใช้ jobId ตรงๆ จะชน 23505 ทันที
//   จึงเติมคำนำหน้า row id ต่อ store (rreq_ / rcard_ / bposted_ / rworker_) · ส่วน data.id = jobId ตามสัญญา 2.x ทุกไบต์
//   → อ่านด้วย persistStore.findById ต้องส่ง row id ที่เติมคำนำหน้าแล้ว (researchRequestRowId ฯลฯ ด้านล่าง)
// ★ bot-posted มีนิยามเดียวที่นี่ (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69): row id 'bposted_<jobId>' · data.id = jobId · revision/cas
//   route /api/bot/posted (เลน C) ต้องเรียก saveBotPosted/getBotPosted ของไฟล์นี้ ห้ามเขียน persistStore ตรง
//   (ต่างจากสัญญา 2.3 ที่เขียน "id: jobId" เฉพาะระดับ row id — เพราะ PK ข้าม store · ระดับ data ยังตรงสัญญา)
// เขียนแบบ insert (ชน 23505 = มีแล้ว) / cas (eq data->>revision) แบบเดียวกับ src/lib/routine/storage.mjs
//   — persistStore.add ใช้ item.id เป็น row id และไม่มี cas จึงไม่ใช้เขียนที่นี่
//   ทุกเอกสารมี revision (เลขจำนวนเต็ม +1 ทุกครั้งที่เปลี่ยน) · ฐานล้ม = ResearchStorageError (503) ไม่มีข้อความดิบจาก DB
// ไม่มีโหมดไฟล์สำรอง: งานข่าวที่จะมีใบขอได้ต้องผ่าน /api/queue/add ซึ่งบังคับ Supabase อยู่แล้ว · ท่อข่าวอ่านไม่ได้ = fail-open
// ============================================================

import { buildResearchCardsDoc, capText, normalizeFeedbackList, normalizeHttpUrl, normalizeSuggestedDimensions } from '@/lib/research-agent/cardsSchema';
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): + normalizeSuggestedDimensions (ใช้ใน buildEditorResultDoc) · ของเดิม: import 4 ตัวแรก
import { getResearchAgentDeadlineMin, isResearchAgentOn } from '@/lib/research-agent/modes';

export const RESEARCH_REQUESTS_STORE = 'research-requests';
export const RESEARCH_CARDS_STORE = 'research-cards';
export const BOT_POSTED_STORE = 'bot-posted';
export const RESEARCH_WORKERS_STORE = 'research-workers';
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): ผลบรรณาธิการเรียบเรียง แยกจาก research-cards
//   (เอเจนต์อาจ report ซ้ำ/ชน cas กับเอกสารการ์ด) · row id 'redit_<jobId>' · data.id = jobId · เขียนแบบ upsert (insert/cas)
export const RESEARCH_EDITOR_STORE = 'research-editor';
export const RESEARCH_EDITOR_STATUSES = Object.freeze(['done', 'not_ready', 'failed', 'skipped']);
/** เก็บเนื้อฉบับเสริมได้แค่พรีวิว ≤ 400 ตัวอักษร (เนื้อข่าวสุดท้ายอยู่ generation_logs แล้ว — สัญญา 8.1) */
export const RESEARCH_EDITOR_PREVIEW_CHARS = 400;

export const RESEARCH_JOB_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
export const RESEARCH_WORKER_ID_RE = /^[A-Za-z0-9._:@-]{1,80}$/;
export const RESEARCH_REQUEST_STATUSES = Object.freeze(['queued', 'leased', 'done', 'failed', 'expired']);
export const RESEARCH_MAX_RAW_TEXT_CHARS = 50_000;
export const RESEARCH_MAX_SOURCE_URLS = 10;

const TABLE = 'store_items';
const LEASE_SCAN_LIMIT = 20;
const LIST_LIMIT = 50;
const CAS_RETRIES = 3;
const WORKER_TOUCH_THROTTLE_MS = 20_000;
const DISCORD_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const WORKER_VERSION_RE = /^[A-Za-z0-9._:+@-]{1,40}$/;
/** บอทเก็บ id ข้อความผลได้ ≤ 50 รายการ (discord-bot/researchCard.js collectResult) — เก็บครบไม่ตัดทิ้ง */
export const BOT_POSTED_MAX_RESULT_MSG_IDS = 50;

export const researchRequestRowId = (jobId) => `rreq_${jobId}`;
export const researchCardsRowId = (jobId) => `rcard_${jobId}`;
export const botPostedRowId = (jobId) => `bposted_${jobId}`;
export const researchWorkerRowId = (workerId) => `rworker_${workerId}`;
export const researchEditorRowId = (jobId) => `redit_${jobId}`; // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1)

// ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7): สถานะถาวรของบอท (ทนรีสตาร์ต/ทับกันช่วง Railway redeploy)
//   store 'bot-state' · row id 'bstate_<key>' · data = {id: key, state: {...}, revision, createdAt, updatedAt}
//   เขียนแบบ insert/cas เท่านั้น (saveBotState: expectedRevision 0 = ต้องยังไม่มีแถว · n = revision ปัจจุบันต้องเป็น n · ไม่ตรง = conflict)
//   key ที่รับ = BOT_STATE_KEYS ('daily-digest' = วันที่ส่งสรุปรายวันล่าสุด + การจองส่ง) · state = JSON object ≤ 4,000 ตัวอักษร
//   ประตู HTTP: src/app/api/research/bot-state/route.js (checkBotKey) · ผู้ใช้: discord-bot/researchCard.js createResearchWatchdog
export const BOT_STATE_STORE = 'bot-state';
export const BOT_STATE_KEYS = Object.freeze(['daily-digest']);
export const BOT_STATE_MAX_CHARS = 4000;
export const botStateRowId = (key) => `bstate_${key}`;

/**
 * ★ 2 ต.ค. 69 (W7): ตรวจข้อมูลสถานะบอทก่อนเขียน → {key, state (สำเนา JSON), expectedRevision} · ผิด = researchInputError (route แปลงเป็น 400)
 * @param {string} key
 * @param {object} state
 * @param {number} expectedRevision
 */
export function normalizeBotStateInput(key, state, expectedRevision) {
  if (!BOT_STATE_KEYS.includes(key)) throw researchInputError('key ของสถานะบอทไม่รู้จัก');
  if (!isPlainObject(state)) throw researchInputError('state ต้องเป็น JSON object');
  let json;
  try {
    json = JSON.stringify(state);
  } catch {
    throw researchInputError('state ต้องแปลงเป็น JSON ได้');
  }
  if (json.length > BOT_STATE_MAX_CHARS) throw researchInputError(`state ยาวเกิน ${BOT_STATE_MAX_CHARS} ตัวอักษร`);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw researchInputError('expectedRevision ต้องเป็นจำนวนเต็ม ≥ 0');
  return { key, state: JSON.parse(json), expectedRevision };
}

export class ResearchStorageError extends Error {
  constructor(message = 'ที่เก็บข้อมูลรีเสิร์ชใช้ไม่ได้ชั่วคราว') {
    super(message);
    this.name = 'ResearchStorageError';
    this.errorType = 'RESEARCH_STORAGE_UNAVAILABLE';
    this.status = 503;
  }
}

/** ข้อมูลเข้าไม่ถูกต้อง (route แปลงเป็น 400) — แยกจาก TypeError ทั่วไปที่อาจเป็นบั๊กภายใน */
export function researchInputError(message) {
  const error = new TypeError(message);
  error.code = 'RESEARCH_INVALID_INPUT';
  return error;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRevision = (value) => Number.isSafeInteger(value) && value >= 1;

/** รายการลิงก์ต้นทางที่บอทแยกจากข้อความพนักงาน → เฉพาะ http(s) ไม่ซ้ำ ไม่เกิน 10 ลิงก์ */
export function sanitizeSourceUrls(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const href = normalizeHttpUrl(item);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= RESEARCH_MAX_SOURCE_URLS) break;
  }
  return out;
}

/** workflowId ของงานคิว = unify_<jobId> (process/route.js) · อื่นๆ (เว็บยิงตรง/routine) = null */
export function jobIdFromWorkflowId(workflowId) {
  const match = /^unify_(.+)$/.exec(typeof workflowId === 'string' ? workflowId : '');
  return match && RESEARCH_JOB_ID_RE.test(match[1]) ? match[1] : null;
}

const optionalId = (value) => (typeof value === 'string' && DISCORD_ID_RE.test(value.trim()) ? value.trim() : null);

/** caseId ของ generation log = ข้อความ (เช่น '06499' · ไม่บังคับตัวเลข — ข้อตัดสิน 1 ต.ค. 69) หรือเลขจำนวนเต็ม → ข้อความ */
function botPostedCaseId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return optionalId(value);
}

/** เวลาเป็นเลข ms หรือข้อความวันที่ → ISO · อ่านไม่ได้/นอกช่วงของ Date = null */
function isoTimeOrNull(value) {
  let ms = null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) ms = value;
  else if (typeof value === 'string' && value.trim()) ms = Date.parse(value.trim());
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** ใบขอค้นคว้า (สัญญา 2.1) — deadlineAt = createdAt + RESEARCH_AGENT_DEADLINE_MIN นาที (ข้อตัดสิน 1 ต.ค. 69 · ค่าเริ่มต้น 15) */
export function buildResearchRequest({ jobId, rawText, sourceUrls, userId, channelId, sourceMessageId, nowMs, deadlineMin }) {
  if (!RESEARCH_JOB_ID_RE.test(String(jobId || ''))) throw researchInputError('jobId ไม่ถูกต้อง');
  const createdMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const minutes = Number.isFinite(deadlineMin) && deadlineMin > 0 ? deadlineMin : getResearchAgentDeadlineMin();
  const doc = {
    id: jobId,
    workflowId: `unify_${jobId}`,
    rawText: capText(typeof rawText === 'string' ? rawText : '', RESEARCH_MAX_RAW_TEXT_CHARS),
    sourceUrls: sanitizeSourceUrls(sourceUrls),
    userId: capText(typeof userId === 'string' ? userId : '', 120) || 'discord-bot',
    status: 'queued',
    attempt: 0,
    createdAt: new Date(createdMs).toISOString(),
    deadlineAt: new Date(createdMs + minutes * 60_000).toISOString(),
    revision: 1,
  };
  const channel = optionalId(channelId);
  if (channel) doc.channelId = channel;
  const sourceMessage = optionalId(sourceMessageId);
  if (sourceMessage) doc.sourceMessageId = sourceMessage;
  return doc;
}

function validRequest(doc) {
  return isPlainObject(doc) && RESEARCH_JOB_ID_RE.test(String(doc.id || ''))
    && RESEARCH_REQUEST_STATUSES.includes(doc.status) && isRevision(doc.revision)
    && Number.isFinite(Date.parse(doc.deadlineAt || ''));
}

// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): ระเบียนผลบรรณาธิการ (store research-editor)
const EDITOR_CARD_ID_RE = /^R\d{1,2}$/;
const EDITOR_FLAG_RE = /^[A-Z][A-Z0-9_]{1,47}$/;
const editorText = (value, max) => capText(typeof value === 'number' ? String(value) : value, max);
const editorCardId = (value) => (typeof value === 'string' && EDITOR_CARD_ID_RE.test(value) ? value : null);
const editorCount = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);

/**
 * ระเบียน "ผลบรรณาธิการ" ตามสัญญา 8.1 — เก็บเฉพาะช่องในสัญญา (allowlist) + ตัดความยาวทุกช่อง
 *   ห้ามมี enriched_source เต็ม (เก็บได้แค่ enriched_preview ≤ 400) · status นอกรายการ = failed · mode = 'write' เสมอ
 *   revision/createdAt = ของที่เก็บ (upsert แบบ cas) · ช่องที่ไม่ส่ง = ค่าว่างตามชนิด (ผู้อ่าน/บอทไม่ต้องเช็ค undefined)
 * @param {string} jobId
 * @param {object} record  ผลจาก writeStage (src/lib/research-agent/writeStage.js)
 * @param {{ nowIso: string, existing?: object|null }} ctx
 */
export function buildEditorResultDoc(jobId, record, { nowIso, existing = null } = {}) {
  if (!RESEARCH_JOB_ID_RE.test(String(jobId || ''))) throw researchInputError('jobId ไม่ถูกต้อง');
  const src = isPlainObject(record) ? record : {};
  const list = (value) => (Array.isArray(value) ? value : []);
  const iso = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString();
  const doc = {
    id: jobId,
    status: RESEARCH_EDITOR_STATUSES.includes(src.status) ? src.status : 'failed',
    mode: 'write',
    used_cards: [...new Set(list(src.used_cards).map(editorCardId).filter(Boolean))].slice(0, 20),
    corrections: list(src.corrections).filter(isPlainObject).map((c) => ({
      field: editorText(c.field, 80),
      from: editorText(c.from, 300),
      to: editorText(c.to, 300),
      source_url: normalizeHttpUrl(c.source_url),
      source_name: editorText(c.source_name, 200),
      card: editorCardId(c.card),
    })).filter((c) => c.field || c.to).slice(0, 10),
    additions: list(src.additions).filter(isPlainObject)
      .map((a) => ({ text: editorText(a.text, 300), card: editorCardId(a.card) }))
      .filter((a) => a.text).slice(0, 12),
    not_used: list(src.not_used).filter(isPlainObject)
      .map((n) => ({ card: editorCardId(n.card), why: editorText(n.why, 200) }))
      .filter((n) => n.card || n.why).slice(0, 20),
    suggested_dimensions: normalizeSuggestedDimensions(src.suggested_dimensions),
    staff_notes: list(src.staff_notes).map((s) => editorText(s, 300)).filter(Boolean).slice(0, 10),
    warnings: list(src.warnings).map((s) => editorText(s, 300)).filter(Boolean).slice(0, 10),
    flags: [...new Set(list(src.flags).map((f) => editorText(f, 48).toUpperCase()).filter((f) => EDITOR_FLAG_RE.test(f)))].slice(0, 20),
    original_chars: editorCount(src.original_chars),
    enriched_chars: editorCount(src.enriched_chars),
    ratio: typeof src.ratio === 'number' && Number.isFinite(src.ratio) && src.ratio >= 0 ? Math.round(src.ratio * 100) / 100 : null,
    waitedMs: editorCount(src.waitedMs),
    editorMs: editorCount(src.editorMs),
    model: editorText(src.model, 60) || null,
    reason: editorText(src.reason, 300) || null,
    createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : iso,
    updatedAt: iso,
    revision: (isRevision(existing?.revision) ? existing.revision : 0) + 1,
  };
  const preview = editorText(src.enriched_preview, RESEARCH_EDITOR_PREVIEW_CHARS);
  if (preview) doc.enriched_preview = preview;
  return doc;
}

/** โควตาที่ worker แจ้ง (ตัวเลข % ที่เหลือ หรือ {pct|remainingPct|percentLeft, account}) → {pct, account} | null */
export function normalizeQuotaReport(quota, account) {
  let pct = null;
  let acct = typeof account === 'string' ? account : null;
  if (typeof quota === 'number') pct = quota;
  else if (isPlainObject(quota)) {
    pct = [quota.pct, quota.remainingPct, quota.percentLeft, quota.left].find((v) => typeof v === 'number') ?? null;
    if (typeof quota.account === 'string') acct = quota.account;
  }
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return { pct, account: capText(acct || '', 40) || null };
}

/**
 * โควตาใน body ของ /lease และ /heartbeat (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 · contract-check #1):
 *   สัญญาใหม่ worker ส่ง {account, quota: {remainingPct}} · worker รุ่นแรกส่ง {account, quotaPct} — รับทั้งสองรูป
 *   (body.quota?.remainingPct ?? body.quotaPct) → {pct, account} | null
 */
export function workerQuotaFromBody(body) {
  if (!isPlainObject(body)) return null;
  return normalizeQuotaReport(body.quota, body.account) ?? normalizeQuotaReport(body.quotaPct, body.account);
}

/** เวอร์ชันโปรโตคอล worker ที่แสดงใน /api/research/status (สาธารณะ) — เฉพาะอักขระปลอดภัย ≤ 40 ตัว · อื่นๆ = null */
export function normalizeWorkerVersion(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return WORKER_VERSION_RE.test(text) ? text : null;
}

const _workerTouchedAt = new Map(); // throttle ต่อโปรเซส: lease วนถี่ — ไม่เขียนชีพจรทุกครั้ง

/**
 * ที่เก็บของ Research Agent บน Supabase client ที่ส่งมา (เทสฉีด sb ปลอมได้)
 * @param {{ sb: object, now?: () => number }} deps
 */
export function createResearchStorage({ sb, now = () => Date.now() } = {}) {
  if (!sb || typeof sb.from !== 'function') throw new ResearchStorageError();
  const isoNow = () => new Date(now()).toISOString();

  async function run(query) {
    let result;
    try {
      result = await query;
    } catch {
      throw new ResearchStorageError();
    }
    if (!result || result.error) throw new ResearchStorageError();
    return result;
  }

  async function getDoc(store, rowId) {
    const result = await run(sb.from(TABLE).select('data').eq('store_name', store).eq('id', rowId).maybeSingle());
    if (result.data === null || result.data === undefined) return null;
    if (!isPlainObject(result.data) || !isPlainObject(result.data.data)) throw new ResearchStorageError();
    return result.data.data;
  }

  async function insertDoc(store, rowId, data, createdAt) {
    let result;
    try {
      result = await sb.from(TABLE).insert({
        id: rowId, store_name: store, data, created_at: createdAt || isoNow(), updated_at: isoNow(),
      }).select('id');
    } catch {
      throw new ResearchStorageError();
    }
    if (result?.error?.code === '23505') return false;
    if (!result || result.error || !Array.isArray(result.data) || result.data.length !== 1) throw new ResearchStorageError();
    return true;
  }

  async function casDoc(store, rowId, expectedRevision, data) {
    const result = await run(sb.from(TABLE)
      .update({ data, updated_at: isoNow() })
      .eq('store_name', store).eq('id', rowId)
      .eq('data->>revision', String(expectedRevision))
      .select('id'));
    if (!Array.isArray(result.data) || result.data.length > 1) throw new ResearchStorageError();
    return result.data.length === 1;
  }

  async function listDocs(store, { status, limit = LIST_LIMIT, orderBy = 'created_at', ascending = true } = {}) {
    let query = sb.from(TABLE).select('id,data').eq('store_name', store);
    if (status) query = query.eq('data->>status', status);
    const result = await run(query.order(orderBy, { ascending }).limit(limit));
    if (!Array.isArray(result.data)) throw new ResearchStorageError();
    return result.data.map((row) => row?.data).filter(isPlainObject);
  }

  const getRequest = (jobId) => getDoc(RESEARCH_REQUESTS_STORE, researchRequestRowId(jobId));
  const getCards = (jobId) => getDoc(RESEARCH_CARDS_STORE, researchCardsRowId(jobId));

  /** เปลี่ยนใบขอแบบ cas · mutate(request) คืน null = ไม่ต้องเปลี่ยน · คืน {outcome, request} */
  async function updateRequest(jobId, mutate) {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
      // eslint-disable-next-line no-await-in-loop -- cas retry ต้องอ่านค่าล่าสุดก่อนเขียนทุกรอบ
      const current = await getRequest(jobId);
      if (!current) return { outcome: 'not_found', request: null };
      if (!validRequest(current)) throw new ResearchStorageError();
      const next = mutate(current);
      if (!next) return { outcome: 'unchanged', request: current };
      const doc = { ...next, revision: current.revision + 1, updatedAt: isoNow() };
      // eslint-disable-next-line no-await-in-loop -- เขียนแบบ cas ทีละรอบ
      if (await casDoc(RESEARCH_REQUESTS_STORE, researchRequestRowId(jobId), current.revision, doc)) {
        return { outcome: 'updated', request: doc };
      }
    }
    return { outcome: 'conflict', request: null };
  }

  return {
    getRequest,
    getCards,

    /** สร้างใบขอ (สัญญา 2.1) · มีแล้ว = created:false (ไม่ทับ) */
    async createRequest(input) {
      const doc = buildResearchRequest({ ...input, nowMs: now() });
      const created = await insertDoc(RESEARCH_REQUESTS_STORE, researchRequestRowId(doc.id), doc, doc.createdAt);
      return { created, request: created ? doc : null };
    },

    /** หยิบใบขอที่ status queued ใบเก่าสุดที่ยังไม่เลย deadline → leased (cas กันสอง worker หยิบซ้ำ) · เลย deadline = expired */
    async leaseNext({ workerId }) {
      if (!RESEARCH_WORKER_ID_RE.test(String(workerId || ''))) throw researchInputError('workerId ไม่ถูกต้อง');
      const queued = await listDocs(RESEARCH_REQUESTS_STORE, { status: 'queued', limit: LEASE_SCAN_LIMIT });
      for (const request of queued) {
        if (!validRequest(request) || request.status !== 'queued') continue;
        const nowMs = now();
        const iso = new Date(nowMs).toISOString();
        const rowId = researchRequestRowId(request.id);
        if (Date.parse(request.deadlineAt) <= nowMs) {
          // eslint-disable-next-line no-await-in-loop -- ปิดใบที่เลยเวลาไปทีละใบ (best effort)
          await casDoc(RESEARCH_REQUESTS_STORE, rowId, request.revision, {
            ...request, status: 'expired', expiredAt: iso, updatedAt: iso, revision: request.revision + 1,
          }).catch(() => false);
          continue;
        }
        const leased = {
          ...request,
          status: 'leased',
          leasedBy: workerId,
          leasedAt: iso,
          heartbeatAt: iso,
          attempt: (Number.isSafeInteger(request.attempt) ? request.attempt : 0) + 1,
          revision: request.revision + 1,
          updatedAt: iso,
        };
        // eslint-disable-next-line no-await-in-loop -- แพ้ cas = มี worker อื่นหยิบไปแล้ว → ลองใบถัดไป
        if (await casDoc(RESEARCH_REQUESTS_STORE, rowId, request.revision, leased)) return leased;
      }
      return null;
    },

    /** ชีพจรของงานที่ถืออยู่ → {outcome: ok|not_found|lost|conflict} */
    async heartbeat({ jobId, workerId }) {
      const result = await updateRequest(jobId, (current) => {
        if (current.status !== 'leased' || current.leasedBy !== workerId) return null;
        return { ...current, heartbeatAt: isoNow() };
      });
      if (result.outcome === 'updated') return { outcome: 'ok', request: result.request };
      if (result.outcome === 'unchanged') return { outcome: 'lost', request: result.request };
      return { outcome: result.outcome, request: result.request };
    },

    /**
     * รับผลจาก worker ที่ถือใบขออยู่ → เขียน research-cards (insert/cas) แล้วปิดใบขอ (done/failed)
     * ส่งซ้ำหลังสำเร็จ (worker retry) = duplicate คืนเอกสารเดิม ไม่เขียนทับ
     */
    async report({ jobId, workerId, result, mode }) {
      const request = await getRequest(jobId);
      if (!request) return { outcome: 'not_found' };
      if (!validRequest(request)) throw new ResearchStorageError();
      if (request.leasedBy !== workerId) return { outcome: 'lost', request };
      const existing = await getCards(jobId);
      if (request.status === 'done' || request.status === 'failed') {
        if (existing) return { outcome: 'duplicate', doc: existing, request };
      } else if (request.status !== 'leased') {
        return { outcome: 'lost', request };
      }
      let current = existing;
      let built = null;
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        built = buildResearchCardsDoc(result, { jobId, mode, nowIso: isoNow(), existing: current });
        const rowId = researchCardsRowId(jobId);
        let wrote;
        if (current && isRevision(current.revision)) {
          // eslint-disable-next-line no-await-in-loop -- เขียนแบบ cas ทีละรอบ (ชน = อ่านใหม่แล้วลองอีก)
          wrote = await casDoc(RESEARCH_CARDS_STORE, rowId, current.revision, built.doc);
        } else {
          // eslint-disable-next-line no-await-in-loop -- insert ทีละรอบ (ชน 23505 = มีคนเขียนก่อน → อ่านใหม่แล้ว cas)
          wrote = await insertDoc(RESEARCH_CARDS_STORE, rowId, built.doc, built.doc.createdAt);
        }
        if (wrote) break;
        built = null;
        // eslint-disable-next-line no-await-in-loop -- ชน (feedback/report อื่น) → อ่านค่าล่าสุด
        current = await getCards(jobId);
      }
      if (!built) throw new ResearchStorageError('บันทึกการ์ดชนกับการเขียนอื่นเกินจำนวนครั้งที่กำหนด');
      const finalStatus = built.doc.status === 'failed' ? 'failed' : 'done';
      const closed = await updateRequest(jobId, (latest) => {
        if (latest.leasedBy !== workerId || (latest.status !== 'leased' && latest.status !== 'done' && latest.status !== 'failed')) return null;
        if (latest.status === finalStatus && latest.cardsRevision === built.doc.revision) return null;
        return { ...latest, status: finalStatus, reportedAt: isoNow(), cardsRevision: built.doc.revision };
      });
      return {
        outcome: 'stored',
        doc: built.doc,
        schemaErrors: built.schemaErrors,
        gateChanges: built.gateChanges,
        request: closed.request || request,
        requestClosed: closed.outcome === 'updated',
      };
    },

    /**
     * โหวต 👍/👎 ต่อการ์ด (หรือ 'all') — ผู้ใช้เดิมโหวตการ์ดเดิมซ้ำ = แทนที่ของเก่า
     * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.2 · เลน W2): kind 'editor' = โหวตใบที่สอง (ผลบรรณาธิการ)
     *   ลงช่อง feedback เดิมติดป้าย kind:'editor' · แทนที่เฉพาะโหวตชนิดเดียวกัน (ไม่ทับโหวตใบแรกของคนเดิม) · ไม่ส่ง kind = เดิมทุกไบต์
     *   ของเดิม: async addFeedback({ jobId, cardId, vote, userId }) {
     */
    async addFeedback({ jobId, cardId, vote, userId, kind }) {
      const editorVote = kind === 'editor';
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        // eslint-disable-next-line no-await-in-loop -- cas retry ต้องอ่านค่าล่าสุดก่อนเขียนทุกรอบ
        const doc = await getCards(jobId);
        if (!doc) return { outcome: 'not_found' };
        if (!isRevision(doc.revision)) throw new ResearchStorageError();
        if (cardId !== 'all' && !(Array.isArray(doc.cards) && doc.cards.some((c) => c?.id === cardId))) {
          return { outcome: 'unknown_card' };
        }
        const at = isoNow();
        // ★ W2 ของเดิม: .filter((f) => !(f.userId === userId && f.cardId === cardId)); · feedback.push({ userId, cardId, vote, at });
        const feedback = normalizeFeedbackList(doc.feedback)
          .filter((f) => !(f.userId === userId && f.cardId === cardId && (f.kind === 'editor') === editorVote));
        feedback.push(editorVote ? { userId, cardId, vote, at, kind: 'editor' } : { userId, cardId, vote, at });
        const next = { ...doc, feedback: normalizeFeedbackList(feedback), revision: doc.revision + 1, updatedAt: at };
        // eslint-disable-next-line no-await-in-loop -- เขียนแบบ cas ทีละรอบ
        if (await casDoc(RESEARCH_CARDS_STORE, researchCardsRowId(jobId), doc.revision, next)) {
          return { outcome: 'stored', doc: next };
        }
      }
      return { outcome: 'conflict' };
    },

    /**
     * แตะชีพจร worker (best effort — ล้มเงียบ คืน false) · event: lease|heartbeat|report
     * lease ถูก throttle ต่อโปรเซส (worker วนขอทุกไม่กี่วินาที) · quota = {pct, account} จาก workerQuotaFromBody/normalizeQuotaReport
     * version = โปรโตคอล worker (body.version · สำรอง header x-research-worker-version) ผ่าน normalizeWorkerVersion
     */
    async touchWorker({ workerId, event = 'lease', jobId = null, quota = null, version = null, force = false }) {
      try {
        if (!RESEARCH_WORKER_ID_RE.test(String(workerId || ''))) return false;
        const nowMs = now();
        const key = `${workerId}`;
        if (event === 'lease' && !quota && !force && nowMs - (_workerTouchedAt.get(key) || 0) < WORKER_TOUCH_THROTTLE_MS) return false;
        _workerTouchedAt.set(key, nowMs);
        const iso = new Date(nowMs).toISOString();
        const rowId = researchWorkerRowId(workerId);
        for (let attempt = 0; attempt < 2; attempt++) {
          // eslint-disable-next-line no-await-in-loop -- อ่านค่าล่าสุดก่อน cas
          const current = await getDoc(RESEARCH_WORKERS_STORE, rowId);
          const base = isPlainObject(current) ? current : { id: workerId, workerId, createdAt: iso };
          const next = {
            ...base,
            id: workerId,
            workerId,
            lastSeenAt: iso,
            lastEvent: event,
            [`last${event.charAt(0).toUpperCase()}${event.slice(1)}At`]: iso,
            revision: (isRevision(base.revision) ? base.revision : 0) + 1,
            updatedAt: iso,
          };
          if (jobId && RESEARCH_JOB_ID_RE.test(jobId)) next.currentJobId = jobId;
          if (quota) next.quota = { pct: quota.pct, account: quota.account, at: iso };
          const safeVersion = normalizeWorkerVersion(version);
          if (safeVersion) next.version = safeVersion;
          let ok;
          if (current) {
            // eslint-disable-next-line no-await-in-loop -- เขียนแบบ cas ทีละรอบ
            ok = await casDoc(RESEARCH_WORKERS_STORE, rowId, current.revision, next);
          } else {
            // eslint-disable-next-line no-await-in-loop -- insert ทีละรอบ
            ok = await insertDoc(RESEARCH_WORKERS_STORE, rowId, next, iso);
          }
          if (ok) return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    /** ชีพจร worker ล่าสุด (ใหม่สุดก่อน) */
    listWorkers({ limit = 10 } = {}) {
      return listDocs(RESEARCH_WORKERS_STORE, { limit, orderBy: 'updated_at', ascending: false });
    },

    /** ใบขอตามสถานะ (เก่าสุดก่อน · ไม่เกิน limit) */
    listRequests({ status, limit = LIST_LIMIT } = {}) {
      return listDocs(RESEARCH_REQUESTS_STORE, { status, limit });
    },

    /**
     * bot-posted (สัญญา 2.3 · นิยามเดียวของระบบ — /api/bot/posted ของเลน C เรียกที่นี่) — บอทจดตอนโพสต์ผล/โพสต์บัตร
     * มีแล้ว = รวมเฉพาะช่องที่ส่งมาใหม่และถูกรูป (cas) · ช่องที่ไม่ส่ง/ผิดรูป/null = คงค่าเดิม (ไม่ลบ)
     *   id ข้อความ Discord = [A-Za-z0-9_-] ≤100 · resultMsgIds ไม่ซ้ำ ≤ 50 · caseId = ข้อความแบบเดียวกัน (ไม่บังคับตัวเลข) หรือเลขจำนวนเต็ม
     *   postedAt = เวลาที่บอทส่งมา (เลข ms/ISO) — แถวใหม่ที่ยังไม่ส่ง = null (บัตรขึ้นก่อนผลข่าว) · createdAt = ครั้งแรกที่จด
     * @returns {Promise<object>} เอกสารที่บันทึกแล้ว · jobId ผิด = researchInputError (400) · ชน cas เกิน 3 รอบ/ฐานล้ม = ResearchStorageError
     */
    async saveBotPosted(input) {
      const jobId = String(input?.jobId ?? input?.id ?? '');
      if (!RESEARCH_JOB_ID_RE.test(jobId)) throw researchInputError('jobId ไม่ถูกต้อง');
      const patch = {};
      // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.2): + editorMsgId (บอทจดข้อความ "สิ่งที่เพิ่ม/แก้" กันโพสต์ซ้ำหลัง restart)
      //   ของเดิม: ['channelId', 'sourceMessageId', 'processingMsgId', 'researchCardMsgId'] · ⚠️ route /api/bot/posted ต้องส่งช่องนี้ต่อด้วย
      for (const key of ['channelId', 'sourceMessageId', 'processingMsgId', 'researchCardMsgId', 'editorMsgId']) {
        const value = optionalId(input?.[key]);
        if (value) patch[key] = value;
      }
      if (Array.isArray(input?.resultMsgIds)) {
        patch.resultMsgIds = [...new Set(input.resultMsgIds.map(optionalId).filter(Boolean))].slice(0, BOT_POSTED_MAX_RESULT_MSG_IDS);
      }
      const caseId = botPostedCaseId(input?.caseId);
      if (caseId) patch.caseId = caseId;
      const postedAt = isoTimeOrNull(input?.postedAt);
      if (postedAt) patch.postedAt = postedAt;
      const rowId = botPostedRowId(jobId);
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        const iso = isoNow();
        // eslint-disable-next-line no-await-in-loop -- อ่านค่าล่าสุดก่อน cas
        const current = await getDoc(BOT_POSTED_STORE, rowId);
        const next = current
          ? { ...current, ...patch, id: jobId, revision: (isRevision(current.revision) ? current.revision : 0) + 1, updatedAt: iso }
          : { id: jobId, resultMsgIds: [], postedAt: null, ...patch, createdAt: iso, revision: 1, updatedAt: iso };
        // eslint-disable-next-line no-await-in-loop -- เขียนแบบ cas/insert ทีละรอบ
        const ok = current ? await casDoc(BOT_POSTED_STORE, rowId, current.revision, next) : await insertDoc(BOT_POSTED_STORE, rowId, next, iso);
        if (ok) return next;
      }
      throw new ResearchStorageError('บันทึก bot-posted ชนกับการเขียนอื่นเกินจำนวนครั้งที่กำหนด');
    },

    getBotPosted(jobId) {
      return getDoc(BOT_POSTED_STORE, botPostedRowId(jobId));
    },

    /**
     * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): บันทึกผลบรรณาธิการ (upsert) — ท่อข่าวเรียกทุกกรณี
     * (done/not_ready/failed/skipped) · มีแล้ว = ทับด้วยรอบล่าสุดแบบ cas (งานคิวที่ถูกส่งซ้ำ) · createdAt คงของเดิม
     * @returns {Promise<object>} เอกสารที่บันทึกแล้ว · jobId ผิด = researchInputError · ชน cas เกิน 3 รอบ/ฐานล้ม = ResearchStorageError
     */
    async saveEditorResult(jobId, record) {
      if (!RESEARCH_JOB_ID_RE.test(String(jobId || ''))) throw researchInputError('jobId ไม่ถูกต้อง');
      const rowId = researchEditorRowId(jobId);
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        // eslint-disable-next-line no-await-in-loop -- อ่านค่าล่าสุดก่อน cas
        const current = await getDoc(RESEARCH_EDITOR_STORE, rowId);
        const doc = buildEditorResultDoc(jobId, record, { nowIso: isoNow(), existing: current });
        // eslint-disable-next-line no-await-in-loop -- เขียนแบบ cas/insert ทีละรอบ
        const ok = current ? await casDoc(RESEARCH_EDITOR_STORE, rowId, current.revision, doc) : await insertDoc(RESEARCH_EDITOR_STORE, rowId, doc, doc.createdAt);
        if (ok) return doc;
      }
      throw new ResearchStorageError('บันทึกผลบรรณาธิการชนกับการเขียนอื่นเกินจำนวนครั้งที่กำหนด');
    },

    /** ★ 1 ต.ค. 69 (โหมด write · สัญญา 8.1): ผลบรรณาธิการของงาน | null */
    getEditorResult(jobId) {
      return getDoc(RESEARCH_EDITOR_STORE, researchEditorRowId(jobId));
    },

    /** ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7): สถานะถาวรของบอท | null · key ไม่รู้จัก = researchInputError */
    async getBotState(key) {
      if (!BOT_STATE_KEYS.includes(key)) throw researchInputError('key ของสถานะบอทไม่รู้จัก');
      return getDoc(BOT_STATE_STORE, botStateRowId(key));
    },

    /**
     * ★ 2 ต.ค. 69 (W7): เขียนสถานะบอทแบบ cas (กันสอง instance ช่วง redeploy ส่งสรุปซ้ำ)
     *   expectedRevision 0 = ต้องยังไม่มีแถว (insert · ชน 23505 = conflict) · n ≥ 1 = แถวปัจจุบันต้อง revision n (ไม่ตรง/ชน = conflict)
     * @returns {Promise<{outcome: 'stored', item: object} | {outcome: 'conflict', item: object|null}>} item ของ conflict = ค่าล่าสุดในฐาน
     */
    async saveBotState(key, state, { expectedRevision = 0 } = {}) {
      const input = normalizeBotStateInput(key, state, expectedRevision);
      const rowId = botStateRowId(input.key);
      const iso = isoNow();
      if (input.expectedRevision === 0) {
        const doc = { id: input.key, state: input.state, revision: 1, createdAt: iso, updatedAt: iso };
        if (await insertDoc(BOT_STATE_STORE, rowId, doc, iso)) return { outcome: 'stored', item: doc };
        return { outcome: 'conflict', item: await getDoc(BOT_STATE_STORE, rowId) };
      }
      const current = await getDoc(BOT_STATE_STORE, rowId);
      if (!current || current.revision !== input.expectedRevision) return { outcome: 'conflict', item: current };
      const doc = { ...current, id: input.key, state: input.state, revision: input.expectedRevision + 1, updatedAt: iso };
      if (await casDoc(BOT_STATE_STORE, rowId, input.expectedRevision, doc)) return { outcome: 'stored', item: doc };
      return { outcome: 'conflict', item: await getDoc(BOT_STATE_STORE, rowId) };
    },
  };
}

/** ต่อ Supabase จริง (lazy import — โหลดโมดูลนี้เฉยๆ ไม่แตะฐาน) · ไม่พร้อม = ResearchStorageError */
export async function loadResearchStorage() {
  let supabase;
  try {
    supabase = await import('@/lib/supabase');
  } catch {
    throw new ResearchStorageError();
  }
  if (!supabase?.isSupabaseReady?.()) throw new ResearchStorageError('ยังไม่ได้เชื่อม Supabase — ระบบรีเสิร์ชใช้ฐานกลางเท่านั้น');
  const sb = supabase.getSupabase();
  return createResearchStorage({ sb });
}

/**
 * เรียกจาก /api/queue/add หลัง enqueueJob (fire-and-forget) — สร้างใบขอเฉพาะเมื่อ RESEARCH_AGENT=1
 * คืน {created} หรือ null (ปิดสวิตช์/ข้อมูลไม่ครบ) · ฐานล้ม = โยน (ผู้เรียก .catch แล้วข้าม)
 */
export async function queueResearchRequestFromPayload({ jobId, payload, userId }, { env = process.env, loadStorage = loadResearchStorage } = {}) {
  if (!isResearchAgentOn(env)) return null;
  if (!RESEARCH_JOB_ID_RE.test(String(jobId || ''))) return null;
  const source = isPlainObject(payload) ? payload : {};
  const rawText = typeof source.input === 'string' ? source.input : (typeof source.text === 'string' ? source.text : '');
  if (!rawText.trim()) return null;
  const storage = await loadStorage();
  const { created } = await storage.createRequest({
    jobId,
    rawText,
    sourceUrls: source.sourceUrls,
    userId: typeof userId === 'string' ? userId : source.userId,
    channelId: source._channelId ?? source.channelId,
    sourceMessageId: source._msgId ?? source.sourceMessageId,
    deadlineMin: getResearchAgentDeadlineMin(env),
  });
  return { created };
}
