// ============================================================
// ⏳ src/lib/research-agent/queueHold.js — คิวชะลอหยิบงานข่าวจนรีเสิร์ชเสร็จ (research hold)
// ------------------------------------------------------------
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 9 · W3) — ไฟล์ใหม่ · ผู้คุมงานตัดสิน 1 ต.ค. 18:55
//   ปัญหาจากเทส: เอเจนต์ค้นคว้าใช้ 3.3–4.5 นาทีนับจากสร้างใบขอ แต่ท่อโหมด write รอได้จริง ~3 นาทีหลังสกัด
//     (กันชน RESEARCH_PIPELINE_RESERVE_MS 480s ในงบท่อ 700s) → คิวหยิบงานทันที (cron ทุก 1 นาที) = การ์ดมาไม่ทันเกือบทุกครั้ง
//   ทางแก้: ย้ายการรอออกนอกงบท่อ — ตัวหยิบงานคิว (getNextPendingJobs ใน src/lib/services/queueService.js) ข้ามงานข่าว
//     ที่ใบขอรีเสิร์ชยังไม่เสร็จ จนเสร็จหรือครบเวลา hold · ท่อจึงเริ่มเมื่อการ์ดพร้อม · การรอในท่อ (W1) คงไว้เป็นตาข่ายสำรอง
// เงื่อนไข hold (ทุกข้อต้องจริง · ตรวจไม่ได้/ผิดพลาด = ไม่ hold — fail-open):
//   RESEARCH_AGENT=1 + RESEARCH_AGENT_MODE=write + RESEARCH_AGENT_HOLD_MS > 0 · งานข่าว (ไม่ใช่ cover/mineclip)
//   · มีแถว research-requests rreq_<jobId> status queued|leased · อายุใบขอ (now − createdAt) < HOLD_MS
//   + ข้อเสริมให้ตรงกติกาการรอของท่อเอง (readCards.readWriteOutcome = จบการรอทันที): ใบขอเลย deadlineAt = ไม่ hold (expired)
//     · ใบขอ queued แต่ไม่มีชีพจร worker ≤ RESEARCH_AGENT_OFFLINE_AFTER_MS (10 นาที) = ไม่ hold (offline — worker ดับต้อง
//     ไม่ทำให้ข่าวทุกชิ้นช้า 6 นาที · เจ้าของ#4)
//   ใบขอ done/failed/expired · ไม่มีแถว · แถวผิดรูป · อายุเกิน hold = หยิบตามปกติ (ท่อได้การ์ดทันทีหรือเขียนจากต้นฉบับ)
// ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5) — ข้อเสริม 2 ข้อ (ไม่ hold · fail-open):
//   · ใบขอ leased แต่ชีพจรขาด > 150 วิ (now − (heartbeatAt ?? leasedAt) · modes.isResearchLeaseStale) = worker ตายกลางงาน
//     (เดิม hold เต็ม HOLD_MS 6 นาที เพราะ store ไม่ lease ซ้ำ)
//   · งานที่ input ไม่เข้าสายข้อความ — ตัวตรวจเดียวกับท่อ (input-engine/detector.detectInputType · /api/auto/process แยกสาย):
//     มีลิงก์ (รวม URL ล้วน = ลิงก์ + ข้อความอื่น ≤ 20 ตัวอักษร) หรือมีรูป = สาย URL/รูป ซึ่งโหมด write ไม่ใช้ฉบับเสริม → ชะลอไปก็เปล่า
// เวลาอ่านรวมต่อรอบ ≤ 3 วิ (เกิน = ไม่ hold ทั้งรอบ) · ไม่ import store เมื่อสวิตช์ปิด/โหมดอื่น (dynamic import เฉพาะตอนต้องอ่าน)
// ไม่แก้ลำดับ: คืนรายการเดิมที่กรองงาน hold ออก (ไม่ sort ใหม่) — ผู้เรียก slice เติมสล็อกจากงานที่เหลือ (งานถัดไปไม่ถูกบล็อก)
// นาฬิกา/timer/ที่เก็บ/ตัว log ฉีดได้ทั้งหมด (tests/research-queue-hold.test.mjs) · timer ไม่ unref (ผู้เรียกรออยู่จริง · clear ทุกทาง)
// ผู้เรียก: queueService.getNextPendingJobs → applyResearchHold · /api/queue/status → getResearchHoldInfo (ช่อง researchHold ให้บอท)
// ============================================================

