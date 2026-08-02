/**
 * News Desk Harvest — สั่งเก็บ+คัดกรองข่าวรอบใหม่
 * POST { lanes?: ['trend','good'], judgeTop?: 24 }
 * GET  → เหมือน POST (รองรับ Vercel Cron ภายหลัง)
 */
import { NextResponse } from 'next/server';
import { deskPipelineOff, deskOffPayload } from '@/lib/deskPipelineGate'; // 🛑 31 ก.ค. 69: สวิตช์ปิดโต๊ะข่าวชั่วคราว (เจ้าของสั่ง)
import { createStore } from '@/lib/persistStore'; // ⚠️ P8: นับข่าวค้างคลังก่อนล่ารอบใหม่
import { runHarvest, pruneOldItems } from '@/lib/services/newsDesk/harvester';
import { HARVEST_MODES } from '@/lib/services/newsDesk/taxonomy'; // ★ เฟส 5: โหมดหาข่าว

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // harvest + auto-research ตัวท็อป 3 ใบ

// ★ 26 มิ.ย. (เย็น) เปิดคืน: ปรับสมองคัด "ทำใหม่ได้ (remakeable)" บังคับทุกแหล่งแล้ว → หาข่าวที่ใช้ได้จริง
//   (คืน cron ใน vercel.json แล้ว) · 🔴 ไม่กระทบระบบทำข่าวอัตโนมัติ/ถอดประเด็น/ทำปก
const HARVEST_PAUSED = false;
const pausedResponse = () => NextResponse.json({
  success: false, paused: true,
  error: 'ระบบหาข่าวใหม่พักชั่วคราว (พัก API ระหว่างปรับปรุงคุณภาพข่าว) — ข่าวเดิมในโต๊ะยังใช้ได้ปกติ',
  errorType: 'HARVEST_PAUSED',
}, { status: 200 });

// กันเก็บซ้อนกัน — เครื่องหนึ่งเก็บทีละรอบ
let _harvestLock = Promise.resolve();

async function doHarvest(opts) {
  const prev = _harvestLock;
  let release;
  _harvestLock = new Promise((r) => (release = r));
  await prev;
  try {
    await pruneOldItems(12); // 19 มิ.ย. (เก็บกว้าง): ยืด 3→12 วัน ให้สอดคล้องเพดานเก็บข่าวใหม่
    const stats = await runHarvest(opts);
    return NextResponse.json({ success: true, ...stats });
  } finally {
    release();
  }
}

// ============================================================
// ⚠️ P8 (2 ส.ค. 69 — เจ้าของสั่ง): เตือนก่อนล่ารอบใหม่ ถ้าของเก่ายังไม่ได้ใช้
// ------------------------------------------------------------
// ที่มา: "รีเฟรช/ล่าเองไปเรื่อยๆ บางครั้งยังไม่ได้เอาข่าวรอบก่อนมาใช้ เปลืองโทเคน+เสียโอกาส"
// หลักฐาน: คลังมีข่าว status='new' ที่ไม่มีใครแตะ 810 ใบ · ใช้จริงแค่ 1.4%
// กติกา: ค้างเกินเกณฑ์ (DESK_UNUSED_WARN, default 200) และไม่ยืนยัน → ไม่ล่า คืน 409
//        ยืนยัน (confirm) → ล่าตามปกติทุกอย่างเหมือนเดิม · DESK_UNUSED_WARN=0 → ปิดด่านนี้
// 🔴 นับไม่ได้/คลังพัง = ปล่อยผ่าน (fail-open) — ด่านเตือนห้ามทำให้ล่าข่าวพัง
// 🔴 ไม่แตะ logic การล่าเดิมแม้บรรทัดเดียว — เป็นด่านหน้าล้วน (อยู่หลัง deskPipelineOff เสมอ)
// ============================================================
const UNUSED_WARN_DEFAULT = 200;

function unusedWarnThreshold(env = process.env) {
  const raw = String(env?.DESK_UNUSED_WARN ?? '').trim();
  if (raw === '') return UNUSED_WARN_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return UNUSED_WARN_DEFAULT; // ค่าเพี้ยน = ใช้ค่าเริ่มต้น (ไม่เงียบปิดด่าน)
  return n;
}

/** ข่าวที่ "ยังไม่มีใครแตะ" — สถานะ new และไม่ถูก claim/ส่ง/ใช้/เข้าคลังส่งเช้า */
function isUntouchedDeskItem(it) {
  return !!it
    && it.status === 'new'
    && !it.claimedBy && !it.claimedAt
    && !it.sentAt
    && !it.used && !it.usedAt
    && !it.shortlisted;
}

async function countUnusedDeskItems() {
  const items = await createStore('news-desk').getAll();
  if (!Array.isArray(items)) throw new Error('รูปแบบคลังข่าวไม่ถูกต้อง');
  return items.filter(isUntouchedDeskItem).length;
}

