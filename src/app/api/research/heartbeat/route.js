// ============================================================
// 💓 POST /api/research/heartbeat — ชีพจรของ worker (Research Agent v2 · เลน B · SPEC-v2 ส่วน 2.4/8)
// ------------------------------------------------------------
// body {jobId?, workerId, version, account, quota: {remainingPct}} (สัญญา 1 ต.ค. 69) · header x-research-secret = RESEARCH_AGENT_SECRET
//   มี jobId = ยืนยันว่ายังถือใบนั้นอยู่ (อัปเดต heartbeatAt) · ไม่ถือแล้ว = 409 RESEARCH_LEASE_LOST (worker ควรหยุดงานนั้น)
//   ไม่มี jobId = แตะชีพจรเครื่องอย่างเดียว (ใช้ตัดสิน online/offline ที่ /api/research/status)
//   รับได้แม้ปิดสวิตช์ (งานที่หยิบไปแล้วต้องจบได้) · quota = % โควตา Codex ที่เหลือของบัญชีปัจจุบัน (ข้อ 16)
//   รับทั้ง body.quota.remainingPct และ body.quotaPct ของ worker รุ่นแรก (contract-check #1) · version: body ก่อน header สำรอง (#2)
// ============================================================
import { checkWorkerSecret, jsonFail, jsonOk, readJsonBody, storageErrorResponse, workerVersionFrom } from '@/lib/research-agent/http';
import { loadResearchStorage, RESEARCH_JOB_ID_RE, RESEARCH_WORKER_ID_RE, workerQuotaFromBody } from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  try {
    const denied = checkWorkerSecret(req);
    if (denied) return denied;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const { jobId, workerId } = parsed.body;
    if (typeof workerId !== 'string' || !RESEARCH_WORKER_ID_RE.test(workerId)) {
      return jsonFail(400, 'workerId ต้องเป็นข้อความ [A-Za-z0-9._:@-] ไม่เกิน 80 ตัวอักษร', 'VALIDATION_ERROR');
    }
    if (jobId !== undefined && jobId !== null && (typeof jobId !== 'string' || !RESEARCH_JOB_ID_RE.test(jobId))) {
      return jsonFail(400, 'jobId ไม่ถูกต้อง', 'VALIDATION_ERROR');
    }
    const quota = workerQuotaFromBody(parsed.body);
    const version = workerVersionFrom(req, parsed.body);
    const storage = await loadResearchStorage();
    if (!jobId) {
      await storage.touchWorker({ workerId, event: 'heartbeat', quota, version });
      return jsonOk({ ok: true, jobId: null });
    }
    const result = await storage.heartbeat({ jobId, workerId });
    await storage.touchWorker({ workerId, event: 'heartbeat', jobId, quota, version });
    if (result.outcome === 'ok') {
      return jsonOk({ ok: true, jobId, status: result.request.status, deadlineAt: result.request.deadlineAt });
    }
    if (result.outcome === 'not_found') return jsonFail(404, 'ไม่พบใบขอค้นคว้านี้', 'RESEARCH_REQUEST_NOT_FOUND');
    if (result.outcome === 'lost') {
      return jsonFail(409, 'worker นี้ไม่ได้ถือใบขอนี้แล้ว — หยุดงานนี้ได้', 'RESEARCH_LEASE_LOST', { status: result.request?.status || null });
    }
    return jsonFail(409, 'อัปเดตชีพจรชนกับการเขียนอื่น — ส่งใหม่รอบถัดไป', 'RESEARCH_CONFLICT');
  } catch (error) {
    console.warn(`[ResearchHeartbeat] ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return storageErrorResponse(error, 'RESEARCH_HEARTBEAT_ERROR', 'บันทึกชีพจรไม่สำเร็จ');
  }
}
