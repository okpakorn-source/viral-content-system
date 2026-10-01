// ============================================================
// 🗂️ GET /api/research/cards?jobId= — บอท/หน้าเว็บอ่านการ์ดของงาน (Research Agent v2 · เลน B · SPEC-v2 ส่วน 2.4/7)
// ------------------------------------------------------------
// ยืนยันตัวตนแบบเดียวกับ /api/bot/tracking: header x-bot-secret หรือ x-api-key = DISCORD_API_SECRET (fail-closed)
// → {found, request:{status,…}|null, cards: เอกสาร research-cards|null, summary}
//   found:false + request.status queued/leased = ยังทำอยู่ (บอท poll ต่อ) · request null หรือ failed/expired = หยุด poll
//   tool_log ไม่ถูกส่ง (ใหญ่ · บอทไม่ใช้) เว้นแต่ ?full=1 · ไม่ส่ง rawText/userId ของใบขอ
// ============================================================
import { checkBotKey, jsonFail, jsonOk, storageErrorResponse } from '@/lib/research-agent/http';
import { summarizeCardsDoc } from '@/lib/research-agent/cardsSchema';
import { getResearchAgentConfig } from '@/lib/research-agent/modes';
import { loadResearchStorage, RESEARCH_JOB_ID_RE } from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function publicRequest(request) {
  return {
    status: request.status,
    attempt: request.attempt ?? 0,
    createdAt: request.createdAt ?? null,
    deadlineAt: request.deadlineAt ?? null,
    leasedAt: request.leasedAt ?? null,
    reportedAt: request.reportedAt ?? null,
    sourceUrlCount: Array.isArray(request.sourceUrls) ? request.sourceUrls.length : 0,
  };
}

function publicCards(doc, full) {
  if (full) return doc;
  const { tool_log: toolLog, ...rest } = doc;
  return { ...rest, toolLogCount: Array.isArray(toolLog) ? toolLog.length : 0 };
}

export async function GET(req) {
  try {
    const denied = checkBotKey(req);
    if (denied) return denied;
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId') || '';
    if (!RESEARCH_JOB_ID_RE.test(jobId)) return jsonFail(400, 'ต้องระบุ jobId ที่ถูกต้อง', 'VALIDATION_ERROR');
    const full = url.searchParams.get('full') === '1';

    const storage = await loadResearchStorage();
    const [doc, request] = await Promise.all([storage.getCards(jobId), storage.getRequest(jobId)]);
    const config = getResearchAgentConfig();
    return jsonOk({
      jobId,
      found: !!doc,
      enabled: config.enabled,
      mode: doc?.mode || config.mode,
      request: request ? publicRequest(request) : null,
      cards: doc ? publicCards(doc, full) : null,
      summary: doc ? summarizeCardsDoc(doc) : null,
    });
  } catch (error) {
    console.warn(`[ResearchCards] ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return storageErrorResponse(error, 'RESEARCH_CARDS_READ_ERROR', 'อ่านการ์ดรีเสิร์ชไม่สำเร็จ');
  }
}