function isConfirmed(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function queryConfirmed(request) {
  try {
    const sp = request?.nextUrl?.searchParams || new URL(request.url).searchParams;
    return isConfirmed(sp.get('confirm'));
  } catch { return false; }
}

/** ห่อ request ให้ .json() คืนเนื้อที่อ่านไว้แล้ว (สตรีม body อ่านได้ครั้งเดียว) — ของอื่นส่งต่อตามเดิม */
function _requestWithBody(request, body) {
  if (!request || typeof request !== 'object') return request;
  try {
    return new Proxy(request, {
      get(target, prop) {
        if (prop === 'json') return async () => body;
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  } catch { return request; }
}

/**
 * แอบอ่าน body เพื่อเช็ค confirm โดยไม่ทำให้ handleHarvest อ่านต่อไม่ได้
 * คืน { body, request } — request ที่ต้องส่งต่อ (การันตีว่า .json() ยังได้เนื้อเดิม)
 */
async function peekHarvestBody(request) {
  if (typeof request?.clone === 'function') {
    try {
      const body = await request.clone().json();
      return { body: body || {}, request }; // ต้นฉบับยังไม่ถูกแตะ → ส่งต่อได้ตรงๆ
    } catch {
      return { body: {}, request }; // clone/parse พลาด = ถือว่าไม่ยืนยัน · ต้นฉบับยังสมบูรณ์
    }
  }
  try {
    const body = (await request.json()) || {};
    return { body, request: _requestWithBody(request, body) };
  } catch {
    return { body: {}, request: _requestWithBody(request, {}) };
  }
}

/** คืน response 409 ถ้าต้องกั้น · คืน null = ปล่อยล่าตามปกติ */
async function unusedBacklogBlock(confirmed) {
  const threshold = unusedWarnThreshold();
  if (threshold <= 0) return null;  // DESK_UNUSED_WARN=0 → ปิดด่านนี้ทั้งหมด
  if (confirmed) return null;       // ผู้เรียกยืนยันแล้ว → ล่าเหมือนเดิมทุกอย่าง
  let unusedCount;
  try {
    unusedCount = await countUnusedDeskItems();
  } catch (e) {
    console.warn('[NewsDesk Harvest] นับข่าวค้างคลังไม่ได้ — ปล่อยผ่าน (fail-open):', e?.message);
    return null; // 🔴 fail-open: ด่านเตือนพังห้ามทำให้ล่าข่าวพัง
  }
  if (!(unusedCount > threshold)) return null;
  return NextResponse.json({
    success: false,
    errorType: 'DESK_UNUSED_BACKLOG',
    unusedCount,
    threshold,
    error: `มีข่าวเก่ายังไม่ได้ใช้ ${unusedCount} ใบ — ใช้ของเดิมก่อนหรือยืนยันเพื่อล่าใหม่`,
    hint: 'ส่ง confirm:true (POST) หรือ ?confirm=1 (GET) เพื่อล่าต่อ',
  }, { status: 409 });
}

export async function POST(request) {
  // 🛑 31 ก.ค. 69 (เจ้าของสั่งปิดโต๊ะข่าวชั่วคราว ไม่ให้กินโทเคน) — จุดนี้เผาเงินจริง (LLM/Serper/คิวเขียน) · เปิดคืน: DESK_PIPELINE=1
  if (deskPipelineOff()) return NextResponse.json(deskOffPayload(), { status: 503 });
  // ⚠️ P8: ของเก่าค้างคลังเยอะ + ไม่ยืนยัน → ไม่ล่า (อยู่หลังสวิตช์ปิดท่อเสมอ)
  const peeked = await peekHarvestBody(request);
  const blocked = await unusedBacklogBlock(isConfirmed(peeked.body?.confirm));
  if (blocked) return blocked;
  return handleHarvest(peeked.request, false);
}

async function handleHarvest(request, isCron) {
  if (HARVEST_PAUSED) return pausedResponse(); // ★ พักหาข่าวใหม่ชั่วคราว
  try {
    const body = await request.json().catch(() => ({}));
    // ★ เฟส 5 (29 มิ.ย.): โหมดหาข่าว — แต่ละโหมด = ชุดเลนคนละแบบ (ทุกรีเฟรชสำรวจพื้นที่ใหม่ ไม่วนเดิม)
    if (body.mode) {
      const m = HARVEST_MODES.find(x => x.key === body.mode);
      if (m) return await doHarvest({ lanes: m.lanes, judgeTop: Math.min(40, Number(body.judgeTop) || 24) });
    }
    // ★ 17 มิ.ย. (ทีมขอ): ค้นด้วย "คีย์เวิร์ดคน/เรื่อง" เอง (เผื่อปิ๊งไอเดีย) เช่น "ลิซ่า" / "ดารากตัญญู" / "หมูเด้ง"
    if (body.keyword && String(body.keyword).trim().length >= 2) {
      const kw = String(body.keyword).trim().slice(0, 60);
      const _searchedAt = new Date().toISOString();
      const qs = [
        { q: `${kw} ล่าสุด`, lane: 'trend', timeRange: 'qdr:w', endpoint: 'news' },          // สด
        { q: `${kw} ข่าว ประเด็น`, lane: 'celeb', timeRange: 'qdr:m', endpoint: 'search' },   // กว้าง
        { q: `${kw} ช่วยเหลือ ทำดี บริจาค กตัญญู`, lane: 'good', timeRange: 'qdr:y', endpoint: 'search' }, // น้ำดี/อมตะ
        { q: `${kw} สัมภาษณ์ เปิดใจ`, lane: 'celeb', timeRange: 'qdr:y', endpoint: 'search' }, // สัมภาษณ์
      ];
      return await doHarvest({
        lanes: [],
        extraQueries: qs.map(f => ({ ...f, tag: { focusTag: `🔎 ${kw}`, searchedAt: _searchedAt } })),
        judgeTop: Math.min(40, Number(body.judgeTop) || 20),
      });
    }
    // ★ สั่งหาเฉพาะแนว (15 มิ.ย.): focus → คำค้นเฉพาะแนวนั้น → harvest แค่แนวนั้น (judge ได้ลึกขึ้นเพราะคำน้อย)
    if (body.focus) {
      const { generateFocusQueries } = await import('@/lib/services/newsDesk/goodNewsScout');
      // ★ 20 มิ.ย. (ผู้ใช้สั่ง): ยิงลึก ~30 คีย์/คลิก (เดิม 8) → ข่าวเยอะ+ครอบคลุมแนว
      const fq = generateFocusQueries(body.focus, Number(body.count) || 30);
      if (!fq.length) {
        return NextResponse.json({ success: false, error: 'ไม่รู้จักแนวที่สั่ง', errorType: 'UNKNOWN_FOCUS' }, { status: 400 });
      }
      // ★ 16 มิ.ย.: ติดป้าย focusTag + searchedAt → ผลค้นไปรวมในแท็บ "🎯 ผลค้นหา" (กลับมาดูได้ ไม่หาย)
      const _searchedAt = new Date().toISOString();
      return await doHarvest({
        lanes: [],
        extraQueries: fq.map(f => ({ q: f.q, lane: f.lane, timeRange: f.timeRange, endpoint: f.endpoint, tag: { focusTag: body.focus, searchedAt: _searchedAt } })),
        judgeTop: Math.min(60, Number(body.judgeTop) || 36),
      });
    }
    // ★ 3 ก.ค. (+แก้ 4 ก.ค. — บัค "กดหาใหม่แล้วเหมือนไม่หา"): รอบหนัก/เบาสลับ ใช้กับ "cron (GET)" เท่านั้น
    //   คนกดปุ่มบนหน้า (POST) = ตั้งใจสั่งหา → หาเต็มทุกเลนเสมอ ไม่โดนลดรอบ
    const HEAVY_LANES = ['trend', 'good', 'broad', 'exa', 'clip', 'evergreen', 'buzz', 'saga', 'entrss', 'ytwatch', 'followup'];
    const LIGHT_LANES = ['trend', 'saga', 'buzz', 'entrss', 'ytwatch', 'followup'];
    const _cronLight = isCron && new Date().getHours() % 3 !== 0;
    return await doHarvest({
      lanes: Array.isArray(body.lanes) && body.lanes.length ? body.lanes : (_cronLight ? LIGHT_LANES : HEAVY_LANES),
      judgeTop: Math.min(40, Number(body.judgeTop) || 24),
    });
  } catch (error) {
    console.error('[NewsDesk Harvest]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'HARVEST_ERROR' }, { status: 500 });
  }
}

export async function GET(request) {
  // 🛑 31 ก.ค. 69 (ผู้ตรวจรอบ 2 จับได้ว่า GET หลุด): เส้น cron ล่าข่าว = Serper+LLM เต็มๆ — ปิดเท่า POST
  //    เปิดคืน: DESK_PIPELINE=1
  if (deskPipelineOff()) return NextResponse.json(deskOffPayload(), { status: 503 });
  // ⚠️ P8: cron/รีเฟรชเองก็ต้องผ่านด่านเดียวกัน — ยืนยันด้วย ?confirm=1
  const blocked = await unusedBacklogBlock(queryConfirmed(request));
  if (blocked) return blocked;
  return handleHarvest(request, true); // cron — สลับรอบหนัก/เบาได้ (ประหยัด Serper)
}