import {
  getResearchAgentMode,
  getResearchAgentWaitMs,
  isResearchAgentOn,
  isResearchLeaseStale, // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): ใบขอ leased ที่ชีพจรขาด = ไม่ hold
  RESEARCH_AGENT_OFFLINE_AFTER_MS,
} from '@/lib/research-agent/modes';
// ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): ตัวแยกชนิด input ตัวเดียวกับ /api/auto/process (ไฟล์ pure ไม่มี import)
import { detectInputType } from '@/lib/input-engine/detector';

/** ค่าเริ่มต้นของ hold = WAIT_MS ของโหมด write + ค่านี้ (ไม่ตั้ง WAIT_MS = 300000 + 60000 = 360000) */
export const RESEARCH_HOLD_EXTRA_MS = 60_000;
/** เพดาน RESEARCH_AGENT_HOLD_MS (ตั้งเกิน = บีบลงมาที่ค่านี้) */
export const RESEARCH_HOLD_MAX_MS = 600_000;
/** เวลาอ่านใบขอรวมต่อรอบ (รวมโหลดที่เก็บ) — เกิน = ไม่ hold รอบนั้น (ผู้เรียกส่งค่าที่สั้นกว่าได้ ยาวกว่าไม่ได้) */
export const RESEARCH_HOLD_READ_TIMEOUT_MS = 3_000;
/** ตรวจงานต่อรอบไม่เกินนี้ (เก่าสุดก่อน) — งานที่เกินเพดาน = ไม่ hold (fail-open · ทุก process ต้องมี limit) */
export const RESEARCH_HOLD_SCAN_LIMIT = 20;
/** createdAt ล้ำหน้านาฬิกาเครื่องนี้ไม่เกินนี้ = นาฬิกาคลาด (นับอายุ 0) · เกิน = แถวผิดรูป (กัน hold ค้างจากเวลาเพี้ยน) */
export const RESEARCH_HOLD_CLOCK_SKEW_MS = 60_000;
/** = RESEARCH_JOB_ID_RE ของ store.js (คัดลอก เพราะห้าม import store ก่อนรู้ว่าต้องอ่าน — เทสเทียบว่าตรงกัน) */
export const RESEARCH_HOLD_JOB_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

const HOLD_REQUEST_STATUSES = new Set(['queued', 'leased']);
const HOLD_LOG_LIST_MAX = 5;
const READ_TIMED_OUT = Symbol('research-hold-read-timeout');

// timer จริงของ production — ไม่ unref: ผู้เรียก (ตัวหยิบงาน/route) รอผลอยู่จริง และ clear ทุกทางใน within()
const defaultTimers = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer),
};
const defaultLog = (line) => console.log(line);

