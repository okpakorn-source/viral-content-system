// ============================================================
// 🧾 POST /api/research/report — worker ส่งผลการ์ด (Research Agent v2 · เลน B · SPEC-v2 ส่วน 2.2/2.4/6)
// ------------------------------------------------------------
// body {jobId, workerId, result} (≤ 1,000,000 ตัวอักษร) · header x-research-secret = RESEARCH_AGENT_SECRET
// → ต้องเป็น worker ที่ถือใบขออยู่ · ตรวจ schema 2.2 + ด่านเชิงกลซ้ำแบบ "บีบได้อย่างเดียว" (cardsSchema.js)
//   → เขียน research-cards (insert/cas · คง feedback เดิม) → ปิดใบขอ done/failed
//   schema ขาด = เก็บเป็น status failed + ธง SCHEMA_INVALID (สเปก 6.1) · ส่งซ้ำหลังสำเร็จ = duplicate (ไม่เขียนทับ)
//   mode ของเอกสาร = RESEARCH_AGENT_MODE ฝั่งเว็บ (ตัวจริงที่ท่อ/บอทใช้) · result ไม่ถูกพิมพ์ลง log
// ============================================================
import { checkWorkerSecret, jsonFail, jsonOk, readJsonBody, storageErrorResponse } from '@/lib/research-agent/http';
import { summarizeCardsDoc } from '@/lib/research-agent/cardsSchema';
import { getResearchAgentMode } from '@/lib/research-agent/modes';
import {
  loadResearchStorage,
  normalizeQuotaReport,
  RESEARCH_JOB_ID_RE,
  RESEARCH_WORKER_ID_RE,
} from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  try {
    const denied = checkWorkerSecret(req);
    if (denied) return denied;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const { jobId, workerId, result } = parsed.body;
    if (typeof jobId !== 'string' || !RESEARCH_JOB_ID_RE.test(jobId)) return jsonFail(400, 'jobId ไม่ถูกต้อง', 'VALIDATION_ERROR');
    if (typeof workerId !== 'string' || !RESEARCH_WORKER_ID_RE.test(workerId)) {
      return jsonFail(400, 'workerId ต้องเป็นข้อความ [A-Za-z0-9._:@-] ไม่เกิน 80 ตัวอักษร', 'VALIDATION_ERROR');
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return jsonFail(400, 'result ต้องเป็น JSON object ตามสัญญา research-cards', 'VALIDATION_ERROR');
    }

    const storage = await loadResearchStorage();
    const outcome = await storage.report({ jobId, workerId, result, mode: getResearchAgentMode() });
    if (outcome.outcome === 'not_found') return jsonFail(404, 'ไม่พบใบขอค้นคว้านี้', 'RESEARCH_REQUEST_NOT_FOUND');
    if (outcome.outcome === 'lost') {
      return jsonFail(409, 'worker นี้ไม่ได้ถือใบขอนี้ — ไม่รับผล', 'RESEARCH_LEASE_LOST', { status: outcome.request?.status || null });
    }
    const quota = normalizeQuotaReport(result.brain?.quotaPctAfter, result.brain?.account);
    await storage.touchWorker({ workerId, event: 'report', jobId, quota });
    const summary = summarizeCardsDoc(outcome.doc);
    if (outcome.outcome === 'duplicate') {
      return jsonOk({ duplicate: true, jobId, revision: outcome.doc.revision, status: outcome.doc.status, ...summary });
    }
    return jsonOk({
      jobId,
      revision: outcome.doc.revision,
      ...summary,
      status: outcome.doc.status,
      requestStatus: outcome.request?.status || null,
      requestClosed: outcome.requestClosed === true,
      schemaErrors: outcome.schemaErrors,
      gateChanges: outcome.gateChanges.length,
    });
  } catch (error) {
    console.warn(`[ResearchReport] ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return storageErrorResponse(error, 'RESEARCH_REPORT_ERROR', 'บันทึกผลรีเสิร์ชไม่สำเร็จ');
  }
}
