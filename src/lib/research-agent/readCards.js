// ============================================================
// ⏱️ src/lib/research-agent/readCards.js — ท่อข่าวอ่านบัตรของเอเจนต์ค้นคว้า (เลน B · 1 ต.ค. 69 · SPEC-v2 ส่วน 3/9/10)
// ------------------------------------------------------------
// เรียกจากช่อง PRE-GENERATE ของ src/lib/services/autoFlowServiceText.js (dynamic import เฉพาะเมื่อตั้ง RESEARCH_AGENT)
//   startResearchAgentPoll() เริ่ม poll ขนานกับ Blueprint/SmartResearch ทันที → settle() หลัง Blueprint จบ
//   · poll ทุก 5 วิ (อ่าน research-cards[jobId] · ไม่มีการ์ดค่อยอ่าน research-requests[jobId]) · อ่านแต่ละครั้งมีเพดานสั้นของตัวเอง
//   · ห้ามใช้ withTimeoutSignal / assertCanStart (จะจองงบเส้นตายรวมจนกิน generate_A ขั้นต่ำ 90s — scout pipeline.hooks)
//   · ช่วงที่ท่อ "ยอมรอ" = นับจากเริ่ม PRE-GENERATE ไม่เกิน RESEARCH_AGENT_WAIT_MS (shadow = 0 = ไม่รอเกิน Blueprint เลย)
//     และต้องเหลือเส้นตายรวม ≥ RESERVE_MS (480s = generate_A 420s + ด่านหลังเขียน) หลังรอ → ไม่กินงบ generate (ข้อ 4)
//   · fail-open ทุกทาง: ฐานล้ม/ช้า/ไม่มีใบขอ/worker ออฟไลน์/โมดูลพัง → คืนสรุปสถานะ ไม่โยน ไม่หยุดข่าว
//   · หยุด poll เสมอเมื่อ: ได้ผลสุดท้าย · settle จบ · เส้นตายรวม abort · ครบอายุสูงสุด (กัน loop ค้างถ้า settle ไม่ถูกเรียก)
// ผลที่ใช้ต่อ: run.analysis → analysisResult.researchAgent (shadow: {status,mode,cardsCount,flags} · assist/write: + cards/
//   raw_corrections/origin_post/stale_news_warning) · run.pipelineInfo → generation_logs.pipeline_info {researchAgent, jobId, workflowId}
//   · logPipeline step 'research-agent' (ไม่รอผล) · โหมด write ในเฟส 1 = แบบ assist (ไม่ส่งเข้านักเขียน/ด่าน — ข้อ 24)
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 3): + waitResearchCards() — โหมด write รอการ์ด "หลังขั้นสกัด"
//   (≤ maxWaitMs นับจากเริ่มท่อ · เลิกรอเมื่อเส้นตายรวมเหลือ < RESEARCH_PIPELINE_RESERVE_MS · นาฬิกา/timer ฉีดได้ · ไม่ unref)
//   ผลรูปเดียวกับ settle() (buildResearchAgentRun) + outcome · buildResearchAgentRun รับ editor/originalPreview (ไม่ส่ง = ผลเดิมทุกไบต์)
//   ช่อง PRE-GENERATE เดิม (startResearchAgentPoll) ไม่ถูกแก้ — โหมด write ข้ามช่องนั้นจากฝั่งท่อ (ใช้ผลรอบนี้ซ้ำ)
// ============================================================

import { capText, summarizeCardsDoc } from '@/lib/research-agent/cardsSchema'; // ★ 1 ต.ค. 69 (โหมด write · SPEC-v3): + capText (ของเดิม: import เฉพาะ summarizeCardsDoc)
import {
  getResearchAgentMode,
  getResearchAgentWaitMs,
  isResearchAgentOn,
  isResearchLeaseStale, // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): readWriteOutcome — ใบขอ leased ที่ชีพจรขาด = offline
  RESEARCH_AGENT_OFFLINE_AFTER_MS,
} from '@/lib/research-agent/modes';
// ★ 1 ต.ค. 69 (โหมด write · SPEC-v3): + RESEARCH_JOB_ID_RE (waitResearchCards รับ jobId ตรง) · ของเดิม: import 2 ตัวแรก
import { jobIdFromWorkflowId, loadResearchStorage, RESEARCH_JOB_ID_RE } from '@/lib/research-agent/store';

