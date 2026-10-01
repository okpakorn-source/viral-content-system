// ============================================================
// 🧾 src/lib/research-agent/writeStage.js — ขั้น "รีเสิร์ชเข้าเนื้อ" ของท่อข่าว (Research Agent v2 โหมด write)
// ------------------------------------------------------------
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3) — ไฟล์ใหม่ (เลน W1 · สเปก C:\tmp\research-agent-lab\SPEC-v3-write.md ส่วน 2/3/8.1)
// เรียกจาก src/lib/services/autoFlowServiceText.js "หลังขั้นสกัด ก่อนแตกประเด็น" (dynamic import เฉพาะ RESEARCH_AGENT=1 ·
//   RESEARCH_AGENT_MODE=write · สายข้อความ) — รวมทุกอย่างไว้ที่นี่ให้ไฟล์ล็อกแก้น้อยที่สุด:
//   1) waitResearchCards (readCards.js): รอการ์ด ≤ WAIT_MS (ค่าเริ่มต้น 300000) นับจากเริ่มท่อ · เลิกรอเมื่อเส้นตายรวมเหลือ < 480s
//   2) การ์ด done ที่ผ่านเกณฑ์ → runEditorBrief (editorBrief.js) ด้วยงบ min(60s, เวลาที่เหลือ − 420s)
//      = บรรณาธิการไม่กินงบที่เหลือให้แตกประเด็น/blueprint/นักเขียน/ด่าน (เหลือ < 435s = ไม่เรียก · failed BUDGET)
//   3) ระเบียน 8.1 → saveEditorResult (store research-editor · ทุกสถานะ done/not_ready/failed/skipped · เพดาน 4 วิ · ล้ม = ข้าม)
//      + pipeline_logs step 'research-editor' {used, corrections, additions, ms} (ไม่รอผล)
//   4) คืนของที่ท่อใช้: enrichedSource (เฉพาะ done) · breakdownArgs (มุมเสนอ "ตัวเลือก ไม่บังคับ" ผ่าน customPrompt ของขั้นแตกประเด็น) ·
//      researchFacts (ข้อเท็จจริงการ์ดที่ใช้ → correction L1.8/placeScrub) · run (analysis/pipelineInfo แบบ settle + editor) ·
//      poll (ช่อง PRE-GENERATE ใช้ผลนี้ซ้ำ ไม่ poll/ไม่รอซ้ำ) · logLine
// fail-open: ไม่โยนเลย — ปิดสวิตช์/โหมดอื่น/ไม่มี jobId/พังกลางทาง = null (ท่อเดินต้นฉบับ + ช่อง PRE-GENERATE เดิม) ·
//   ไม่ทัน/ล้ม/ไม่ผ่านเกณฑ์ = ผลสถานะ not_ready/failed/skipped (ข่าวเขียนจากต้นฉบับ · บอทแจ้งพนักงาน)
// ============================================================

import { capText, normalizeSuggestedDimensions } from '@/lib/research-agent/cardsSchema';
import {
  EDITOR_MODEL_LABEL,
  EDITOR_TIMEOUT_MS,
  runEditorBrief,
  selectUsableCards,
} from '@/lib/research-agent/editorBrief';
import { getResearchAgentMode, getResearchAgentWaitMs, isResearchAgentOn } from '@/lib/research-agent/modes';
import { buildResearchAgentRun, RESEARCH_PIPELINE_RESERVE_MS, waitResearchCards } from '@/lib/research-agent/readCards';
import { buildEditorResultDoc, jobIdFromWorkflowId, loadResearchStorage } from '@/lib/research-agent/store';

/** เวลาที่ต้องเหลือหลังบรรณาธิการจบ (= กันชนรอการ์ด 480s − งบบรรณาธิการ 60s) */
export const EDITOR_RESERVE_AFTER_MS = RESEARCH_PIPELINE_RESERVE_MS - EDITOR_TIMEOUT_MS;
/** งบบรรณาธิการต่ำกว่านี้ = ไม่เรียก (ไม่ทันแน่ เสียเงินเปล่า) */
export const EDITOR_MIN_BUDGET_MS = 15_000;
export const EDITOR_SAVE_TIMEOUT_MS = 4_000;

