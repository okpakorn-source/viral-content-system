// ============================================================
// 🧾 /api/bot/posted — สมุดถาวร "บอทโพสต์ผลงานนี้ไว้ที่ข้อความไหน" (Research Agent v2 · เฟส 1 · เลน C · 1 ต.ค. 69)
// ------------------------------------------------------------
// ที่มา (SPEC-v2 ส่วน 2.3 + ส่วน 7): บัตรข้อเท็จจริงของเอเจนต์ค้นคว้าอาจมาถึง "หลัง" บอทโพสต์ผลข่าวแล้ว
//   แต่สมุด /api/bot/tracking ถูกถอนตอนงานจบ และแถวคิว job_queue ถูก purge ใน 30 นาที → ไม่มีที่ถาวรจำ jobId → ข้อความ Discord
//   → บอทจดที่นี่ตอนโพสต์บัตร/โพสต์ผล · บอททุก instance เช็คที่นี่ก่อนโพสต์บัตร (กันโพสต์ซ้ำช่วง redeploy ทับกัน)
// ★ r3 1 ต.ค. 69 (ข้อตัดสินผู้คุมงาน · contract-check mismatch #4): bot-posted มีนิยามเดียว = ของเลน B
//   route นี้เป็นแค่ประตู HTTP ของบอท → saveBotPosted / getBotPosted ของ src/lib/research-agent/store.js (เลน B)
//   ไม่แตะ persistStore ตรงอีกแล้ว (เดิมเขียนแถว "bp_<jobId>" เอง = สองนิยามใน store เดียว หาแถวของกันและกันไม่เจอ)
//   แถว store_items: id "bposted_<jobId>" (มีคำนำหน้าเพราะ store_items.id เป็น PK ทั้งตาราง — jobId ตรงๆ ชนแถวคิว job_queue)
//   · data.id = jobId ตามสัญญา 2.3 · revision +1 ทุกครั้งที่เปลี่ยน (cas) · ไม่มีโหมดไฟล์สำรอง (Supabase ไม่พร้อม = 503)
// รับ (สัญญา 2.3): { jobId, channelId, sourceMessageId?, processingMsgId?, resultMsgIds[]?, caseId?, researchCardMsgId?, postedAt? }
//   ตรวจชนิดเข้มที่นี่ (ผิด = 400 ไม่ส่งต่อ) ให้ "ที่ route รับ = ที่ store เก็บ" — store ของ B ทิ้งค่าที่ไม่ผ่านแบบเงียบ
//   · id ทุกช่อง = [A-Za-z0-9_-]{1,100} (เท่ากับ RESEARCH_JOB_ID_RE / DISCORD_ID_RE ของเลน B)
//   · resultMsgIds ≤ 50 (= BOT_POSTED_MAX_RESULT_MSG_IDS ของเลน B · บอทส่งไม่เกินนี้) · ซ้ำ = ตัดเหลือตัวเดียว
//   · caseId = ข้อความ ไม่บังคับเป็นเลข (ข้อตัดสินผู้คุมงาน · store เลน B รับข้อความเช่นกัน) — ของจริงเป็นเลขเติมศูนย์เช่น "05268"
//     route ไม่รับ caseId ที่เป็น number (กันเลขศูนย์นำหน้าหายระหว่างทาง)
//   · postedAt = เลข ms หรือ ISO → ส่งต่อเป็น ISO (store เก็บตามที่ส่ง · แถวใหม่ที่ยังไม่ส่ง = null · createdAt = ครั้งแรกที่จด)
//   · POST ซ้ำ = รวมกับแถวเดิม (ช่องที่ไม่ส่งคงค่าเดิม) · ช่องที่ไม่รู้จักไม่ส่งต่อ · null = 400 (store ล้างค่าไม่ได้)
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.2 · เลน W2): + editorMsgId? (ข้อความ "ใบที่สอง" = ผลบรรณาธิการ)
//   กติกาเดียวกับช่อง id อื่น · additive: ไม่ส่ง = คำขอ/คำตอบเดิมทุกไบต์ · store (saveBotPosted) เก็บช่องนี้ด้วย (แก้คู่กันในรอบเดียวกัน)
// ยืนยันตัวตน: header x-bot-secret (หรือ x-api-key แบบที่บอทส่งให้ /api/queue/add) ต้องตรง env DISCORD_API_SECRET
//   ไม่ตั้ง env = ปิดประตูเสมอ (fail-closed) — กติกาเดียวกับ /api/bot/tracking · ไม่ผ่านด่าน/ข้อมูลผิด = ไม่โหลด store เลย
// error: store ใช้ไม่ได้ (ResearchStorageError) = 503 RESEARCH_STORAGE_UNAVAILABLE · store ว่าข้อมูลผิด (RESEARCH_INVALID_INPUT) = 400
//   · อื่นๆ = 500 BOT_POSTED_READ_ERROR / BOT_POSTED_WRITE_ERROR · ไม่ส่งข้อความดิบกลับ (บอทแค่ warn แล้วไปต่อ = ข่าวไม่สะดุด)
// ไม่มีสวิตช์ฝั่งเว็บ: route นี้ถูกเรียกเฉพาะเมื่อบอทเปิด RESEARCH_AGENT=1 (ปิด = ไม่มีใครเรียก = ระบบเดิมทุกไบต์)
// ⚠️ รวมเลน: ไฟล์นี้ import store ของเลน B — ต้องรวมพร้อม/หลังเลน B (ไม่งั้น next build หาโมดูลไม่เจอ)
// ============================================================
import { NextResponse } from 'next/server';
import { loadResearchStorage } from '@/lib/research-agent/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_RESULT_MSG_IDS = 50; // = BOT_POSTED_MAX_RESULT_MSG_IDS ของเลน B = MAX_RESULT_MSG_IDS ของบอท (discord-bot/researchCard.js)
const OPTIONAL_ID_KEYS = ['sourceMessageId', 'processingMsgId', 'caseId', 'researchCardMsgId'];
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.2 · W2): ใบที่สอง (ผลบรรณาธิการ) — บอทจด id ข้อความไว้กันโพสต์ซ้ำหลังรีสตาร์ต
//   แยกรายการ (ไม่แก้บรรทัดเดิม) · ผ่านด่าน id เดียวกับช่องอื่น
const EDITOR_ID_KEYS = ['editorMsgId'];
const ID_RULE = '[A-Za-z0-9_-] ยาว 1–100 ตัวอักษร';