export const RESEARCH_POLL_MS = 5_000;
export const RESEARCH_READ_TIMEOUT_MS = 4_000;
export const RESEARCH_SETTLE_GRACE_MS = 1_500;
/** เส้นตายรวมที่ต้องเหลือหลังรอการ์ด (generate_A เพดาน 420s + ด่านหลังเขียนเริ่มได้) */
export const RESEARCH_PIPELINE_RESERVE_MS = 480_000;
/** อายุสูงสุดของ loop poll หลังเริ่ม (เกิน WAIT_MS ไปแล้ว) — กันค้างถ้าท่อไม่เรียก settle (Blueprint เพดาน 120s + เผื่อ) */
export const RESEARCH_POLL_EXTRA_LIFETIME_MS = 150_000;

const FINAL_CARD_STATUSES = new Set(['done', 'failed', 'skipped']);

// timer จริงของ production · จังหวะพัก poll เบื้องหลัง (background) ไม่ค้ำ process (unref) — ส่วนที่ท่อ "รอ" อยู่ (หน้าต่าง/grace) ค้ำตามปกติ
const defaultTimers = {
  setTimer: (fn, ms, { background = false } = {}) => {
    const timer = setTimeout(fn, ms);
    if (background) timer?.unref?.();
    return timer;
  },
  clearTimer: (timer) => clearTimeout(timer),
};

async function defaultLogPipeline(entry) {
  const { logPipeline } = await import('@/lib/pipelineLogger');
  return logPipeline(entry);
}

/** รอ promise ไม่เกิน ms (timer ถูก clear ทุกทาง) · หมดเวลา = คืน fallback */
function within(promise, ms, timers, fallback) {
  let timer = null;
  const timeout = new Promise((resolve) => { timer = timers.setTimer(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => { if (timer !== null) timers.clearTimer(timer); });
}

const pipelineLogStatus = (status) => (status === 'done' ? 'success' : status === 'failed' ? 'failed'
  : (status === 'no_job' || status === 'no_request') ? 'info' : 'warning');

const compactBrain = (brain) => (brain && typeof brain === 'object'
  ? { kind: brain.kind ?? null, model: brain.model ?? null, effort: brain.effort ?? null }
  : null);

function pickAssistCards(doc) {
  return (Array.isArray(doc?.cards) ? doc.cards : [])
    .filter((card) => card && card.gate !== 'dropped')
    .map((card) => ({
      id: card.id,
      claim: card.claim,
      value_type: card.value_type,
      why_it_adds_value: card.why_it_adds_value,
      evidence_quote: card.evidence_quote,
      source_url: card.source_url,
      source_name: card.source_name,
      source_date: card.source_date,
      confidence: card.confidence,
      contradicts_raw: card.contradicts_raw === true,
      identity: card.identity,
      gate: card.gate,
      ...(card.gate_reason ? { gate_reason: card.gate_reason } : {}),
    }));
}

/**
 * ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): ระเบียนผลบรรณาธิการ → ฉบับย่อสำหรับ pipeline_info
 * {status, used, corrections, additions, ratio, waitedMs, editorMs} — used/corrections/additions = จำนวน (เนื้อเต็มอยู่ store research-editor)
 */
export function compactEditorSummary(editor) {
  const source = editor && typeof editor === 'object' ? editor : {};
  const count = (value) => (Array.isArray(value) ? value.length : 0);
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    status: typeof source.status === 'string' ? source.status : null,
    used: count(source.used_cards),
    corrections: count(source.corrections),
    additions: count(source.additions),
    ratio: num(source.ratio),
    waitedMs: num(source.waitedMs),
    editorMs: num(source.editorMs),
  };
}

/** สรุปผลรอบนี้ → { analysis, pipelineInfo, summary } (ไม่มีเนื้อการ์ดใน pipeline_info — เก็บใน research-cards แล้ว) */
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): + editor/originalPreview (ไม่ส่ง = null = ผลเดิมทุกไบต์)
//   ของเดิม: export function buildResearchAgentRun({ outcome, mode, jobId, workflowId, ms, waitedMs, polls }) {
export function buildResearchAgentRun({ outcome, mode, jobId, workflowId, ms, waitedMs, polls, editor = null, originalPreview = null }) {
  const doc = outcome?.card || null;
  const counts = doc ? summarizeCardsDoc(doc) : { cardsCount: 0, passCount: 0, staffOnlyCount: 0, flags: [] };
  const status = doc ? (counts.status || 'done') : (outcome?.status || 'pending');
  const summary = {
    status,
    mode,
    cardsCount: counts.cardsCount,
    passCount: counts.passCount,
    flags: counts.flags,
    requestStatus: outcome?.request?.status ?? null,
    revision: Number.isSafeInteger(doc?.revision) ? doc.revision : null,
    brain: compactBrain(doc?.brain),
    ms: Math.max(0, Math.round(ms || 0)),
    waitedMs: Math.max(0, Math.round(waitedMs || 0)),
    polls: polls || 0,
  };
  const analysis = { status, mode, cardsCount: counts.cardsCount, flags: counts.flags };
  if (mode !== 'shadow' && doc) {
    analysis.cards = pickAssistCards(doc);
    analysis.raw_corrections = Array.isArray(doc.raw_corrections) ? doc.raw_corrections : [];
    analysis.origin_post = doc.origin_post ?? null;
    analysis.stale_news_warning = doc.stale_news_warning ?? null;
  }
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.1): analysisResult.researchAgent.editor = ระเบียนเต็ม (บอทเลน W2 อ่าน)
  //   pipeline_info.researchAgent.editor = ฉบับย่อ · original_preview = ต้นฉบับเดิม ≤ 400 ตัวอักษร (เฉพาะเมื่อฉบับเสริมแทนต้นฉบับ)
  if (editor && typeof editor === 'object') {
    summary.editor = compactEditorSummary(editor);
    analysis.editor = editor;
  }
  if (typeof originalPreview === 'string' && originalPreview) analysis.original_preview = capText(originalPreview, 400);
  return {
    summary,
    analysis,
    pipelineInfo: { researchAgent: summary, jobId: jobId || null, workflowId: workflowId || null },
  };
}

