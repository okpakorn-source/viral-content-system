/**
 * Supabase Client — ฐานข้อมูลถาวร
 * 
 * ใช้ Supabase (PostgreSQL) เก็บข้อมูลถาวรบน cloud
 * ไม่หายเมื่อ deploy, ไม่มี race condition, รองรับหลาย instance
 */
import { createClient } from '@supabase/supabase-js';

let _supabase = null;

// ── Resilient fetch: กัน Supabase ล่ม (Cloudflare 522) แล้วทุก request แขวนรอ ~20s จน UI ค้าง ──
// query ปกติเสร็จใน <1s — เกิน 6s ถือว่าผิดปกติ ตัดทิ้งให้ store ไป fallback local file ทันที
// ส่วน storage (อัปโหลดรูป) ให้เวลานานกว่าเพราะไฟล์ใหญ่
const REST_TIMEOUT_MS = 4000;
const STORAGE_TIMEOUT_MS = 60000;
const BREAKER_THRESHOLD = 3;        // fail ติดกันครบกี่ครั้งถึงเปิดวงจร (ตัดทุก request ทันที)
const BREAKER_COOLDOWN_MS = 60000;  // เปิดวงจรค้างไว้นานเท่าไรก่อนส่ง "ตัวหยั่งเชิง" ไปลองใหม่

let _consecutiveFails = 0;
let _breakerOpenUntil = 0;
let _breakerTripped = false;   // เคยเปิดวงจรแล้วยังไม่ฟื้น — คุมโหมด half-open
let _probeInFlight = false;    // half-open: ปล่อยหยั่งเชิงทีละตัว ที่เหลือ skip ไป local ต่อ

function _recordFail(reason) {
  _consecutiveFails += 1;
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
