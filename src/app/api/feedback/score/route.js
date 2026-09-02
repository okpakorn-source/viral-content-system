// ============================================================
// 🎯 /api/feedback/score — คะแนน "โอกาสปัง" ต่อเวอร์ชันข่าว (2 ก.ย. 69)
// ------------------------------------------------------------
// POST { text } หรือ { texts: [...] } → ผล scoreVersion (เปอร์เซ็นไทล์เทียบเพจ · ไลก์คาด · สูง/กลาง/ต่ำ · ตัวดัน/ฉุด · คำเตือน)
// GET → ตัวเลขผลเทรนของโมเดล (Spearman / top-decile precision ฯลฯ)
// ยืนยันตัวตน: x-admin-key = ADMIN_API_KEY (คน/หน้าเว็บ) หรือ x-bot-secret / x-api-key = DISCORD_API_SECRET (บอท)
//   ไม่ตั้ง env ทั้งสองตัว = ปิดประตูเสมอ (fail-closed) · เทียบกุญแจแบบ constant-time (แบบเดียวกับ /api/bot/tracking)
// ไม่มีไฟล์โมเดล (ยังไม่เทรน / ไม่ได้ trace ขึ้นโฮสต์) → 503 MODEL_NOT_AVAILABLE ไม่พัง
// ⛔ ไม่ต่อสายเข้าท่อข่าว — endpoint เดี่ยวสำหรับหน้าเว็บ/บอทเรียกดูคะแนน
// ============================================================
import { NextResponse } from 'next/server';
import { scoreVersion, scoreVersions, getModelMetrics } from '@/lib/feedback/viralScore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_LENGTH = 20000;
const MAX_TEXTS = 20;

function fail(status, error, errorType) {
  return NextResponse.json({ success: false, error, errorType }, { status });
}

function secretsMatch(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function envSecret(name) {
  return typeof process.env[name] === 'string' ? process.env[name].trim() : '';
}

// คืน response ปฏิเสธถ้าไม่ผ่าน · คืน null ถ้าผ่าน
function checkAuth(req) {
  const adminKey = envSecret('ADMIN_API_KEY');
  const botSecret = envSecret('DISCORD_API_SECRET');
  if (!adminKey && !botSecret) {
    return fail(403, 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง ADMIN_API_KEY / DISCORD_API_SECRET — ปิดประตูไว้ก่อน', 'AUTH_NOT_CONFIGURED');
  }
  const givenAdmin = (req.headers.get('x-admin-key') || '').trim();
  if (adminKey && givenAdmin && secretsMatch(givenAdmin, adminKey)) return null;
  const givenBot = (req.headers.get('x-bot-secret') || req.headers.get('x-api-key') || '').trim();
  if (botSecret && givenBot && secretsMatch(givenBot, botSecret)) return null;
  return fail(401, 'Unauthorized', 'UNAUTHORIZED');
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function GET(req) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;
    const metrics = getModelMetrics();
    if (!metrics) return fail(503, 'ยังไม่มีโมเดล (data/viral-score-model.json) — รัน node scripts/train-viral-score.mjs ก่อน', 'MODEL_NOT_AVAILABLE');
    return NextResponse.json({ success: true, model: metrics });
  } catch (error) {
    return fail(500, error?.message || 'unknown error', 'SCORE_ERROR');
  }
}

export async function POST(req) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;
    let body = null;
    try { body = await req.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return fail(400, 'ต้องส่ง JSON { text } หรือ { texts: [...] }', 'INVALID_BODY');

    if (Array.isArray(body.texts)) {
      const texts = body.texts;
      if (!texts.length || texts.length > MAX_TEXTS) return fail(400, `texts ต้องมี 1–${MAX_TEXTS} รายการ`, 'INVALID_TEXT');
      if (!texts.every(t => isText(t) && t.length <= MAX_TEXT_LENGTH)) return fail(400, 'texts ทุกรายการต้องเป็นข้อความไม่ว่าง', 'INVALID_TEXT');
      const results = scoreVersions(texts);
      if (!results.length) return fail(503, 'ยังไม่มีโมเดล (data/viral-score-model.json)', 'MODEL_NOT_AVAILABLE');
      return NextResponse.json({ success: true, count: results.length, results });
    }

    if (!isText(body.text)) return fail(400, 'text ต้องเป็นข้อความไม่ว่าง', 'INVALID_TEXT');
    if (body.text.length > MAX_TEXT_LENGTH) return fail(400, `text ยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร`, 'INVALID_TEXT');
    const result = scoreVersion(body.text);
    if (!result) return fail(503, 'ยังไม่มีโมเดล (data/viral-score-model.json) — รัน node scripts/train-viral-score.mjs ก่อน', 'MODEL_NOT_AVAILABLE');
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return fail(500, error?.message || 'unknown error', 'SCORE_ERROR');
  }
}