/**
 * เริ่มอ่านการ์ดของงานนี้ขนานกับ Blueprint · ปิดสวิตช์ = null (ผู้เรียกไม่ทำอะไรเลย)
 * @returns {null | { jobId: string|null, mode: string, settle: () => Promise<ReturnType<typeof buildResearchAgentRun>> }}
 */
export function startResearchAgentPoll({
  workflowId,
  deadline = null,
  env = process.env,
  loadStorage = loadResearchStorage,
  now = Date.now,
  timers = defaultTimers,
  logPipeline = defaultLogPipeline,
  pollMs = RESEARCH_POLL_MS,
  readTimeoutMs = RESEARCH_READ_TIMEOUT_MS,
  settleGraceMs = RESEARCH_SETTLE_GRACE_MS,
  reserveMs = RESEARCH_PIPELINE_RESERVE_MS,
  extraLifetimeMs = RESEARCH_POLL_EXTRA_LIFETIME_MS,
  offlineAfterMs = RESEARCH_AGENT_OFFLINE_AFTER_MS,
} = {}) {
  if (!isResearchAgentOn(env)) return null;
  const mode = getResearchAgentMode(env);
  const waitMs = getResearchAgentWaitMs(env, mode);
  const jobId = jobIdFromWorkflowId(workflowId);
  const startedAt = now();

  let latest = null;          // ผลอ่านครั้งล่าสุดที่จบแล้ว
  let inflight = null;        // การอ่านที่กำลังวิ่ง
  let polls = 0;
  let errors = 0;
  let stopped = false;
  let sleepTimer = null;
  let wakeSleep = null;
  let workerOnline = null;    // null = ยังไม่รู้
  let resolveFinal;
  const finalSignal = new Promise((resolve) => { resolveFinal = resolve; });
  let readWaiters = [];       // settle (shadow) รอแค่ "อ่านรอบที่กำลังวิ่งจบ" ไม่รอรอบถัดไป
  const notifyRead = () => { const waiters = readWaiters; readWaiters = []; for (const wake of waiters) wake(); };
  const nextRead = () => new Promise((resolve) => { readWaiters.push(resolve); });

  const stop = () => {
    stopped = true;
    if (sleepTimer !== null) { timers.clearTimer(sleepTimer); sleepTimer = null; }
    if (wakeSleep) { const wake = wakeSleep; wakeSleep = null; wake(); }
  };
  const finish = (outcome) => {
    latest = outcome;
    stop();
    resolveFinal(outcome);
    notifyRead();
  };
  const abortHandler = () => finish(latest || { final: false, status: 'pending' });
  const deadlineSignal = deadline?.signal && typeof deadline.signal.addEventListener === 'function' ? deadline.signal : null;
  if (deadlineSignal) {
    if (deadlineSignal.aborted) abortHandler();
    else deadlineSignal.addEventListener('abort', abortHandler, { once: true });
  }

  const sleep = (ms) => new Promise((resolve) => {
    if (stopped) { resolve(); return; }
    wakeSleep = resolve;
    sleepTimer = timers.setTimer(() => { sleepTimer = null; wakeSleep = null; resolve(); }, ms, { background: true });
  });

  async function readOnce(storage) {
    const card = await storage.getCards(jobId);
    if (card && FINAL_CARD_STATUSES.has(card.status)) return { final: true, card };
    const request = await storage.getRequest(jobId);
    if (!request) return { final: true, status: 'no_request' };
    if (request.status === 'failed' || request.status === 'expired') return { final: true, status: request.status, request };
    if (request.status === 'done') {
      const late = await storage.getCards(jobId); // การ์ดเขียนก่อนปิดใบขอ — อ่านซ้ำหนึ่งครั้ง
      if (late && FINAL_CARD_STATUSES.has(late.status)) return { final: true, card: late, request };
    }
    if ((request.status === 'leased' || request.status === 'queued') && Date.parse(request.deadlineAt || '') <= now()) {
      return { final: true, status: 'expired', request }; // เลยกำหนดแล้ว (worker ไม่มารับ/ไม่ส่งผล) = เลิกรอ
    }
    if (request.status === 'queued' && workerOnline === null && typeof storage.listWorkers === 'function') {
      const workers = await storage.listWorkers({ limit: 5 });
      const seen = (Array.isArray(workers) ? workers : []).map((w) => Date.parse(w?.lastSeenAt || '')).filter(Number.isFinite);
      workerOnline = seen.some((t) => now() - t <= offlineAfterMs);
    }
    return { final: false, status: 'pending', request };
  }

  async function loop() {
    if (!jobId) { finish({ final: true, status: 'no_job' }); return; }
    let storage;
    try {
      storage = await within(loadStorage(), readTimeoutMs, timers, null);
    } catch {
      storage = null;
    }
    if (!storage) { finish({ final: true, status: 'unavailable' }); return; }
    const hardStopAt = startedAt + waitMs + extraLifetimeMs;
    while (!stopped) {
      inflight = within(readOnce(storage), readTimeoutMs, timers, { final: false, status: 'pending', timedOut: true })
        .catch(() => ({ final: false, status: 'pending', error: true }));
      // eslint-disable-next-line no-await-in-loop -- poll ทีละครั้งตามจังหวะ (ห้ามยิงซ้อน)
      const outcome = await inflight;
      inflight = null;
      polls += 1;
      if (stopped) return;
      if (outcome.error || outcome.timedOut) errors += 1;
      else errors = 0;
      if (outcome.final) { finish(outcome); return; }
      latest = { ...outcome, ...(latest?.request && !outcome.request ? { request: latest.request } : {}) };
      if (errors >= 3) { finish({ ...latest, final: true, status: 'error' }); return; }
      if (now() >= hardStopAt) { finish(latest); return; }
      notifyRead();
      // eslint-disable-next-line no-await-in-loop -- เว้นจังหวะ poll (timer ถูก clear เมื่อหยุด)
      await sleep(pollMs);
    }
  }

  const running = loop().catch(() => finish({ final: true, status: 'error' }));

  let settling = null;
  async function settleOnce() {
    const settleStartedAt = now();
    if (!latest?.final) {
      const remaining = typeof deadline?.remainingMs === 'function' ? Number(deadline.remainingMs()) : Number.POSITIVE_INFINITY;
      const budgetEnd = Number.isFinite(remaining) ? settleStartedAt + Math.max(0, remaining - reserveMs) : Number.POSITIVE_INFINITY;
      const windowEnd = Math.min(startedAt + waitMs, budgetEnd);
      const offline = latest?.request?.status === 'queued' && workerOnline === false;
      if (offline) {
        finish({ ...latest, final: true, status: 'offline' });
      } else if (windowEnd > settleStartedAt) {
        await within(finalSignal, windowEnd - settleStartedAt, timers, null);
      } else if (!stopped && (inflight || !latest)) {
        await within(nextRead(), settleGraceMs, timers, null); // shadow: รอแค่อ่านรอบที่กำลังวิ่ง (สูงสุด 1.5 วิ)
      }
    }
    const outcome = latest?.final ? latest : (latest || { final: false, status: 'pending' });
    stop();
    if (deadlineSignal) deadlineSignal.removeEventListener('abort', abortHandler);
    running.catch(() => {});
    const settledAt = now();
    const run = buildResearchAgentRun({
      outcome,
      mode,
      jobId,
      workflowId,
      ms: settledAt - startedAt,
      waitedMs: settledAt - settleStartedAt,
      polls,
    });
    try {
      Promise.resolve(logPipeline({
        workflowId,
        step: 'research-agent',
        status: pipelineLogStatus(run.summary.status),
        duration: run.summary.ms,
        detail: `${mode} · ${run.summary.status} · ${run.summary.cardsCount} การ์ด${run.summary.flags.length ? ` · ${run.summary.flags.join(',')}` : ''}`,
        metadata: {
          status: run.summary.status,
          mode,
          cards: run.summary.cardsCount,
          pass: run.summary.passCount,
          flags: run.summary.flags,
          ms: run.summary.ms,
          waitedMs: run.summary.waitedMs,
          brain: run.summary.brain,
        },
      })).catch(() => {});
    } catch { /* บันทึกล้มไม่กระทบข่าว */ }
    return run;
  }

  return {
    jobId,
    mode,
    settle() {
      if (!settling) {
        settling = settleOnce().catch(() => {
          stop(); // พังกลาง settle = หยุด poll เบื้องหลังด้วย แล้วคืนสรุป error (fail-open ไม่โยนเข้าท่อ)
          if (deadlineSignal) deadlineSignal.removeEventListener('abort', abortHandler);
          return buildResearchAgentRun({ outcome: { status: 'error' }, mode, jobId, workflowId, ms: 0, waitedMs: 0, polls });
        });
      }
      return settling;
    },
  };
}

