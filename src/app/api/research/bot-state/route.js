// ============================================================
// 🗄️ /api/research/bot-state — สถานะถาวรของบอท Discord (ทนรีสตาร์ต/redeploy) · ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7)
// ------------------------------------------------------------
// ใหม่ · additive: บอท (discord-bot/researchCard.js createResearchWatchdog) จด "สรุปรายวันส่งแล้ว/กำลังส่ง" ที่นี่
//   → Railway redeploy/รีสตาร์ต หรือสอง instance ทับกันช่วงสั้นๆ ไม่ส่งสรุปซ้ำ (จองแบบ cas ก่อนส่ง)
// ที่เก็บ: saveBotState/getBotState ของ src/lib/research-agent/store.js (store 'bot-state' · row 'bstate_<key>')
// ยืนยันตัวตนแบบบอท (checkBotKey): x-api-key / x-bot-secret = DISCORD_API_SECRET · ไม่ตั้ง env = 403 · ไม่ตรง = 401 · ปฏิเสธก่อนแตะฐาน
// GET  ?key=daily-digest → { success, key, item: {id, state, revision, createdAt, updatedAt} | null }
// POST { key, expectedRevision, state } → { success, key, item } · ชน (instance อื่นเขียนก่อน/revision ไม่ตรง) = 409 BOT_STATE_CONFLICT + item ล่าสุด
//   expectedRevision 0 = ต้องยังไม่มีแถว · key ที่รับ = BOT_STATE_KEYS · state = JSON object ≤ 4,000 ตัวอักษร · ผิด = 400 VALIDATION_ERROR
// error: ฐานใช้ไม่ได้ = 503 RESEARCH_STORAGE_UNAVAILABLE · อื่นๆ = 500 BOT_STATE_READ_ERROR / BOT_STATE_WRITE_ERROR (ไม่ส่งข้อความดิบ)
// ============================================================
import { checkBotKey, jsonFail, jsonOk, readJsonBody, storageErrorResponse } from '@/lib/research-agent/http';
import { BOT_STATE_KEYS, loadResearchStorage } from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_CHARS = 8_000;

function keyOf(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  return BOT_STATE_KEYS.includes(key) ? key : null;
}

export async function GET(req) {
  try {
    const denied = checkBotKey(req);
    if (denied) return denied;
    const key = keyOf(new URL(req.url).searchParams.get('key'));
    if (!key) return jsonFail(400, `ต้องระบุ key (${BOT_STATE_KEYS.join(' | ')})`, 'VALIDATION_ERROR');
    const storage = await loadResearchStorage();
    const item = await storage.getBotState(key);
    return jsonOk({ key, item: item || null });
  } catch (error) {
    console.warn(`[BotState] GET ล้ม: ${error?.errorType || error?.name || 'error'}`);
    return storageErrorResponse(error, 'BOT_STATE_READ_ERROR', 'อ่านสถานะบอทไม่สำเร็จ');
  }
}

export async function POST(req) {
  try {
    const denied = checkBotKey(req);
    if (denied) return denied;
    const parsed = await readJsonBody(req, MAX_BODY_CHARS);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const key = keyOf(body.key);
    if (!key) return jsonFail(400, `key ต้องเป็น ${BOT_STATE_KEYS.join(' | ')}`, 'VALIDATION_ERROR');
    const expectedRevision = body.expectedRevision ?? 0;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return jsonFail(400, 'expectedRevision ต้องเป็นจำนวนเต็ม ≥ 0 (0 = ยังไม่มีแถว)', 'VALIDATION_ERROR');
    }
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
      return jsonFail(400, 'state ต้องเป็น JSON object', 'VALIDATION_ERROR');
    }
    const storage = await loadResearchStorage();
    const result = await storage.saveBotState(key, body.state, { expectedRevision });
    if (result.outcome === 'conflict') {
      return jsonFail(409, 'สถานะบอทถูกเปลี่ยนโดย instance อื่น — อ่านใหม่แล้วค่อยลองอีกครั้ง', 'BOT_STATE_CONFLICT', { item: result.item || null });
    }
    return jsonOk({ key, item: result.item });
  } catch (error) {
    console.warn(`[BotState] POST ล้ม: ${error?.errorType || error?.code || error?.name || 'error'}`);
    return storageErrorResponse(error, 'BOT_STATE_WRITE_ERROR', 'บันทึกสถานะบอทไม่สำเร็จ');
  }
}
