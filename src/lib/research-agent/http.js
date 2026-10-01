// ============================================================
// 🔐 src/lib/research-agent/http.js — ตัวช่วยร่วมของ route /api/research/* (เลน B · 1 ต.ค. 69 · SPEC-v2 ส่วน 2.4)
// ------------------------------------------------------------
// · worker (lease/heartbeat/report): header `x-research-secret` = env RESEARCH_AGENT_SECRET
//     env ไม่ตั้ง = 503 RESEARCH_SECRET_NOT_CONFIGURED (ปิดประตู fail-closed) · ไม่ตรง = 401 RESEARCH_UNAUTHORIZED
//     เทียบแบบ constant-time บน sha256 (แบบ clip-transcript/worker) — ความยาวต่างกันไม่รั่วผ่านเวลา
// · บอท (cards/feedback): ตรวจแบบเดียวกับ /api/bot/tracking — `x-bot-secret` หรือ `x-api-key` (trim) = env DISCORD_API_SECRET
//     env ไม่ตั้ง = 403 BOT_SECRET_NOT_CONFIGURED · ไม่ตรง = 401 UNAUTHORIZED
// · ทุกคำตอบ JSON {success, …} / {success:false, error, errorType} · ห้ามใส่ค่า secret/ข้อความดิบจาก DB ในคำตอบหรือ log
// ============================================================
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getResearchAgentSecret } from '@/lib/research-agent/modes';

export const RESEARCH_SECRET_HEADER = 'x-research-secret';
/** worker รุ่นแรกส่งเวอร์ชันโปรโตคอลทาง header นี้ — สัญญา 1 ต.ค. 69 ย้ายไป body.version (route อ่าน body ก่อน · header สำรอง) */
export const RESEARCH_WORKER_VERSION_HEADER = 'x-research-worker-version';
export const RESEARCH_MAX_BODY_CHARS = 1_000_000;

/** เวอร์ชันโปรโตคอลของ worker: body.version ก่อน (ข้อตัดสิน 1 ต.ค. 69 · contract-check #2) · ไม่มี = header สำรอง · ไม่มีทั้งคู่ = null */
export function workerVersionFrom(req, body) {
  if (typeof body?.version === 'string' && body.version.trim()) return body.version.trim();
  const header = req?.headers?.get?.(RESEARCH_WORKER_VERSION_HEADER);
  return typeof header === 'string' && header.trim() ? header.trim() : null;
}

export function jsonOk(body, status = 200) {
  return NextResponse.json({ success: true, ...body }, { status });
}

export function jsonFail(status, error, errorType, extra = {}) {
  return NextResponse.json({ success: false, error, errorType, ...extra }, { status });
}

const digest = (value) => createHash('sha256').update(String(value ?? ''), 'utf8').digest();

/** เทียบกุญแจแบบ constant-time (ว่าง = ไม่ผ่านเสมอ) */
export function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** ด่าน worker → response ปฏิเสธ หรือ null ถ้าผ่าน */
export function checkWorkerSecret(req, env = process.env) {
  const expected = getResearchAgentSecret(env);
  if (!expected) {
    return jsonFail(503, 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง RESEARCH_AGENT_SECRET — ปิดประตู worker ไว้ก่อน', 'RESEARCH_SECRET_NOT_CONFIGURED');
  }
  const given = (req?.headers?.get?.(RESEARCH_SECRET_HEADER) || '').trim();
  if (!secretMatches(given, expected)) return jsonFail(401, 'Unauthorized', 'RESEARCH_UNAUTHORIZED');
  return null;
}

/** ด่านบอท (แบบเดียวกับ /api/bot/tracking) → response ปฏิเสธ หรือ null ถ้าผ่าน */
export function checkBotKey(req, env = process.env) {
  const expected = typeof env?.DISCORD_API_SECRET === 'string' ? env.DISCORD_API_SECRET.trim() : '';
  if (!expected) {
    return jsonFail(403, 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง DISCORD_API_SECRET — ปิดประตูไว้ก่อน', 'BOT_SECRET_NOT_CONFIGURED');
  }
  const given = (req?.headers?.get?.('x-bot-secret') || req?.headers?.get?.('x-api-key') || '').trim();
  if (!secretMatches(given, expected)) return jsonFail(401, 'Unauthorized', 'UNAUTHORIZED');
  return null;
}

/** อ่าน JSON body แบบจำกัดขนาด → { ok:true, body } | { ok:false, response } */
export async function readJsonBody(req, maxChars = RESEARCH_MAX_BODY_CHARS) {
  let text;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonFail(400, 'Invalid JSON body', 'INVALID_JSON') };
  }
  if (typeof text !== 'string') return { ok: false, response: jsonFail(400, 'Invalid JSON body', 'INVALID_JSON') };
  if (text.length > maxChars) {
    return { ok: false, response: jsonFail(413, `body ใหญ่เกิน ${maxChars} ตัวอักษร`, 'RESEARCH_BODY_TOO_LARGE') };
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, response: jsonFail(400, 'body ต้องเป็น JSON object', 'VALIDATION_ERROR') };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, response: jsonFail(400, 'Invalid JSON body', 'INVALID_JSON') };
  }
}

/** error จาก store → 503 (ฐานใช้ไม่ได้) / 400 (ข้อมูลผิดชนิด) / 500 (อื่นๆ) โดยไม่ส่งข้อความดิบจาก DB */
export function storageErrorResponse(error, fallbackType, fallbackMessage) {
  if (error?.errorType === 'RESEARCH_STORAGE_UNAVAILABLE') {
    return jsonFail(503, 'ที่เก็บข้อมูลรีเสิร์ชใช้ไม่ได้ชั่วคราว — ลองใหม่ภายหลัง', 'RESEARCH_STORAGE_UNAVAILABLE');
  }
  if (error?.code === 'RESEARCH_INVALID_INPUT') return jsonFail(400, String(error.message || 'ข้อมูลไม่ถูกต้อง'), 'VALIDATION_ERROR');
  return jsonFail(500, fallbackMessage, fallbackType);
}