// ============================================================
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 ส่วน 3.1) — รอการ์ดหลังขั้นสกัด (โหมด write)
// ============================================================

/**
 * อ่านสถานะการ์ด/ใบขอหนึ่งรอบ (กติกาเดียวกับ readOnce ของ startResearchAgentPoll — แยกเป็นฟังก์ชันของโหมด write
 * เพื่อไม่แตะ loop เดิมของ shadow/assist) · workerState.online: null = ยังไม่รู้ (เช็คชีพจรครั้งเดียวเมื่อใบขอยัง queued)
 */
async function readWriteOutcome(storage, jobId, { now, offlineAfterMs, workerState }) {
  const card = await storage.getCards(jobId);
  if (card && FINAL_CARD_STATUSES.has(card.status)) return { final: true, card };
  const request = await storage.getRequest(jobId);
  if (!request) return { final: true, status: 'no_request' };
  if (request.status === 'failed' || request.status === 'expired') return { final: true, status: request.status, request };
  if (request.status === 'done') {
    const late = await storage.getCards(jobId); // การ์ดเขียนก่อนปิดใบขอ — อ่านซ้ำหนึ่งครั้ง
    if (late && FINAL_CARD_STATUSES.has(late.status)) return { final: true, card: late, request };
  }
  if ((request.status === 'leased' || request.status === 'queued') && Date.parse(request.deadlineAt || '') <= now()) {
    return { final: true, status: 'expired', request };
  }
  // ★ 1 ต.ค. 69 (Research Agent v2 · ออดิตก่อน push · W5): leased แต่ชีพจรขาด > 150 วิ (heartbeatAt ?? leasedAt) = worker ตายกลางงาน
  //   → offline: ท่อเลิกรอทันที เขียนจากต้นฉบับ (fail-open · เดิมรอจนครบ WAIT_MS เพราะ store ไม่ lease ใบนั้นซ้ำ) · เฉพาะโหมด write
  if (isResearchLeaseStale(request, now())) return { final: true, status: 'offline', request };
  if (request.status === 'queued' && workerState.online === null && typeof storage.listWorkers === 'function') {
    const workers = await storage.listWorkers({ limit: 5 });
    const seen = (Array.isArray(workers) ? workers : []).map((w) => Date.parse(w?.lastSeenAt || '')).filter(Number.isFinite);
    workerState.online = seen.some((t) => now() - t <= offlineAfterMs);
  }
  return { final: false, status: 'pending', request, workerOnline: workerState.online };
}

