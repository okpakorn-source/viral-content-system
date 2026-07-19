/**
 * =====================================================
 * 🧾 Research Trace — สมุดบันทึกย้อนหลังของ Research Engine (โต๊ะข่าวกลาง v2, 17 ก.ค. 69 — อ้างแบบ trace-design)
 * =====================================================
 * เป้าหมาย: ทุกเหตุการณ์ในชีวิตข่าว 1 ใบต้องย้อนดูได้ + ทุกรอบล่ามีสมุดบันทึก
 *   (1) logRun/listRuns/getRun — สมุดบันทึกรายรอบล่า ('เจอกี่ใบ/เก็บกี่ใบ/ตัดทิ้งเพราะอะไร/ต้นทุน')
 *       เก็บลง STORE_RUNS = 'research-hunt-runs' (คนละ store กับ dna-research-runs ของ dnaLibrary.js)
 *   (2) appendLeadEvents — timeline ต่อท้ายลีด 1 ใบ (found→judged→extracted→sent→written→status)
 *       เขียนตรงลง field `timeline` ของ record ใน store 'research-leads' (import จาก researchLeads.js เฉพาะชื่อ STORE)
 *   (3) getJobInfo — สะพาน "อ่านอย่างเดียว" ไป /api/queue/status ให้ UI เห็นผลเจนของ jobId ที่ผูกกับลีดที่ส่งแล้ว
 *
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * 🔴 ห้ามใช้ persistStore.update() — ใช้แพตเทิร์น remove(id) แล้ว add(ฉบับใหม่) แทนเสมอ (ตาม researchLeads.js/dnaLibrary.js)
 * 🔴 ห้ามแตะ researchLeads.js / dnaContract.js / api/queue/** — ไฟล์นี้ import ชื่อ STORE เดียว + อ่าน /api/queue/status เท่านั้น
 * 🔴 ทุกจุดเรียกจากภายนอกต้องเป็น fire-and-forget (.catch(()=>{})) — trace พังห้ามทำให้โฟลว์หลัก (ล่า/สกัด/ส่งคิว) ล้ม
 */

import { createStore } from '../../persistStore.js';
import { sanitizeText } from './dnaContract.js';
import { STORE as LEADS_STORE } from './researchLeads.js';
import { getDiscoveryConfig } from './researchDiscoveryConfig.js';
import { computeDiscoveryMetrics, provisionalStoryKey } from './researchDiscoveryMetrics.js';

export const STORE_RUNS = 'research-hunt-runs';

const MAX_RUNS = 100;          // เกินนี้ลบเก่าสุดทิ้ง (prune)
const MAX_JUDGE_LOG = 80;      // ต่อ 1 รอบล่า — เฉพาะรายการที่ถูกตัด/ไม่เก็บ
const MAX_QUERIES_USED = 300;  // กันคำค้นบวมเกินจริงถ้าเรียกผิดรูปแบบ
const MAX_SAVED_IDS = 300;
const MAX_SAMPLE = 400;        // ต่อ 1 รอบล่า — เพดานตัวอย่าง shadow ที่เอามาคำนวณเมตริก (กัน payload บวม)
const MAX_TIMELINE = 30;       // ต่อ 1 ลีด — เกินตัดหัว (เก่าสุดออกก่อน)
const EVENT_TYPES = new Set(['found', 'judged', 'extracted', 'sent', 'written', 'status']);

// ── sanitize ย่อยของ logRun ──────────────────────────────────
function _sanitizeParams(p) {
  const pp = p || {};
  return {
    clusterIds: (Array.isArray(pp.clusterIds) ? pp.clusterIds : []).map((x) => sanitizeText(x, 40)).filter(Boolean).slice(0, 30),
    channels: (Array.isArray(pp.channels) ? pp.channels : []).map((x) => sanitizeText(x, 20)).filter(Boolean).slice(0, 10),
    queriesPerCluster: Math.max(0, Number(pp.queriesPerCluster) || 0),
    model: sanitizeText(pp.model, 40),
  };
}

