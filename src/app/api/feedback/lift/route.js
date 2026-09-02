import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runLiftReport } from '@/lib/feedback/liftReport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // คำนวณไม่เกิน 20 วิ (LIFT_TIMEOUT_MS) + เผื่อส่งผล

/**
 * GET /api/feedback/lift?days=60[&threshold=0.4]
 * ★ 2 ก.ย. 69 (ข้อ 5 ป้อนกลับผลจริง): รายงาน lift ต่อ การ์ด/ครู/ความยาว/วิธีเปิด — JSON เดียวกับ scripts/lift-report.mjs
 *   · คำนวณสดจาก store post-metrics + generation_logs (±3 วัน) + viral_pick_history · จำกัดเวลา 20 วิ → 504 LIFT_TIMEOUT
 *   · ด่าน fail-closed: ต้องมี x-admin-key = ADMIN_API_KEY หรือ x-bot-secret = DISCORD_API_SECRET (บอท)
 *     ไม่ตั้ง env ทั้งคู่ = ปฏิเสธเสมอ (แบบเดียวกับ /api/queue/clear) — ห้ามรับกุญแจทาง query string
 */
const LIFT_TIMEOUT_MS = 20000;
const DEFAULT_DAYS = 60;
const MAX_DAYS = 365;

const _clean = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * กุญแจจาก env — trim ทั้งคู่ (ค่า env จริงเคยมีช่องว่าง/ขึ้นบรรทัดท้าย: บอทผ่าน /api/bot/tracking ที่ trim แล้ว แต่จะโดน 403 ที่นี่ถ้าเทียบดิบ
 * — ผู้ตรวจไขว้ 2 ก.ย. 69) · ว่างล้วนหลัง trim = ยังไม่ตั้ง = ปฏิเสธเสมอ (fail-closed)
 */
function _secrets() {
  return { adminKey: _clean(process.env.ADMIN_API_KEY), botSecret: _clean(process.env.DISCORD_API_SECRET) };
}

function _authorized(req) {
  const { adminKey, botSecret } = _secrets();
  const gotAdmin = _clean(req.headers.get('x-admin-key'));
  const gotBot = _clean(req.headers.get('x-bot-secret'));
  if (adminKey && gotAdmin === adminKey) return true;
  if (botSecret && gotBot === botSecret) return true;
  return false;
}

export async function GET(req) {
  try {
    if (!_authorized(req)) {
      const { adminKey, botSecret } = _secrets();
      const configured = !!(adminKey || botSecret);
      return NextResponse.json({
        success: false,
        error: configured ? 'รหัสยืนยันไม่ถูกต้อง' : 'รายงาน lift ถูกล็อก — ตั้ง ADMIN_API_KEY ใน env ก่อนใช้',
        errorType: 'ADMIN_KEY_REQUIRED',
      }, { status: 403 });
    }

    const url = new URL(req.url);
    const rawDays = parseInt(url.searchParams.get('days') || '', 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(MAX_DAYS, rawDays) : DEFAULT_DAYS;
    const rawThreshold = parseFloat(url.searchParams.get('threshold') || '');
    const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 1 ? rawThreshold : undefined;

    const sb = getSupabase();
    if (!sb) {
      return NextResponse.json({ success: false, error: 'ฐานข้อมูลยังไม่พร้อม (Supabase)', errorType: 'NO_DB' }, { status: 503 });
    }

    let timer = null;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`คำนวณรายงาน lift เกิน ${LIFT_TIMEOUT_MS / 1000} วินาที — ลดช่วง days แล้วลองใหม่`);
        err.code = 'LIFT_TIMEOUT';
        reject(err);
      }, LIFT_TIMEOUT_MS);
      if (typeof timer?.unref === 'function') timer.unref();
    });
    let result;
    try {
      result = await Promise.race([runLiftReport({ sb, days, threshold }), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    return NextResponse.json({ success: true, days, ...result.report });
  } catch (error) {
    const isTimeout = error?.code === 'LIFT_TIMEOUT';
    return NextResponse.json({
      success: false,
      error: error?.message || 'unknown error',
      errorType: isTimeout ? 'LIFT_TIMEOUT' : 'LIFT_REPORT_ERROR',
    }, { status: isTimeout ? 504 : 500 });
  }
}