const NOT_READY_REASONS = Object.freeze({
  pending: 'การ์ดยังไม่มาในเวลาที่ท่อรอได้',
  expired: 'ใบขอค้นคว้าหมดอายุ (worker ไม่ได้หยิบหรือส่งผลไม่ทัน)',
  offline: 'worker รีเสิร์ชออฟไลน์',
  no_request: 'ไม่มีใบขอค้นคว้าของงานนี้',
  unavailable: 'ที่เก็บรีเสิร์ชใช้ไม่ได้ชั่วคราว',
  error: 'อ่านการ์ดล้มซ้ำ',
});

const defaultTimers = {
  setTimer: (fn, ms) => setTimeout(fn, ms), // ไม่ unref — ท่อรอบันทึกอยู่จริง (สั้น ≤ 4 วิ)
  clearTimer: (timer) => clearTimeout(timer),
};

async function defaultLogPipeline(entry) {
  const { logPipeline } = await import('@/lib/pipelineLogger');
  return logPipeline(entry);
}

/** รอ promise ไม่เกิน ms (timer ถูก clear ทุกทาง) · หมดเวลา = fallback · โยน = fallback */
async function bounded(task, ms, timers, fallback) {
  let timer = null;
  const timeout = new Promise((resolve) => { timer = timers.setTimer(() => resolve(fallback), ms); });
  try {
    return await Promise.race([Promise.resolve().then(task).catch(() => fallback), timeout]);
  } finally {
    if (timer !== null) timers.clearTimer(timer);
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const seconds = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)}s`;

/**
 * มุมเสนอ → ข้อความต่อท้าย args ของขั้นแตกประเด็น (customPrompt) — ป้าย "ตัวเลือก ไม่บังคับ" (ข้อตัดสิน #19)
 * ตัดเครื่องหมายคำพูดทิ้ง (summarizeServiceText ครอบค่านี้ด้วย "…" อีกชั้น) · ไม่มีมุม = ''
 */
export function buildDimensionsHint(dimensions) {
  const list = normalizeSuggestedDimensions(dimensions);
  if (list.length === 0) return '';
  return `มุมเสนอ (ตัวเลือก ไม่บังคับ) จากฝ่ายค้นคว้า: ${list.map((d, i) => `${i + 1}) ${d.replace(/["“”]/g, '')}`).join(' · ')}`
    + ' — ใช้เป็นแรงบันดาลใจได้เฉพาะเมื่อ RAW รองรับ ห้ามสร้างข้อเท็จจริงใหม่เพื่อให้เข้ามุม';
}

/** ระเบียน 8.1 จากผลรอ + ผลบรรณาธิการ (ยังไม่ normalize — store.buildEditorResultDoc ทำต่อ) */
function editorRecordOf({ jobId, status, reason, editorResult, doc, original, waitedMs }) {
  const done = status === 'done';
  const er = editorResult || {};
  const flags = new Set(Array.isArray(doc?.flags) ? doc.flags : []);
  const corrections = Array.isArray(er.corrections) ? er.corrections : [];
  if (done && corrections.length > 0) flags.add('RAW_CONTRADICTION');
  const staffNotes = [...(Array.isArray(er.staff_notes) ? er.staff_notes : [])];
  const warnings = [...(Array.isArray(er.warnings) ? er.warnings : [])];
  if (doc) {
    const story = typeof doc.story_date_estimate === 'string' ? doc.story_date_estimate.trim() : '';
    if (story && !/^ไม่ทราบ/.test(story)) staffNotes.push(`วันเกิดเรื่องโดยประมาณ (เอเจนต์): ${story}`);
    const origin = doc.origin_post && typeof doc.origin_post === 'object' ? doc.origin_post : null;
    if (origin?.url) staffNotes.push(`ต้นทาง: ${origin.source_name || 'ไม่ระบุชื่อ'}${origin.date ? ` · ${origin.date}` : ''}`);
    if (flags.has('STALE_NEWS') && typeof doc.stale_news_warning === 'string' && doc.stale_news_warning.trim()) {
      warnings.push(`ข่าวเก่า: ${doc.stale_news_warning.trim()}`);
    }
  }
  const enriched = done && typeof er.enriched === 'string' ? er.enriched : null;
  return {
    id: jobId,
    status,
    mode: 'write',
    used_cards: done ? er.used_cards : [],
    corrections, // แก้ตามแหล่งที่ยืนยันแล้ว — failed ก็ยังให้พนักงานเห็นไปแก้เองได้
    additions: done ? er.additions : [],
    not_used: Array.isArray(er.not_used) ? er.not_used : [],
    suggested_dimensions: Array.isArray(er.suggested_dimensions) && er.suggested_dimensions.length
      ? er.suggested_dimensions
      : normalizeSuggestedDimensions(doc?.suggested_dimensions),
    staff_notes: staffNotes,
    warnings,
    flags: [...flags],
    original_chars: original.length,
    enriched_chars: enriched ? enriched.length : null,
    ratio: enriched && original.length > 0 ? round2(enriched.length / original.length) : null,
    waitedMs,
    editorMs: Number.isFinite(er.editorMs) ? er.editorMs : 0,
    model: editorResult?.called ? EDITOR_MODEL_LABEL : null,
    reason: done ? null : (reason || null),
    ...(enriched ? { enriched_preview: capText(enriched, 400) } : {}),
  };
}

function logLineOf(status, record) {
  const waited = seconds(record.waitedMs);
  if (status === 'done') {
    return `✍️ write: ฉบับเสริมแทนต้นฉบับ · ใช้การ์ด ${record.used_cards.join(',') || '-'} · แก้ ${record.corrections.length} · เพิ่ม ${record.additions.length}`
      + ` · ยาว ${record.ratio ?? '-'} เท่า (รอ ${waited} · บรรณาธิการ ${seconds(record.editorMs)})`;
  }
  if (status === 'not_ready') return `⏳ write: รีเสิร์ชไม่ทัน — ${record.reason || '-'} (รอ ${waited}) · ข่าวนี้เขียนจากต้นฉบับ`;
  if (status === 'skipped') return `ℹ️ write: ไม่มีข้อมูลผ่านเกณฑ์ — ${record.reason || '-'} (รอ ${waited}) · ข่าวนี้เขียนจากต้นฉบับ`;
  return `⚠️ write: บรรณาธิการล้ม — ${record.reason || '-'} (รอ ${waited} · บรรณาธิการ ${seconds(record.editorMs)}) · ข่าวนี้เขียนจากต้นฉบับ`;
}

/**
 * ขั้นรีเสิร์ชเข้าเนื้อ (โหมด write) — ไม่โยนเลย
 * @param {{ workflowId: string, rawText: string, newsData?: {newsTitle?: string, newsBody?: string}|null, pipelineStartedAt?: number,
 *   deadline?: object|null, env?: object, now?: () => number, timers?: object, wait?: Function, editor?: Function,
 *   invoke?: Function, loadStorage?: Function, logPipeline?: Function }} input
 * @returns {Promise<null | { status: 'done'|'not_ready'|'failed'|'skipped', reason: string|null, enrichedSource: string|null,
 *   originalRawText: string, breakdownArgs: {customPrompt: string}|null, researchFacts: string[], record: object, run: object,
 *   poll: { jobId: string, mode: string, settle: () => Promise<object> }, saved: boolean, logLine: string }>}
 */
export async function runResearchWriteStage({
  workflowId,
  rawText,
  newsData = null,
  pipelineStartedAt,
  deadline = null,
  env = process.env,
  now = Date.now,
  timers = null,
  wait = waitResearchCards,
  editor = runEditorBrief,
  invoke,
  loadStorage = loadResearchStorage,
  logPipeline = defaultLogPipeline,
} = {}) {
  try {
    if (!isResearchAgentOn(env) || getResearchAgentMode(env) !== 'write') return null;
    const jobId = jobIdFromWorkflowId(workflowId);
    if (!jobId) return null; // งานนอกคิว (เว็บยิงตรง) ไม่มีใบขอ — ท่อเดิม
    const original = typeof rawText === 'string' ? rawText : '';
    const clock = timers || defaultTimers;
    const waited = await wait({
      workflowId,
      jobId,
      maxWaitMs: getResearchAgentWaitMs(env, 'write'),
      startedAt: pipelineStartedAt,
      deadline,
      env,
      now,
      ...(timers ? { timers } : {}),
      loadStorage,
      logPipeline,
    });
    if (!waited || typeof waited !== 'object') return null;
    const outcome = waited.outcome && typeof waited.outcome === 'object' ? waited.outcome : {};
    const waitedMs = Number.isFinite(waited.summary?.waitedMs) ? waited.summary.waitedMs : 0;
    const doc = outcome.card && typeof outcome.card === 'object' ? outcome.card : null;

    let status;
    let reason = null;
    let editorResult = null;
    if (!doc) {
      if (outcome.status === 'failed') {
        status = 'skipped';
        reason = 'เอเจนต์ค้นคว้าล้ม (ใบขอ failed) — ไม่มีการ์ด';
      } else {
        status = 'not_ready';
        reason = NOT_READY_REASONS[outcome.status] || `การ์ดยังไม่มา (${outcome.status || 'pending'})`;
      }
    } else if (doc.status !== 'done') {
      status = 'skipped';
      reason = `เอเจนต์ค้นคว้าจบด้วยสถานะ ${doc.status}`;
    } else {
      const selection = selectUsableCards(doc);
      const remaining = typeof deadline?.remainingMs === 'function' ? Number(deadline.remainingMs()) : Number.POSITIVE_INFINITY;
      const budget = Number.isFinite(remaining) ? Math.min(EDITOR_TIMEOUT_MS, remaining - EDITOR_RESERVE_AFTER_MS) : EDITOR_TIMEOUT_MS;
      if (selection.usable.length === 0 && selection.corrections.length === 0) {
        editorResult = await editor({ rawText: original, extracted: newsData, cardsDoc: doc, invoke, now, ...(timers ? { timers } : {}) });
        status = editorResult?.status === 'skipped' ? 'skipped' : 'failed';
        reason = editorResult?.reason || 'ไม่มีการ์ดผ่านเกณฑ์เข้าฉบับเสริม';
      } else if (budget < EDITOR_MIN_BUDGET_MS) {
        status = 'failed';
        reason = `งบเวลาท่อเหลือไม่พอเรียกบรรณาธิการ (เหลือ ${seconds(remaining)})`;
        editorResult = { not_used: selection.notUsed, suggested_dimensions: normalizeSuggestedDimensions(doc.suggested_dimensions), editorMs: 0 };
      } else {
        editorResult = await editor({
          rawText: original, extracted: newsData, cardsDoc: doc, invoke, now, timeoutMs: budget, ...(timers ? { timers } : {}),
        });
        status = ['done', 'failed', 'skipped'].includes(editorResult?.status) ? editorResult.status : 'failed';
        reason = editorResult?.reason || null;
        if (status === 'done' && !(typeof editorResult.enriched === 'string' && editorResult.enriched.trim())) {
          status = 'failed';
          reason = 'บรรณาธิการไม่คืนเนื้อฉบับเสริม';
        }
      }
    }

    const rawRecord = editorRecordOf({ jobId, status, reason, editorResult, doc, original, waitedMs });
    let record = buildEditorResultDoc(jobId, rawRecord, { nowIso: new Date(now()).toISOString() });
    let saved = false;
    const stored = await bounded(async () => {
      const storage = await loadStorage();
      return storage.saveEditorResult(jobId, rawRecord);
    }, EDITOR_SAVE_TIMEOUT_MS, clock, null);
    if (stored && typeof stored === 'object') {
      record = stored;
      saved = true;
    }
    try {
      Promise.resolve(logPipeline({
        workflowId,
        step: 'research-editor',
        status: status === 'done' ? 'success' : status === 'failed' ? 'failed' : 'warning',
        duration: record.editorMs || 0,
        detail: `write · ${status} · ใช้ ${record.used_cards.length} การ์ด · แก้ ${record.corrections.length} · เพิ่ม ${record.additions.length}`
          + `${record.reason ? ` · ${capText(record.reason, 120)}` : ''}`,
        metadata: {
          status,
          used: record.used_cards,
          corrections: record.corrections.length,
          additions: record.additions.length,
          ratio: record.ratio,
          waitedMs: record.waitedMs,
          editorMs: record.editorMs,
          ms: record.editorMs,
          saved,
        },
      })).catch(() => {});
    } catch { /* บันทึกล้มไม่กระทบข่าว */ }

    const done = status === 'done';
    const run = buildResearchAgentRun({
      outcome,
      mode: 'write',
      jobId,
      workflowId,
      ms: waited.summary?.ms ?? waitedMs,
      waitedMs,
      polls: waited.summary?.polls ?? 0,
      editor: record,
      originalPreview: done ? original : null,
    });
    const hint = done ? buildDimensionsHint(record.suggested_dimensions) : '';
    return {
      status,
      reason: record.reason,
      enrichedSource: done ? editorResult.enriched : null,
      originalRawText: original,
      breakdownArgs: hint ? { customPrompt: hint } : null,
      researchFacts: done && Array.isArray(editorResult.support) ? editorResult.support : [],
      record,
      run,
      poll: { jobId, mode: 'write', settle: () => Promise.resolve(run) },
      saved,
      logLine: logLineOf(status, record),
    };
  } catch {
    return null;
  }
}