function _sanitizeQueryUsed(q) {
  if (!q || typeof q !== 'object') return null;
  return {
    clusterId: sanitizeText(q.clusterId, 40),
    archetype: sanitizeText(q.archetype, 80),
    query: sanitizeText(q.query, 100),
    channel: sanitizeText(q.channel, 20),
    found: Math.max(0, Number(q.found) || 0),
  };
}

function _sanitizeHuntStats(hs) {
  const h = hs || {};
  const out = {};
  for (const k of Object.keys(h).slice(0, 20)) {
    const v = h[k];
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : 0;
    else if (typeof v === 'string') out[k] = sanitizeText(v, 100);
    else if (typeof v === 'boolean') out[k] = v;
    // อื่นๆ (object ซ้อน/array/ฟังก์ชัน) → ข้าม กันโครงสร้างหลุด
  }
  return out;
}

function _sanitizeJudgeSummary(js) {
  const j = js || {};
  const num = (x) => Math.max(0, Number(x) || 0);
  return {
    judged: num(j.judged),
    kept: num(j.kept),
    dropGate: num(j.dropGate),
    dropDedup: num(j.dropDedup),
    dropSame: num(j.dropSame),
    lowScore: num(j.lowScore),
  };
}

function _sanitizeJudgeLogItem(j) {
  if (!j || typeof j !== 'object') return null;
  const item = {
    title: sanitizeText(j.title, 120),
    url: sanitizeText(j.url, 200),
    stage: sanitizeText(j.stage, 40),
    reason: sanitizeText(j.reason, 150),
  };
  if (j.score != null) item.score = Math.min(100, Math.max(0, Number(j.score) || 0));
  return item;
}

// ── 🆕 เฟส 0 (Discovery V2, โหมด shadow) — วัดผล 1 รอบล่าแบบเงียบ ยังไม่เปลี่ยน candidate ที่ผู้ใช้เห็น ──
// _sanitizeSampleItem — ทำความสะอาด 1 ตัวอย่างที่ UI ส่งมาวัด → รูปที่ computeDiscoveryMetrics รับ
//   🔴 fingerprint แบบ object ต้องแปลงเป็น storyKey "ตรงนี้" (ฝั่งผู้เรียก) กัน "[object Object]" ตามสัญญาของ metrics
function _sanitizeSampleItem(it) {
  if (!it || typeof it !== 'object') return null;
  const urlKey = sanitizeText(it.urlKey || it.url, 200);
  let storyKey = sanitizeText(it.storyKey, 200);
  if (!storyKey && it.fingerprint && typeof it.fingerprint === 'object') {
    storyKey = provisionalStoryKey(it.fingerprint);
  }
  if (!urlKey && !storyKey) return null; // ไม่มีตัวชี้ตัวตนเลย → ข้าม (นับเป็นเรื่องแยกไม่ได้)
  const item = { urlKey, kept: !!it.kept };
  if (storyKey) item.storyKey = storyKey;
  const channel = sanitizeText(it.channel, 20);
  if (channel) item.channel = channel;
  const platformGroup = sanitizeText(it.platformGroup, 20);
  if (platformGroup) item.platformGroup = platformGroup;
  const category = sanitizeText(it.category, 40);
  if (category) item.category = category;
  const lane = sanitizeText(it.lane, 20);
  if (lane) item.lane = lane;
  return item;
}

// _priorStoryKeysFromLeads — เรื่องที่เพจเคยทำ (จากคลังลีดเดิม) เพื่อวัด "เรื่องใหม่จริง"
//   🔴 ตัด record ของ runId ปัจจุบันออก — กันนับลีดที่รอบนี้เพิ่งเซฟเป็น "ของเก่า" (noveltyRate จะต่ำหลอก)
async function _priorStoryKeysFromLeads(currentRunId) {
  const store = createStore(LEADS_STORE);
  const all = await store.getAll();
  const keys = [];
  for (const lead of Array.isArray(all) ? all : []) {
    if (!lead) continue;
    if (currentRunId && lead.runId === currentRunId) continue;
    const k = provisionalStoryKey(lead.fingerprint);
    if (k) keys.push(k);
  }
  return keys;
}