/**
 * โหมด write: รอการ์ดของงานนี้หลังขั้นสกัด จน (1) ได้ผลสุดท้าย (การ์ด done/failed/skipped · ใบขอ failed/expired/ไม่มีใบขอ)
 *   (2) ครบ maxWaitMs นับจาก startedAt (= เวลาเริ่มท่อ — ข้อตัดสิน #1 "นับจากเริ่มท่อ") (3) เส้นตายรวมเหลือ < reserveMs
 *   (4) เส้นตายรวม abort (5) worker ออฟไลน์ (ใบขอยัง queued + ไม่มีชีพจร ≤ 10 นาที) (6) อ่านล้ม 3 ครั้งติด
 * ไม่ใช้ withTimeoutSignal/assertCanStart (ไม่จองงบเส้นตาย) · อ่านอย่างน้อย 1 รอบเสมอ (งบหมดแล้วแต่การ์ดมาแล้ว = ได้ใช้)
 * นาฬิกา/timer/ตัวอ่านฉีดได้ทั้งหมด · timer ไม่ unref (ท่อกำลังรออยู่จริง) · ปิดสวิตช์ = null · ไม่โยน (fail-open)
 * @param {{ workflowId?: string, jobId?: string, maxWaitMs?: number, startedAt?: number, deadline?: object|null, env?: object,
 *   pollMs?: number, readTimeoutMs?: number, reserveMs?: number, offlineAfterMs?: number, now?: () => number,
 *   timers?: {setTimer: Function, clearTimer: Function}, read?: (jobId: string) => Promise<object>,
 *   loadStorage?: () => Promise<object>, logPipeline?: (entry: object) => any }} [options]
 *   read = ตัวอ่านหนึ่งรอบ คืน {final, status, card?, request?, workerOnline?} (ไม่ส่ง = อ่านจาก store ผ่าน loadStorage)
 * @returns {Promise<null | (ReturnType<typeof buildResearchAgentRun> & { outcome: object })>}
 */
