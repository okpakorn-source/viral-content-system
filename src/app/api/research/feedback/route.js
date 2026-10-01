// ============================================================
// 👍 POST /api/research/feedback — รีแอ็กชัน 👍/👎 ต่อการ์ด (Research Agent v2 · เลน B · SPEC-v2 ส่วน 2.4/3/10)
// ------------------------------------------------------------
// body {jobId, cardId ('R1'… หรือ 'all'), vote ('up'|'down'), userId} · ยืนยันตัวตนแบบ /api/bot/tracking (DISCORD_API_SECRET)
// → ต่อท้าย research-cards.feedback (ผู้ใช้เดิม+การ์ดเดิม = แทนที่โหวตเก่า · เก็บล่าสุด 300 รายการ) ด้วย cas
//   shadow: เจ้าของให้คะแนน 15 ใบแรก ที่เหลือพนักงาน (ข้อ 23) — route ไม่แยกบทบาท บันทึกตาม userId ที่บอทส่งมา
// ============================================================
import { checkBotKey, jsonFail, jsonOk, readJsonBody, storageErrorResponse } from '@/lib/research-agent/http';
import { loadResearchStorage, RESEARCH_JOB_ID_RE } from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CARD_ID_RE = /^(?:R\d{1,2}|all)$/;
const USER_ID_RE = /^[A-Za-z0-9_:.-]{1,100}$/;

export async function POST(req) {
  try {
    const denied = checkBotKey(req);
    if (denied) return denied;
    const parsed = await readJsonBody(req, 20_000);
    if (!parsed.ok) return parsed.response;
    const { jobId, cardId, vote, userId } = parsed.body;
    if (typeof jobId !== 'string' || !RESEARCH_JOB_ID_RE.test(jobId)) return jsonFail(400, 'jobId ไม่ถูกต้อง', 'VALIDATION_ERROR');
    if (typeof cardId !== 'string' || !CARD_ID_RE.test(cardId)) return jsonFail(400, "cardId ต้องเป็น 'R<เลข>' หรือ 'all'", 'VALIDATION_ERROR');
    if (vote !== 'up' && vote !== 'down') return jsonFail(400, "vote ต้องเป็น 'up' หรือ 'down'", 'VALIDATION_ERROR');
    if (typeof userId !== 'string' || !USER_ID_RE.test(userId)) return jsonFail(400, 'userId ไม่ถูกต้อง', 'VALIDATION_ERROR');

    const storage = await loadResearchStorage();
    const result = await storage.addFeedback({ jobId, cardId, vote, userId });
    if (result.outcome === 'not_found') return jsonFail(404, 'ยังไม่มีการ์ดของงานนี้', 'RESEARCH_CARDS_NOT_FOUND');
    if (result.outcome === 'unknown_card') return jsonFail(404, `ไม่พบการ์ด ${cardId} ในงานนี้`, 'RESEARCH_CARD_NOT_FOUND');
    if (result.outcome !== 'stored') return jsonFail(409, 'บันทึกโหวตชนกับการเขียนอื่น — ลองใหม่', 'RESEARCH_CONFLICT');
    const votes = result.doc.feedback.filter((f) => f.cardId === cardId);
    return jsonOk({
      jobId,
      cardId,
      vote,
      revision: result.doc.revision,
      votes: { up: votes.filter((f) => f.vote === 'up').length, down: votes.filter((f) => f.vote === 'down').length },
    });
  } catch (error) {
    console.warn(`[ResearchFeedback] ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return storageErrorResponse(error, 'RESEARCH_FEEDBACK_ERROR', 'บันทึกโหวตไม่สำเร็จ');
  }
}