// _computeDiscoveryV2 — ประกอบเมตริกเงา 1 รอบ (คืน "เฉพาะผลรวม" — ไม่เก็บ sample ดิบลง store)
async function _computeDiscoveryV2(rawSample, currentRunId, sourceFailureCount) {
  const sample = (Array.isArray(rawSample) ? rawSample : [])
    .map(_sanitizeSampleItem)
    .filter(Boolean)
    .slice(0, MAX_SAMPLE);
  const priorStoryKeys = await _priorStoryKeysFromLeads(currentRunId);
  const { targets } = getDiscoveryConfig();
  return computeDiscoveryMetrics({ sample, priorStoryKeys, targets, sourceFailureCount, mode: 'shadow' });
}

/**
 * logRun — บันทึกสรุป 1 รอบล่า (เรียกตอนจบ startHunt ฝั่ง UI)
 * sanitize ทุก field ก่อนเก็บ + prune รอบเก่าสุดถ้าเกิน MAX_RUNS
 * @param {object} record - {runId, at?, trigger?, params, queriesUsed[], huntStats, judgeSummary, judgeLog[], savedLeadIds[], costTHB, tookMs, measurementSample?}
 *   measurementSample (optional) — ตัวอย่างจาก UI สำหรับโหมด shadow (เฟส 0). มีผลก็ต่อเมื่อ MASTER เปิด → เก็บผลลง field discoveryV2
 */
export async function logRun(record) {
  const r = record || {};
  const runId = sanitizeText(r.runId, 40);
  if (!runId) throw new Error('ต้องระบุ runId');

  const clean = {
    id: runId,
    runId,
    at: sanitizeText(r.at, 40) || new Date().toISOString(),
    trigger: sanitizeText(r.trigger, 20) || 'manual',
    params: _sanitizeParams(r.params),
    queriesUsed: (Array.isArray(r.queriesUsed) ? r.queriesUsed : []).map(_sanitizeQueryUsed).filter(Boolean).slice(0, MAX_QUERIES_USED),
    huntStats: _sanitizeHuntStats(r.huntStats),
    judgeSummary: _sanitizeJudgeSummary(r.judgeSummary),
    judgeLog: (Array.isArray(r.judgeLog) ? r.judgeLog : []).map(_sanitizeJudgeLogItem).filter(Boolean).slice(0, MAX_JUDGE_LOG),
    savedLeadIds: (Array.isArray(r.savedLeadIds) ? r.savedLeadIds : []).map((x) => sanitizeText(x, 60)).filter(Boolean).slice(0, MAX_SAVED_IDS),
    costTHB: Math.max(0, Number(r.costTHB) || 0),
    tookMs: Math.max(0, Number(r.tookMs) || 0),
  };

  // 🆕 เฟส 6: watchlist IDs ที่ค้นรอบนี้ (มีเฉพาะเมื่อเลนสัมภาษณ์เปิด) — ให้รอบหน้าเลือกคนค้นน้อยสุด
  const watchlistIds = (Array.isArray(r.watchlistIds) ? r.watchlistIds : []).map((x) => sanitizeText(x, 40)).filter(Boolean).slice(0, 30);
  if (watchlistIds.length) clean.watchlistIds = watchlistIds;

  // 🆕 เฟส 0 (Discovery V2) — โหมด shadow: ถ้า UI ส่ง measurementSample มา + MASTER เปิด → คำนวณเมตริกเก็บใน discoveryV2
  //   🔴 ปิด flag หรือไม่ส่ง sample = ไม่มี field นี้ → record เหมือนเดิมเป๊ะ (พฤติกรรมเดิมไม่เปลี่ยน)
  //   คำนวณล้มเหลวห้ามทำให้บันทึกรอบล่าพัง (โฟลว์หลักต้องรอด) — ครอบ try เงียบ
  const sample = Array.isArray(r.measurementSample) ? r.measurementSample : [];
  if (sample.length > 0 && getDiscoveryConfig().masterOn) {
    try {
      clean.discoveryV2 = await _computeDiscoveryV2(sample, runId, clean.huntStats?.failedCalls);
    } catch {
      // เมตริกเงาล้มเหลว — ข้าม (รอบล่านี้ยังบันทึกครบตามเดิม ไม่มี discoveryV2)
    }
  }

  const store = createStore(STORE_RUNS);
  await store.add(clean);

  try {
    await pruneRunsToCap(store, MAX_RUNS);
  } catch {
    // เก็บกวาดรอบเก่าล้มเหลว (ไม่ใช่เรื่องร้าย) — รอบนี้บันทึกสำเร็จแล้ว ไม่ต้องพังทั้งฟังก์ชัน
  }

  return clean;
}

