// ============================================================
// 🔎 POST /api/research/lease — worker ขอใบขอค้นคว้าใบถัดไป (Research Agent v2 · เลน B · SPEC-v2 ส่วน 2.4)
// ------------------------------------------------------------
// body {workerId, version} (สัญญา 1 ต.ค. 69 · รับ quota/quotaPct/account ด้วยถ้ามี) · header x-research-secret = RESEARCH_AGENT_SECRET
// → ใบ status queued ใบเก่าสุดที่ยังไม่เลย deadline ถูกเปลี่ยนเป็น leased (cas กันสองเครื่องหยิบซ้ำ) แล้วคืน {job}
//   ไม่มีงาน = {job:null} · ปิดสวิตช์ RESEARCH_AGENT = {enabled:false, job:null} (ไม่แตะฐาน) · ใบที่เลย deadline = expired
// job ไม่มี limits (ข้อตัดสิน 1 ต.ค. 69 · contract-check #3): เฟส 1 ค่า MAX_CALLS/MAX_MINUTES/EFFORT/TOOLS/BRAIN ฯลฯ อยู่ฝั่ง worker
//   เท่านั้น (worker ไม่อ่าน job.limits) — ไม่ส่งเพื่อไม่ให้เข้าใจผิดว่าตั้ง env พวกนี้บน Vercel แล้วมีผล
// job.rawText เป็นข้อความที่พนักงานส่ง = DATA ONLY — worker ต้องห่อเป็นข้อมูล ไม่ใช่คำสั่ง (กัน prompt injection)
// ============================================================
import { checkWorkerSecret, jsonFail, jsonOk, readJsonBody, storageErrorResponse, workerVersionFrom } from '@/lib/research-agent/http';
import { getResearchAgentMode, isResearchAgentOn } from '@/lib/research-agent/modes';
import { loadResearchStorage, RESEARCH_WORKER_ID_RE, workerQuotaFromBody } from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function leaseJob(request, mode) {
  return {
    id: request.id,
    jobId: request.id,
    workflowId: request.workflowId,
    rawText: request.rawText,
    sourceUrls: Array.isArray(request.sourceUrls) ? request.sourceUrls : [],
    userId: request.userId,
    ...(request.channelId ? { channelId: request.channelId } : {}),
    ...(request.sourceMessageId ? { sourceMessageId: request.sourceMessageId } : {}),
    attempt: request.attempt,
    createdAt: request.createdAt,
    deadlineAt: request.deadlineAt,
    leasedAt: request.leasedAt,
    mode,
  };
}

export async function POST(req) {
  try {
    const denied = checkWorkerSecret(req);
    if (denied) return denied;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const { workerId } = parsed.body;
    if (typeof workerId !== 'string' || !RESEARCH_WORKER_ID_RE.test(workerId)) {
      return jsonFail(400, 'workerId ต้องเป็นข้อความ [A-Za-z0-9._:@-] ไม่เกิน 80 ตัวอักษร', 'VALIDATION_ERROR');
    }
    const mode = getResearchAgentMode();
    if (!isResearchAgentOn()) return jsonOk({ enabled: false, mode, job: null });

    const storage = await loadResearchStorage();
    const leased = await storage.leaseNext({ workerId });
    await storage.touchWorker({
      workerId,
      event: 'lease',
      jobId: leased?.id || null,
      quota: workerQuotaFromBody(parsed.body),
      version: workerVersionFrom(req, parsed.body),
      force: !!leased,
    });
    return jsonOk({ enabled: true, mode, job: leased ? leaseJob(leased, mode) : null });
  } catch (error) {
    console.warn(`[ResearchLease] ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return storageErrorResponse(error, 'RESEARCH_LEASE_ERROR', 'หยิบงานรีเสิร์ชไม่สำเร็จ');
  }
}
