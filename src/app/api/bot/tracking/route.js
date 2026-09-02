// ============================================================
// 🩹 /api/bot/tracking — สมุดจดงานที่บอทดิสคอร์ดกำลังตามอยู่ (2 ก.ย. 69)
// ------------------------------------------------------------
// ที่มา: บอทบน Railway ถูก redeploy ทุกครั้งที่ main เปลี่ยน · งานที่กำลังวนถาม /api/queue/status
//   ถูกเก็บไว้แค่ในหน่วยความจำของบอท → รีสตาร์ตแล้วข้อความค้าง "1%" ตลอดไป
//   (เกิดจริง 2 ก.ย. 69 03:49Z เคสหลวงปู่ศิลา)
// แก้: บอทลงทะเบียนงานไว้ที่นี่ (store 'bot-tracking' ใน persistStore = Supabase หลัก/ไฟล์สำรอง)
//   → บอทตัวใหม่ตื่นมา GET รายการ แล้วตามต่อ/ปิดงานเก่าให้เอง
// ยืนยันตัวตน: header `x-bot-secret` (หรือ `x-api-key` แบบเดียวกับที่บอทส่งให้ /api/queue/add)
//   ต้องตรงกับ env DISCORD_API_SECRET · ไม่ตั้ง env = ปิดประตูเสมอ (fail-closed)
// ============================================================
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE_NAME = 'bot-tracking';
const MAX_ID_LENGTH = 200;
const MAX_URL_LENGTH = 2000;

function fail(status, error, errorType) {
  return NextResponse.json({ success: false, error, errorType }, { status });
}