/**
 * pruneRunsToCap — เกิน cap ตัว → ลบเก่าสุดออกทีละใบจนเหลือพอดี
 * แยก cap เป็น param (default MAX_RUNS) + export ไว้ให้เทส prune ตรงได้ด้วย cap เล็กๆ
 * โดยไม่ต้องยัด 100 แถวจริงลง store ก่อน (logRun เรียกผ่านนี้ด้วย cap จริงเสมอ)
 */
export async function pruneRunsToCap(store, cap = MAX_RUNS) {
  const all = await store.getAll();
  if (all.length <= cap) return;
  const sorted = all.slice().sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)); // เก่า → ใหม่
  const excess = sorted.length - cap;
  for (let i = 0; i < excess; i++) {
    // eslint-disable-next-line no-await-in-loop -- ลบทีละใบตามลำดับเก่าสุดก่อน ปริมาณน้อย (สูงสุดไม่กี่ใบต่อรอบ) ไม่คุ้มแลก Promise.all เสี่ยง race กับ prune รอบอื่น
    await store.remove(sorted[i].id);
  }
}

/**
 * listRuns — ประวัติรอบล่า เรียงใหม่→เก่า
 */
export async function listRuns(limit = 30) {
  const store = createStore(STORE_RUNS);
  const items = await store.getAll();
  const sorted = items.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30));
  return sorted.slice(0, safeLimit);
}

/**
 * getRun — รายละเอียดรอบล่า 1 รอบ (ครบ field ตามที่ logRun บันทึกไว้)
 */
export async function getRun(runId) {
  const store = createStore(STORE_RUNS);
  const items = await store.getAll();
  return items.find((r) => r.id === runId) || null;
}

// ── sanitize event ของ appendLeadEvents (data เป็น object ตื้นๆ ตามสัญญาแต่ละ type) ──
function _sanitizeEventData(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  const keys = Object.keys(data).slice(0, 20);
  for (const k of keys) {
    const v = data[k];
    if (v == null) continue;
    if (typeof v === 'string') {
      out[k] = sanitizeText(v, 200);
    } else if (typeof v === 'number') {
      out[k] = Number.isFinite(v) ? v : 0;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 10)
        .map((x) => (typeof x === 'string' ? sanitizeText(x, 150) : x))
        .filter((x) => x !== '' && x != null);
    }
    // object ซ้อน/ฟังก์ชัน → ข้าม (event data ต้องตื้น กันโครงสร้างหลุด/ข้อมูลบวม)
  }
  return out;
}

function _sanitizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const type = EVENT_TYPES.has(e.type) ? e.type : null;
  if (!type) return null;
  return {
    at: sanitizeText(e.at, 40) || new Date().toISOString(),
    type,
    data: _sanitizeEventData(e.data),
  };
}

/**
 * appendLeadEvents — ต่อ timeline เข้าลีด 1 ใบ (remove-แล้ว-add เหมือน researchLeads.js/researchExtract.js)
 *   ลำดับเก่า→ใหม่ · cap MAX_TIMELINE (เกินตัดหัว/เก่าสุดออกก่อน) · field อื่นของลีดคงเดิมครบ
 * @param {string} leadId
 * @param {Array<{type:string, at?:string, data?:object}>} events
 */