export async function waitResearchCards({
  workflowId = null,
  jobId: jobIdInput = null,
  maxWaitMs,
  startedAt,
  deadline = null,
  env = process.env,
  pollMs = RESEARCH_POLL_MS,
  readTimeoutMs = RESEARCH_READ_TIMEOUT_MS,
  reserveMs = RESEARCH_PIPELINE_RESERVE_MS,
  offlineAfterMs = RESEARCH_AGENT_OFFLINE_AFTER_MS,
  now = Date.now,
  timers = defaultTimers,
  read = null,
  loadStorage = loadResearchStorage,
  logPipeline = defaultLogPipeline,
} = {}) {
  if (!isResearchAgentOn(env)) return null; // ปิดสวิตช์ = ไม่แตะฐาน ไม่รอ (แบบเดียวกับ startResearchAgentPoll)
  const mode = getResearchAgentMode(env);
  const waitMs = Number.isFinite(maxWaitMs) ? Math.max(0, maxWaitMs) : getResearchAgentWaitMs(env, mode);
  const jobId = typeof jobIdInput === 'string' && RESEARCH_JOB_ID_RE.test(jobIdInput) ? jobIdInput : jobIdFromWorkflowId(workflowId);
  const begin = now();
  const origin = Number.isFinite(startedAt) ? startedAt : begin;
  const waitEnd = origin + waitMs;
  const deadlineSignal = deadline?.signal && typeof deadline.signal.addEventListener === 'function' ? deadline.signal : null;
  let aborted = Boolean(deadlineSignal?.aborted);
  let sleepTimer = null;
  let wake = null;
  const onAbort = () => {
    aborted = true;
    if (sleepTimer !== null) { timers.clearTimer(sleepTimer); sleepTimer = null; }
    if (wake) { const w = wake; wake = null; w(); }
  };
  if (deadlineSignal && !aborted) deadlineSignal.addEventListener('abort', onAbort, { once: true });
  const sleep = (ms) => new Promise((resolve) => {
    if (aborted) { resolve(); return; }
    wake = resolve;
    sleepTimer = timers.setTimer(() => { sleepTimer = null; wake = null; resolve(); }, ms);
  });
  // งบเส้นตายคิดครั้งเดียวตอนเริ่มรอ (= deadlineAt − กันชน) — แบบเดียวกับ settle() ของ PRE-GENERATE
  const remaining = typeof deadline?.remainingMs === 'function' ? Number(deadline.remainingMs()) : Number.POSITIVE_INFINITY;
  const budgetEnd = Number.isFinite(remaining) ? begin + Math.max(0, remaining - reserveMs) : Number.POSITIVE_INFINITY;
  const stopAt = Math.min(waitEnd, budgetEnd);

  let outcome = { final: false, status: 'pending' };
  let polls = 0;
  try {
    let reader = typeof read === 'function' ? read : null;
    if (!jobId) {
      outcome = { final: true, status: 'no_job' };
    } else {
      if (!reader) {
        let storage = null;
        try {
          storage = await within(Promise.resolve().then(() => loadStorage()), readTimeoutMs, timers, null);
        } catch {
          storage = null;
        }
        if (storage) {
          const workerState = { online: null };
          reader = (id) => readWriteOutcome(storage, id, { now, offlineAfterMs, workerState });
        }
      }
      if (!reader) {
        outcome = { final: true, status: 'unavailable' };
      } else {
        let latest = null;
        let errors = 0;
        for (;;) {
          if (aborted) { outcome = latest || { final: false, status: 'pending' }; break; } // เส้นตายรวมหมดแล้ว = ไม่อ่านต่อ
          // eslint-disable-next-line no-await-in-loop -- poll ทีละครั้งตามจังหวะ (ห้ามยิงซ้อน)
          const result = await within(Promise.resolve().then(() => reader(jobId)), readTimeoutMs, timers, { final: false, status: 'pending', timedOut: true })
            .catch(() => ({ final: false, status: 'pending', error: true }));
          polls += 1;
          if (result?.final) { outcome = result; break; }
          if (result?.error || result?.timedOut) errors += 1;
          else errors = 0;
          latest = { ...(result || {}), final: false, status: 'pending', ...(latest?.request && !result?.request ? { request: latest.request } : {}) };
          if (latest.request?.status === 'queued' && result?.workerOnline === false) { outcome = { ...latest, final: true, status: 'offline' }; break; }
          if (errors >= 3) { outcome = { ...latest, final: true, status: 'error' }; break; }
          if (aborted) { outcome = latest; break; }
          const t = now();
          if (t >= stopAt) { outcome = latest; break; }
          // eslint-disable-next-line no-await-in-loop -- เว้นจังหวะ poll (timer ถูก clear เมื่อ abort)
          await sleep(Math.min(pollMs, stopAt - t));
          if (aborted) { outcome = latest; break; }
        }
      }
    }
  } catch {
    outcome = { final: true, status: 'error' };
  } finally {
    if (sleepTimer !== null) { timers.clearTimer(sleepTimer); sleepTimer = null; }
    if (deadlineSignal) deadlineSignal.removeEventListener('abort', onAbort);
  }

  const elapsed = Math.max(0, now() - begin);
  const run = buildResearchAgentRun({ outcome, mode, jobId, workflowId, ms: elapsed, waitedMs: elapsed, polls });
  try {
    Promise.resolve(logPipeline({
      workflowId,
      step: 'research-agent',
      status: pipelineLogStatus(run.summary.status),
      duration: run.summary.ms,
      detail: `${mode} · ${run.summary.status} · ${run.summary.cardsCount} การ์ด${run.summary.flags.length ? ` · ${run.summary.flags.join(',')}` : ''} · รอหลังสกัด`,
      metadata: {
        status: run.summary.status,
        mode,
        cards: run.summary.cardsCount,
        pass: run.summary.passCount,
        flags: run.summary.flags,
        ms: run.summary.ms,
        waitedMs: run.summary.waitedMs,
        brain: run.summary.brain,
      },
    })).catch(() => {});
  } catch { /* บันทึกล้มไม่กระทบข่าว */ }
  return { ...run, outcome };
}