// เทียบกุญแจแบบ constant-time (รูปแบบเดียวกับ src/middleware.js)
function secretsMatch(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// คืน response ปฏิเสธถ้าไม่ผ่าน · คืน null ถ้าผ่าน
function checkAuth(req) {
  const expected = typeof process.env.DISCORD_API_SECRET === 'string' ? process.env.DISCORD_API_SECRET.trim() : '';
  if (!expected) {
    return fail(403, 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง DISCORD_API_SECRET — ปิดประตูไว้ก่อน', 'BOT_SECRET_NOT_CONFIGURED');
  }
  // ★ 2 ก.ย. 69 ผู้ตรวจไขว้: trim ฝั่งบอทด้วย — ถ้า API_KEY/DISCORD_API_SECRET มีช่องว่าง/ขึ้นบรรทัดท้าย คิว (/api/queue/add เทียบดิบ) ผ่าน
  //   แต่ที่นี่ตอบ 401 = ฟีเจอร์เงียบทั้งระบบโดยเห็นแค่ warn ใน log Railway
  const given = (req.headers.get('x-bot-secret') || req.headers.get('x-api-key') || '').trim();
  if (!secretsMatch(given, expected)) {
    return fail(401, 'Unauthorized', 'UNAUTHORIZED');
  }
  return null;
}

function isIdString(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function trackingId(jobId) {
  return `bt_${jobId}`;
}

// startedAt รับได้ทั้งเลข ms และ ISO string → เก็บเป็น ISO เสมอ · ไม่ส่งมา = ตอนนี้ · ส่งมาแต่อ่านไม่ออก = null (400)
function normalizeStartedAt(value) {
  if (value === undefined || value === null) return new Date().toISOString();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

// ตรวจชนิดข้อมูลทุกช่อง · ผิดชนิด = คืน error ทันที (ห้ามเก็บของเพี้ยนลงสมุด)
function validateTracking(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body ต้องเป็น JSON object' };
  }
  for (const key of ['jobId', 'channelId', 'messageId']) {
    if (!isIdString(body[key])) return { ok: false, error: `${key} ต้องเป็นข้อความ (ไม่ว่าง ไม่เกิน ${MAX_ID_LENGTH} ตัวอักษร)` };
  }
  const item = {
    jobId: body.jobId.trim(),
    channelId: body.channelId.trim(),
    messageId: body.messageId.trim(),
  };
  // instance = รหัสบอทที่ถืองานอยู่ (hostname_สุ่ม) — บอทตัวใหม่ที่กู้งานจะเขียนทับเป็นของตัวเอง (รับช่วง)
  for (const key of ['guildId', 'userId', 'sourceMessageId', 'instance']) {
    const value = body[key];
    if (value === undefined || value === null) { item[key] = null; continue; }
    if (!isIdString(value)) return { ok: false, error: `${key} ต้องเป็นข้อความ (หรือไม่ส่งมา)` };
    item[key] = value.trim();
  }
  if (body.queueUrl === undefined || body.queueUrl === null) {
    item.queueUrl = null;
  } else if (typeof body.queueUrl === 'string' && body.queueUrl.length <= MAX_URL_LENGTH) {
    item.queueUrl = body.queueUrl;
  } else {
    return { ok: false, error: `queueUrl ต้องเป็นข้อความ (ไม่เกิน ${MAX_URL_LENGTH} ตัวอักษร)` };
  }
  const startedAt = normalizeStartedAt(body.startedAt);
  if (!startedAt) return { ok: false, error: 'startedAt ต้องเป็นเลข ms หรือวันที่ ISO' };
  item.startedAt = startedAt;
  return { ok: true, item };
}

// GET — รายการงานที่ยังเปิดอยู่ทั้งหมด (บอทเรียกตอนตื่น) · ?jobId=… = ดูเฉพาะงานนั้น (บอทเช็คก่อนโพสต์ผลว่ายังเป็นของตัวเอง)
export async function GET(req) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;
    const wanted = new URL(req.url).searchParams.get('jobId');
    const store = createStore(STORE_NAME);
    // ★ 2 ก.ย. 69 ผู้ตรวจไขว้ (high): ต้องอ่านฐานหลักจริง — getAll() ธรรมดามีกติกา "Supabase คืน 0 แถว → ใช้แคชในหน่วยความจำแทน"
    //   สมุดนี้ว่างเป็นปกติ จึงเข้ากติกานั้นตลอด: บน Vercel lambda ที่เคยเห็นงาน J ถือแคช [J] ไว้ แม้ DELETE ไปตกอีก lambda
    //   → บอทตัวใหม่เจอ "งานผี" แล้วโพสต์ผลซ้ำทั้งชุด · authoritative อ่านพัง = throw → catch ด้านล่างคืน 500 → บอท fail-safe เอง
    const all = await store.getAll({ authoritative: true });
    const items = (Array.isArray(all) ? all : [])
      .filter((entry) => entry && isIdString(entry.jobId))
      .filter((entry) => !wanted || entry.jobId === wanted);
    return NextResponse.json({ success: true, count: items.length, items });
  } catch (error) {
    console.error(`[BotTracking] GET error: ${error?.message || error}`);
    return fail(500, `อ่านรายการงานที่ติดตามไม่สำเร็จ: ${error?.message || 'unknown error'}`, 'BOT_TRACKING_READ_ERROR');
  }
}

// POST — upsert 1 งาน {jobId, channelId, messageId, guildId?, userId?, sourceMessageId?, startedAt?, queueUrl?}
export async function POST(req) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;
    let body;
    try {
      body = await req.json();
    } catch {
      return fail(400, 'Invalid JSON body', 'INVALID_JSON');
    }
    const checked = validateTracking(body);
    if (!checked.ok) return fail(400, checked.error, 'VALIDATION_ERROR');

    const store = createStore(STORE_NAME);
    const id = trackingId(checked.item.jobId);
    const now = new Date().toISOString();
    const existing = await store.findById(id);
    let saved;
    let created = false;
    if (existing) {
      saved = await store.update(id, { ...checked.item, id, updatedAt: now });
    } else {
      try {
        saved = await store.add({ id, ...checked.item, createdAt: now, updatedAt: now });
        created = true;
      } catch (addErr) {
        // แข่งกันเขียนพอดี (id ชน) → กลายเป็น update แทน ไม่ให้บอทเห็นเป็นล้ม
        if (!/duplicate key|23505|_pkey|already exists/i.test(String(addErr?.message || ''))) throw addErr;
        saved = await store.update(id, { ...checked.item, id, updatedAt: now });
      }
    }
    return NextResponse.json({ success: true, created, item: saved });
  } catch (error) {
    console.error(`[BotTracking] POST error: ${error?.message || error}`);
    return fail(500, `บันทึกงานที่ติดตามไม่สำเร็จ: ${error?.message || 'unknown error'}`, 'BOT_TRACKING_WRITE_ERROR');
  }
}

// DELETE ?jobId=… — ถอนงานออก (จบ/ล้ม/กู้แล้ว) · ไม่มีอยู่แล้ว = ถือว่าสำเร็จ (idempotent)
export async function DELETE(req) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;
    const jobId = new URL(req.url).searchParams.get('jobId');
    if (!isIdString(jobId)) return fail(400, 'ต้องระบุ jobId เป็นข้อความใน query', 'VALIDATION_ERROR');
    const store = createStore(STORE_NAME);
    let removed = true;
    try {
      await store.remove(trackingId(jobId.trim()));
    } catch (removeErr) {
      if (!/ไม่พบ id/u.test(String(removeErr?.message || ''))) throw removeErr;
      removed = false; // ไม่มีในสมุดอยู่แล้ว
    }
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    console.error(`[BotTracking] DELETE error: ${error?.message || error}`);
    return fail(500, `ถอนงานที่ติดตามไม่สำเร็จ: ${error?.message || 'unknown error'}`, 'BOT_TRACKING_DELETE_ERROR');
  }
}