function fail(status, error, errorType) {
  return NextResponse.json({ success: false, error, errorType }, { status });
}

// เทียบกุญแจแบบ constant-time (รูปแบบเดียวกับ src/middleware.js และ /api/bot/tracking)
function secretsMatch(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// คืน response ปฏิเสธถ้าไม่ผ่าน · คืน null ถ้าผ่าน (trim ทั้งสองฝั่ง — env บน Vercel/Railway มักมีขึ้นบรรทัดท้าย)
function checkAuth(req) {
  const expected = typeof process.env.DISCORD_API_SECRET === 'string' ? process.env.DISCORD_API_SECRET.trim() : '';
  if (!expected) {
    return fail(403, 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง DISCORD_API_SECRET — ปิดประตูไว้ก่อน', 'BOT_SECRET_NOT_CONFIGURED');
  }
  const given = (req.headers.get('x-bot-secret') || req.headers.get('x-api-key') || '').trim();
  if (!secretsMatch(given, expected)) {
    return fail(401, 'Unauthorized', 'UNAUTHORIZED');
  }
  return null;
}

function trimmedId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return ID_RE.test(text) ? text : null;
}

// postedAt รับเลข ms หรือ ISO → ISO เสมอ · อ่านไม่ออก = null (ผู้เรียกตอบ 400)
function normalizeTime(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

// body → input ของ saveBotPosted (เฉพาะช่องที่ส่งมา) · ผิดชนิด = error ทันที (ห้ามส่งของเพี้ยนให้ store ทิ้งเงียบ)
function validatePosted(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body ต้องเป็น JSON object' };
  }
  const input = {};
  for (const key of ['jobId', 'channelId']) {
    const id = trimmedId(body[key]);
    if (!id) return { ok: false, error: `${key} ต้องเป็นข้อความ ${ID_RULE}` };
    input[key] = id;
  }
  // ★ 1 ต.ค. 69 (SPEC-v3 · W2): + EDITOR_ID_KEYS · ของเดิม: for (const key of OPTIONAL_ID_KEYS) {
  for (const key of [...OPTIONAL_ID_KEYS, ...EDITOR_ID_KEYS]) {
    if (!Object.hasOwn(body, key)) continue;
    const id = trimmedId(body[key]);
    if (!id) return { ok: false, error: `${key} ต้องเป็นข้อความ ${ID_RULE} (หรือไม่ส่งมา)` };
    input[key] = id;
  }
  if (Object.hasOwn(body, 'resultMsgIds')) {
    const list = body.resultMsgIds;
    const ids = Array.isArray(list) ? list.map(trimmedId) : [];
    if (!Array.isArray(list) || list.length > MAX_RESULT_MSG_IDS || ids.some((id) => !id)) {
      return { ok: false, error: `resultMsgIds ต้องเป็น array ของ id (${ID_RULE} · ไม่เกิน ${MAX_RESULT_MSG_IDS} รายการ)` };
    }
    input.resultMsgIds = [...new Set(ids)];
  }
  if (Object.hasOwn(body, 'postedAt')) {
    const postedAt = normalizeTime(body.postedAt);
    if (!postedAt) return { ok: false, error: 'postedAt ต้องเป็นเลข ms หรือวันที่ ISO' };
    input.postedAt = postedAt;
  }
  return { ok: true, input };
}

// error จาก store ของเลน B → คำตอบ (ไม่ส่งข้อความดิบกลับ · log แค่ชนิด/ข้อความสั้นของ error ที่ไม่ใช่ฐานล่ม)
function storageFail(error, method, fallbackType, fallbackMessage) {
  if (error?.errorType === 'RESEARCH_STORAGE_UNAVAILABLE') {
    console.warn(`[BotPosted] ${method} ล้ม: RESEARCH_STORAGE_UNAVAILABLE`);
    return fail(503, 'ที่เก็บข้อมูลรีเสิร์ชใช้ไม่ได้ชั่วคราว — ลองใหม่ภายหลัง', 'RESEARCH_STORAGE_UNAVAILABLE');
  }
  if (error?.code === 'RESEARCH_INVALID_INPUT') {
    console.warn(`[BotPosted] ${method} ข้อมูลไม่ผ่าน store: ${String(error.message || '').slice(0, 120)}`);
    return fail(400, 'ข้อมูลไม่ถูกต้องตามที่เก็บ bot-posted', 'VALIDATION_ERROR');
  }
  console.error(`[BotPosted] ${method} error: ${error?.name || 'Error'} ${String(error?.message || error || '').slice(0, 160)}`);
  return fail(500, fallbackMessage, fallbackType);
}

// GET ?jobId=… — อ่านแถวของงานเดียว (บอทเช็คก่อนโพสต์บัตรว่ามีใครโพสต์ไปแล้วหรือยัง) · ไม่มี = item:null
export async function GET(req) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;
    const jobId = trimmedId(new URL(req.url).searchParams.get('jobId'));
    if (!jobId) return fail(400, `ต้องระบุ jobId (${ID_RULE}) ใน query`, 'VALIDATION_ERROR');
    const storage = await loadResearchStorage();
    const item = await storage.getBotPosted(jobId);
    return NextResponse.json({ success: true, item: item || null });
  } catch (error) {
    return storageFail(error, 'GET', 'BOT_POSTED_READ_ERROR', 'อ่านบันทึกการโพสต์ไม่สำเร็จ');
  }
}

// POST — upsert 1 งานผ่าน saveBotPosted ของเลน B (รวมกับแถวเดิม · cas) → { success, item: เอกสารล่าสุด (มี revision) }
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
    const checked = validatePosted(body);
    if (!checked.ok) return fail(400, checked.error, 'VALIDATION_ERROR');
    const storage = await loadResearchStorage();
    const item = await storage.saveBotPosted(checked.input);
    return NextResponse.json({ success: true, item });
  } catch (error) {
    return storageFail(error, 'POST', 'BOT_POSTED_WRITE_ERROR', 'บันทึกการโพสต์ไม่สำเร็จ');
  }
}
