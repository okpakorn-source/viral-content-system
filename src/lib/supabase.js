/**
 * Supabase Client — ฐานข้อมูลถาวร
 * 
 * ใช้ Supabase (PostgreSQL) เก็บข้อมูลถาวรบน cloud
 * ไม่หายเมื่อ deploy, ไม่มี race condition, รองรับหลาย instance
 */
import { createClient } from '@supabase/supabase-js';

let _supabase = null;

// ── Resilient fetch: กัน Supabase ล่ม (Cloudflare 522) แล้ว request แขวนรอ ~20s จน UI/ท่อค้าง ──
// 🔴 บทเรียน 15 ก.ค.: fail-fast 4s + circuit breaker ใช้ได้เฉพาะ "เครื่องทีม" ที่มี local file ให้
//    fallback จริง — บนคลาวด์ดิสก์เขียนถาวรไม่ได้ พอ Supabase แค่อืดชั่วคราว circuit เปิดแล้ว
//    enqueue ข่าวล้มทั้งหน้าต่างเวลา (Discord ❌ "Failed to add job to queue") → แยกโหมดตามเครื่อง:
//    team  (win32): REST 4s + circuit breaker + half-open probe (พฤติกรรมเดิมที่พิสูจน์บน :3000)
//    cloud (อื่นๆ): REST 15s เท่านั้น — ไม่มี circuit ไม่มีการปัดทิ้งล่วงหน้า งานอืด 2-5s ผ่านเสมอ
//                   15s มีไว้กันเคสล่มจริง (522 แขวน 20s+) ให้ read ตกไป fallback แทนที่จะค้างทั้งเว็บ
//    ⚠️ ห้ามตัดสินเครื่องด้วย env VERCEL — เครื่องทีมมีค่าค้างจาก `vercel env pull` (กับดักที่รู้กัน)
//    สวิตช์ฉุกเฉิน (ตั้งใน Vercel env ได้ ไม่ต้อง deploy ใหม่):
//      SUPABASE_RESILIENCE_MODE=team|cloud|off  (off = fetch เปล่า ไม่มี timeout/circuit เลย)
//      SUPABASE_REST_TIMEOUT_MS=<ms>            (override เพดาน REST ของโหมดที่ใช้อยู่)
const RESILIENCE_MODE = ['team', 'cloud', 'off'].includes(process.env.SUPABASE_RESILIENCE_MODE)
  ? process.env.SUPABASE_RESILIENCE_MODE
  : (process.platform === 'win32' ? 'team' : 'cloud');
const REST_TIMEOUT_MS = Number(process.env.SUPABASE_REST_TIMEOUT_MS) > 0
  ? Number(process.env.SUPABASE_REST_TIMEOUT_MS)
  : (RESILIENCE_MODE === 'team' ? 4000 : 15000);
const STORAGE_TIMEOUT_MS = 60000;   // storage (อัปโหลดรูป) ไฟล์ใหญ่ ให้เวลานานกว่า — เท่ากันทุกโหมด
const BREAKER_ENABLED = RESILIENCE_MODE === 'team'; // 🔴 circuit เปิดได้เฉพาะเครื่องทีมเท่านั้น
const BREAKER_THRESHOLD = 3;        // fail ติดกันครบกี่ครั้งถึงเปิดวงจร (ตัดทุก request ทันที)
const BREAKER_COOLDOWN_MS = 60000;  // เปิดวงจรค้างไว้นานเท่าไรก่อนส่ง "ตัวหยั่งเชิง" ไปลองใหม่

let _consecutiveFails = 0;
let _breakerOpenUntil = 0;
let _breakerTripped = false;   // เคยเปิดวงจรแล้วยังไม่ฟื้น — คุมโหมด half-open
let _probeInFlight = false;    // half-open: ปล่อยหยั่งเชิงทีละตัว ที่เหลือ skip ไป local ต่อ

function _recordFail(reason) {
  _consecutiveFails += 1;
  if (!BREAKER_ENABLED) {
    // cloud: ไม่ตัดวงจรเด็ดขาด — log ไว้วินิจฉัยแล้วปล่อยให้ caller จัดการ error เอง
    console.warn(`[Supabase] ⚠️ request fail (${reason}) — mode=cloud ไม่ตัดวงจร (fail ติดกัน ${_consecutiveFails})`);
    return;
  }
  if (_consecutiveFails >= BREAKER_THRESHOLD && Date.now() >= _breakerOpenUntil) {
    _breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    _breakerTripped = true;
    console.warn(`[Supabase] 🔌 circuit OPEN ${BREAKER_COOLDOWN_MS / 1000}s (fail ติดกัน ${_consecutiveFails} ครั้ง, ล่าสุด: ${reason}) — ใช้ local fallback ชั่วคราว`);
  }
}

function _recordSuccess() {
  _consecutiveFails = 0;
  if (_breakerTripped) {
    _breakerTripped = false;
    _breakerOpenUntil = 0;
    console.log('[Supabase] ✅ circuit CLOSED — ต้นทางกลับมาปกติ ใช้ cloud ตามเดิม');
  }
}

export function resilientFetch(url, options = {}) {
  if (process.env.SUPABASE_DISABLED === '1') {
    return Promise.reject(new Error('[Supabase] disabled via SUPABASE_DISABLED=1'));
  }
  if (RESILIENCE_MODE === 'off') return fetch(url, options); // ทางหนีไฟ: fetch เปล่าเหมือนก่อนมีเกราะ
  if (Date.now() < _breakerOpenUntil) {
    return Promise.reject(new Error('[Supabase] circuit open — skip to local fallback'));
  }
  // half-open: cooldown หมดแล้วแต่ยังไม่พิสูจน์ว่าฟื้น — ปล่อยหยั่งเชิงตัวเดียว กันพายุ timeout ทุก 60s
  let isProbe = false;
  if (_breakerTripped) {
    if (_probeInFlight) {
      return Promise.reject(new Error('[Supabase] circuit half-open (probe in flight) — skip to local fallback'));
    }
    isProbe = true;
    _probeInFlight = true;
  }
  const isStorage = String(url).includes('/storage/v1/');
  const timeoutSignal = AbortSignal.timeout(isStorage ? STORAGE_TIMEOUT_MS : REST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...options, signal })
    .then((res) => {
      // Cloudflare 5xx (520+) = origin ล่ม — นับเป็น fail แต่ส่ง response ต่อให้ client จัดการเอง
      if (res.status >= 500) _recordFail(`HTTP ${res.status}`);
      else _recordSuccess();
      return res;
    })
    .catch((err) => {
      _recordFail(err?.name || String(err));
      throw err;
    })
    .finally(() => {
      if (isProbe) _probeInFlight = false;
    });
}

export function getSupabase() {
  if (process.env.SUPABASE_DISABLED === '1') return null;
  if (_supabase) return _supabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[Supabase] ⚠️ SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
    return null;
  }

  _supabase = createClient(url, key, { global: { fetch: resilientFetch } });
  console.log('[Supabase] ✅ Connected');
  return _supabase;
}

export function isSupabaseReady() {
  if (process.env.SUPABASE_DISABLED === '1') return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && key);
}