export async function appendLeadEvents(leadId, events) {
  const store = createStore(LEADS_STORE);
  const all = await store.getAll();
  const existing = all.find((r) => r.id === leadId);
  if (!existing) {
    throw new Error(`ไม่พบลีด: ${leadId}`);
  }

  const cleanEvents = (Array.isArray(events) ? events : []).map(_sanitizeEvent).filter(Boolean);
  if (cleanEvents.length === 0) return existing;

  const timeline = (Array.isArray(existing.timeline) ? existing.timeline.slice() : []).concat(cleanEvents);
  const capped = timeline.length > MAX_TIMELINE ? timeline.slice(timeline.length - MAX_TIMELINE) : timeline;

  const merged = { ...existing, timeline: capped };
  await store.remove(leadId);
  await store.add(merged);
  return merged;
}

/**
 * getJobInfo — อ่านอย่างเดียว: เช็คสถานะงานเขียนที่ผูกกับ jobId ผ่าน /api/queue/status (ไม่เขียนอะไรฝั่งคิว)
 *   shape จริงที่อ่านเจอจาก GET /api/queue/status?id=xxx (ดู src/app/api/queue/status/route.js):
 *     {success, jobId, status:'pending'|'processing'|'completed'|'failed', position, queuesAhead,
 *      result, error, startedAt, completedAt}
 *   `result` = สิ่งที่ /api/auto/process คืนตอนจบงาน — versions อยู่ที่ path ใดก็ได้ต่อไปนี้ (ไม่คงที่ตาม pipeline):
 *     result.analysisResult.versions | result.data.analysisResult.versions | result.versions
 *   ★ caseId: จากการอ่านโค้ดจริง (/api/auto/process, generationLogger.js, queueService.js) งานข่าวที่ไปทาง
 *     research-desk "ไม่มี" caseId ผูกกับ jobId เลย — logGeneration() สร้าง caseId เองแยกต่างหาก ไม่เคยเขียนกลับ
 *     เข้า job record ที่ queueService เก็บ ดังนั้น caseId ด้านล่างเป็นความพยายาม best-effort อ่านถ้ามี (ปกติจะ
 *     undefined เสมอสำหรับลีดจาก research-desk — ผู้ตรวจควรทราบจุดนี้ก่อนอนุมัติ UI ที่พึ่งพา caseId)
 * @returns {Promise<{success:true, status:string, versionsCount:number, versions?:string[], caseId?:string} | {success:false, error:string}>}
 */
export async function getJobInfo(jobId, origin) {
  const id = sanitizeText(jobId, 80);
  if (!id) return { success: false, error: 'ต้องระบุ jobId' };
  if (!origin) return { success: false, error: 'ขาด origin สำหรับเช็คสถานะงาน' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res;
  try {
    res = await fetch(`${origin}/api/queue/status?id=${encodeURIComponent(id)}`, { signal: controller.signal });
  } catch (e) {
    return { success: false, error: `เช็คสถานะงานไม่สำเร็จ: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { success: false, error: `อ่านผลลัพธ์สถานะงานไม่ได้ (status ${res.status})` };
  }

  if (!body || body.success !== true) {
    return { success: false, error: (body && body.error) || `เช็คสถานะงานไม่สำเร็จ (status ${res.status})` };
  }

  const result = body.result || {};
  const versionsRaw = result.analysisResult?.versions || result.data?.analysisResult?.versions || result.versions || [];
  const versions = versionsRaw
    .slice(0, 3)
    .map((v) => sanitizeText(v?.title || v?.style || '', 120))
    .filter(Boolean);
  const caseId = sanitizeText(result.caseId || result.data?.caseId || '', 20) || undefined;

  return {
    success: true,
    status: sanitizeText(body.status, 20) || null,
    versionsCount: versionsRaw.length,
    versions: versions.length ? versions : undefined,
    caseId,
  };
}