/** = cleanEnv ของ modes.js (ตัด space + เครื่องหมายคำพูดหัวท้ายที่ติดมาจากการวางค่าใน Vercel) */
const cleanEnv = (raw) => String(raw ?? '').trim().replace(/^["']|["']$/g, '').trim();

/**
 * เพดานเวลาที่คิวยอมชะลอหยิบงานรอรีเสิร์ช (ms) = RESEARCH_AGENT_HOLD_MS
 * ไม่ตั้ง/อ่านไม่ได้ = WAIT_MS ของโหมด write + 60000 (= 360000) · บีบเข้า 0–600000 · 0 = ปิด hold
 * (ฟังก์ชันนี้ไม่ดูสวิตช์หลัก/โหมด — ใช้ isResearchHoldOn หรือ filterResearchHeld ซึ่งเช็คครบ)
 */
export function getResearchHoldMs(env = process.env) {
  const fallback = Math.min(RESEARCH_HOLD_MAX_MS, getResearchAgentWaitMs(env, 'write') + RESEARCH_HOLD_EXTRA_MS);
  const raw = cleanEnv(env?.RESEARCH_AGENT_HOLD_MS);
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(RESEARCH_HOLD_MAX_MS, Math.max(0, Math.round(n)));
}

/** hold ทำงานไหม: RESEARCH_AGENT=1 + โหมด write + HOLD_MS > 0 (ไม่แตะที่เก็บ) */
export function isResearchHoldOn(env = process.env) {
  return isResearchAgentOn(env) && getResearchAgentMode(env) === 'write' && getResearchHoldMs(env) > 0;
}

/**
 * ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): งานนี้จะวิ่ง "สายข้อความ" ไหม — โหมด write ใช้ฉบับเสริมเฉพาะสายข้อความ
 * ตัวตรวจเดียวกับ /api/auto/process: detectInputType(input, images) โดย input = payload.input ?? url ?? text (ลำดับเดียวกับ route)
 * สายข้อความ (processAutoFlowText) ต้องไม่มีลิงก์และไม่มีรูป (router.useEnhancedPipeline ของ text_pipeline: urls.length === 0 && !hasImage)
 * → มีลิงก์ (รวม "URL ล้วน" = ลิงก์ + ข้อความอื่น ≤ 20 ตัวอักษร) หรือมีรูป = false · ไม่มี payload/input ว่าง = true (กติกาเดิม)
 * · ตรวจพัง = false (ไม่ hold = fail-open)
 */
export function isTextPathInput(payload) {
  try {
    const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const raw = p.input ?? p.url ?? p.text ?? '';
    const detection = detectInputType(typeof raw === 'string' ? raw : String(raw), Array.isArray(p.images) ? p.images : []);
    return !detection.hasUrls && !detection.hasImage;
  } catch {
    return false;
  }
}

/** งานที่ตรวจ hold ได้: งานข่าว (ไม่ใช่ cover/mineclip — กติกาเดียวกับ isNewsJob ของ queueService) + jobId รูปแบบใบขอ */
function isHoldCandidate(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return false;
  const type = job.payload?.jobType;
  if (type === 'cover' || type === 'mineclip') return false;
  if (!isTextPathInput(job.payload)) return false; // ★ 1 ต.ค. 69 (W5): สาย URL/รูป ไม่ใช้ฉบับเสริม = ไม่ชะลอ (หยิบตามปกติ)
  return RESEARCH_HOLD_JOB_ID_RE.test(String(job.id ?? ''));
}

/** รอ promise ไม่เกิน ms (timer ถูก clear ทุกทาง) · หมดเวลา = คืน fallback · promise ล้ม = โยนต่อ (ผู้เรียก catch) */
function within(promise, ms, timers, fallback) {
  let timer = null;
  const timeout = new Promise((resolve) => { timer = timers.setTimer(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => { if (timer !== null) timers.clearTimer(timer); });
}

/** log หนึ่งบรรทัด (ฟังก์ชัน หรือ object ที่มี .log) · log ล้ม/ไม่มี = เงียบ (ไม่กระทบคิว) */
function emit(log, line) {
  try {
    if (typeof log === 'function') log(line);
    else if (log && typeof log.log === 'function') log.log(line);
  } catch { /* log ล้มไม่กระทบคิว */ }
}

const secs = (ms) => Math.round(ms / 1000);

/** บรรทัดเดียวต่อรอบ: [QueueService] ⏳ hold <jobId8> รอรีเสิร์ช (อายุ xs/ys) · งานอื่นที่ hold ต่อท้าย (≤5 + จำนวนที่เหลือ) */
function holdLine(held, holdMs) {
  const [first, ...rest] = held;
  const listed = rest.slice(0, HOLD_LOG_LIST_MAX - 1).map((h) => ` · ${h.jobId.slice(0, 8)} (อายุ ${secs(h.ageMs)}s/${secs(holdMs)}s)`).join('');
  const more = rest.length > HOLD_LOG_LIST_MAX - 1 ? ` · +${rest.length - (HOLD_LOG_LIST_MAX - 1)} งาน` : '';
  return `[QueueService] ⏳ hold ${first.jobId.slice(0, 8)} รอรีเสิร์ช (อายุ ${secs(first.ageMs)}s/${secs(holdMs)}s)${listed}${more}`;
}

/**
 * อ่านใบขอของงานที่ตรวจ (ขนาน · ใบที่อ่านล้ม = null = ไม่ hold งานนั้น) + ชีพจร worker (เฉพาะเมื่อมีใบ queued)
 * @returns {Promise<null | { rows: Map<string, object|null>, workerSeen: number[] | null }>} null = ใช้ที่เก็บไม่ได้
 */
async function readHoldRows(jobIds, loadStorage) {
  const load = typeof loadStorage === 'function'
    ? loadStorage
    : async () => (await import('@/lib/research-agent/store')).loadResearchStorage();
  const storage = await load();
  if (!storage || typeof storage.getRequest !== 'function') return null;
  const entries = await Promise.all(jobIds.map(async (jobId) => {
    try {
      return [jobId, await storage.getRequest(jobId)];
    } catch {
      return [jobId, null];
    }
  }));
  const rows = new Map(entries);
  let workerSeen = null; // null = ไม่ได้อ่าน/อ่านไม่ได้ → ใบ queued ไม่ hold (fail-open)
  if ([...rows.values()].some((row) => row?.status === 'queued') && typeof storage.listWorkers === 'function') {
    try {
      const workers = await storage.listWorkers({ limit: 5 });
      workerSeen = (Array.isArray(workers) ? workers : []).map((w) => Date.parse(w?.lastSeenAt || '')).filter(Number.isFinite);
    } catch {
      workerSeen = null;
    }
  }
  return { rows, workerSeen };
}

/** อายุใบขอ (ms) เมื่องานนี้ต้อง hold · ไม่ต้อง hold = null */
function heldAgeMs(row, nowMs, holdMs, workerSeen, offlineAfterMs) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null; // ไม่มีแถว/แถวผิดรูป
  if (!HOLD_REQUEST_STATUSES.has(row.status)) return null; // done/failed/expired/ค่าแปลก = รีเสิร์ชจบแล้ว
  const createdMs = Date.parse(typeof row.createdAt === 'string' ? row.createdAt : '');
  if (!Number.isFinite(createdMs)) return null; // แถวผิดรูป
  const rawAge = nowMs - createdMs;
  if (rawAge < -RESEARCH_HOLD_CLOCK_SKEW_MS) return null; // createdAt ล้ำอนาคตเกินนาฬิกาคลาด = ผิดรูป (กัน hold ไม่รู้จบ)
  const ageMs = Math.max(0, rawAge);
  if (ageMs >= holdMs) return null; // ครบเวลา hold แล้ว
  const deadlineMs = Date.parse(typeof row.deadlineAt === 'string' ? row.deadlineAt : '');
  if (Number.isFinite(deadlineMs) && deadlineMs <= nowMs) return null; // เลยเส้นตายใบขอ = expired (ท่อก็เลิกรอ)
  // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): leased แต่ชีพจรขาด > 150 วิ = worker ตายกลางงาน → ไม่ hold (ท่อก็เลิกรอ)
  if (isResearchLeaseStale(row, nowMs)) return null;
  if (row.status === 'queued') {
    if (!Array.isArray(workerSeen)) return null; // อ่านชีพจร worker ไม่ได้ = ไม่ hold
    if (!workerSeen.some((t) => nowMs - t <= offlineAfterMs)) return null; // worker ออฟไลน์ = ไม่มีใครค้น (ท่อก็ไม่รอ)
  }
  return Math.round(ageMs);
}

/**
 * แยกงานที่ต้องชะลอ (hold) ออกจากรายการงานรอคิว — ลำดับงานที่เหลือคงเดิม (กรองอย่างเดียว ไม่ sort ใหม่)
 * @param {object[]} jobs  งาน pending (เรียงแล้ว) จาก job_queue
 * @param {{ env?: object, now?: (() => number) | number, loadStorage?: () => Promise<object>,
 *   log?: ((line: string) => void) | { log: Function } | null, timeoutMs?: number,
 *   timers?: { setTimer: Function, clearTimer: Function }, offlineAfterMs?: number }} [options]
 *   loadStorage ไม่ส่ง = dynamic import store.js → loadResearchStorage() (เฉพาะเมื่อสวิตช์เปิด + โหมด write + มีงานให้ตรวจ)
 * @returns {Promise<{ ready: object[], held: Array<{ jobId: string, ageMs: number }>, holdMs: number, reason?: string }>}
 *   ไม่โยนเสมอ · ปิดสวิตช์/โหมดอื่น/HOLD_MS=0/ผิดพลาด/ช้าเกิน = ready คือรายการเดิม (ตัวเดียวกัน) held ว่าง + reason
 */
export async function filterResearchHeld(jobs, {
  env = process.env,
  now = Date.now,
  loadStorage = null,
  log = defaultLog,
  timeoutMs = RESEARCH_HOLD_READ_TIMEOUT_MS,
  timers = defaultTimers,
  offlineAfterMs = RESEARCH_AGENT_OFFLINE_AFTER_MS,
} = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  let holdMs = 0;
  try {
    holdMs = isResearchAgentOn(env) && getResearchAgentMode(env) === 'write' ? getResearchHoldMs(env) : 0;
  } catch {
    holdMs = 0;
  }
  const pass = (reason) => ({ ready: list, held: [], holdMs, reason });
  if (holdMs <= 0) return pass('off'); // ปิดสวิตช์/โหมดอื่น/HOLD_MS=0 — ไม่ import ไม่อ่านอะไร
  try {
    const candidates = list.filter(isHoldCandidate).slice(0, RESEARCH_HOLD_SCAN_LIMIT);
    if (candidates.length === 0) return pass('no_candidates');
    const limitMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(timeoutMs, RESEARCH_HOLD_READ_TIMEOUT_MS)
      : RESEARCH_HOLD_READ_TIMEOUT_MS;
    const read = await within(
      Promise.resolve().then(() => readHoldRows(candidates.map((job) => String(job.id)), loadStorage)),
      limitMs,
      timers,
      READ_TIMED_OUT,
    ).catch(() => null);
    if (read === READ_TIMED_OUT) {
      emit(log, `[QueueService] ⚠️ research hold: อ่านใบขอเกิน ${limitMs}ms — ไม่ชะลองานรอบนี้ (fail-open)`);
      return pass('timeout');
    }
    if (!read || !(read.rows instanceof Map)) {
      emit(log, '[QueueService] ⚠️ research hold: อ่านใบขอไม่ได้ — ไม่ชะลองานรอบนี้ (fail-open)');
      return pass('unavailable');
    }
    const nowMs = Number(typeof now === 'function' ? now() : now);
    if (!Number.isFinite(nowMs)) return pass('bad_clock');
    const heldJobs = new Set();
    const held = [];
    for (const job of candidates) {
      const ageMs = heldAgeMs(read.rows.get(String(job.id)), nowMs, holdMs, read.workerSeen, offlineAfterMs);
      if (ageMs === null) continue;
      heldJobs.add(job);
      held.push({ jobId: String(job.id), ageMs });
    }
    if (held.length === 0) return { ready: list, held: [], holdMs };
    emit(log, holdLine(held, holdMs));
    return { ready: list.filter((job) => !heldJobs.has(job)), held, holdMs };
  } catch {
    return pass('error');
  }
}

/**
 * ตัวหยิบงานคิว (getNextPendingJobs) เรียก — คืนรายการงานที่หยิบได้ (ลำดับเดิม · งาน hold ถูกกรองออก)
 * ไม่โยนเสมอ: ผิดพลาดทุกแบบ = รายการเดิม (หยิบตามปกติ)
 */
export async function applyResearchHold(jobs, options = {}) {
  const fallback = Array.isArray(jobs) ? jobs : [];
  try {
    const { ready } = await filterResearchHeld(jobs, options);
    return Array.isArray(ready) ? ready : fallback;
  } catch {
    return fallback;
  }
}

/**
 * /api/queue/status เรียก — งาน pending นี้ถูกชะลอรอรีเสิร์ชอยู่ไหม → { heldMs, maxMs } | null
 * heldMs = อายุใบขอ (เวลาที่ค้นมาแล้ว) · maxMs = เพดาน hold · ไม่ log (บอท poll ทุก 3 วิ) · ไม่โยนเสมอ (ผิดพลาด = null = คำตอบเดิม)
 */
export async function getResearchHoldInfo(job, options = {}) {
  try {
    if (!job || typeof job !== 'object' || job.status !== 'pending') return null;
    const { held, holdMs } = await filterResearchHeld([job], { log: null, ...options });
    const hit = Array.isArray(held) ? held.find((h) => h.jobId === String(job.id)) : null;
    return hit ? { heldMs: hit.ageMs, maxMs: holdMs } : null;
  } catch {
    return null;
  }
}
