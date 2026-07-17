/**
 * ============================================================
 * 🚪 /api/desk/editor/dispatch — คนเฝ้าประตูห้องรอ บก. AI (P1, 17 ก.ค. 69)
 * ============================================================
 * GET → เรียก dispatchOne({origin}) 1 ครั้งต่อรอบ
 * 🔄 P2 (17 ก.ค. 69 ผู้ใช้สั่งถอดยาม): cron ถูกถอดจาก vercel.json แล้ว — เหลือทางเรียกเดียวคือปุ่ม "↻ เช็คตอนนี้"
 *   (ห้องรอใช้เฉพาะโหมด polite ที่ต้องเลือกเอง — default ใหม่คือ immediate ส่งตรงเข้าคิวปกติ ไม่ผ่านห้องรอ)
 *   คิวเขียนข่าวจริงว่างสนิท (pending===0 && processing===0) → ปล่อย 1 ใบจากห้องรอ บก. เข้าคิวเขียนจริง
 *   คิวไม่ว่าง (มีงานพนักงาน/งานอื่นค้างอยู่) → หยุดปล่อย คืน {held:true} ให้งานพนักงานวิ่งก่อนเสมอ
 * ปุ่ม "↻ เช็คตอนนี้" ใน EditorPanel ก็ยิง route นี้ตรงๆ (GET เดียวกัน) เพื่อเช็คทันทีไม่ต้องรอ cron รอบถัดไป
 * 🔴 ห้ามแตะ /api/queue/** — dispatchOne อ่าน GET /api/queue/status (read-only) เท่านั้น ห้ามเขียน/บายพาส
 * 🔴 ห้าม fire-and-forget — await dispatchOne ให้จบก่อนตอบเสมอ (บทเรียนทีม: Vercel แช่แข็ง runtime หลัง route ตอบ)
 */
import { NextResponse } from 'next/server';
import { dispatchOne } from '@/lib/services/deskV2/editorOutbox.js';
import { sweepDeadWork } from '@/lib/services/deskV2/deskWatchdog.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 🩺 หมอเวร (17 ก.ค. 69): กันเวลาไว้ให้ sweep ท้ายรอบ — งบ = เวลาที่เหลือก่อนชน maxDuration (เผื่อ margin 20s)
const SWEEP_MAX_BUDGET_MS = 45_000;
const ROUTE_SAFE_MS = (300 - 20) * 1000;

export async function GET(request) {
  const t0 = Date.now();
  try {
    const origin = request.nextUrl.origin;
    const result = await dispatchOne({ origin });

    // 🩺 หมอเวรกู้งานตายกลางทาง — พ่วงท้ายทุกรอบ (ปิดได้ด้วย DESK_WATCHDOG=0) · พังห้ามล้มทั้ง route
    let watchdog = null;
    if (process.env.DESK_WATCHDOG !== '0') {
      const budgetMs = Math.min(SWEEP_MAX_BUDGET_MS, ROUTE_SAFE_MS - (Date.now() - t0));
      if (budgetMs > 10_000) {
        try {
          watchdog = await sweepDeadWork({ origin, budgetMs });
        } catch (e) {
          watchdog = { errors: [e?.message || String(e)] };
        }
      }
    }

    return NextResponse.json({ success: true, ...result, watchdog, tookMs: Date.now() - t0 });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'คนเฝ้าประตูห้องรอทำงานล้มเหลว',
      errorType: 'EDITOR_DISPATCH_ERROR',
      tookMs: Date.now() - t0,
    }, { status: 500 });
  }
}
