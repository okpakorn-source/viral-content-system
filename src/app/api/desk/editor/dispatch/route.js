/**
 * ============================================================
 * 🚪 /api/desk/editor/dispatch — คนเฝ้าประตูห้องรอ บก. AI (P1, 17 ก.ค. 69)
 * ============================================================
 * GET → Vercel cron เรียกทุก 1 นาที (ดู vercel.json) — เรียก dispatchOne({origin}) 1 ครั้งต่อรอบ
 *   คิวเขียนข่าวจริงว่างสนิท (pending===0 && processing===0) → ปล่อย 1 ใบจากห้องรอ บก. เข้าคิวเขียนจริง
 *   คิวไม่ว่าง (มีงานพนักงาน/งานอื่นค้างอยู่) → หยุดปล่อย คืน {held:true} ให้งานพนักงานวิ่งก่อนเสมอ
 * ปุ่ม "↻ เช็คตอนนี้" ใน EditorPanel ก็ยิง route นี้ตรงๆ (GET เดียวกัน) เพื่อเช็คทันทีไม่ต้องรอ cron รอบถัดไป
 * 🔴 ห้ามแตะ /api/queue/** — dispatchOne อ่าน GET /api/queue/status (read-only) เท่านั้น ห้ามเขียน/บายพาส
 * 🔴 ห้าม fire-and-forget — await dispatchOne ให้จบก่อนตอบเสมอ (บทเรียนทีม: Vercel แช่แข็ง runtime หลัง route ตอบ)
 */
import { NextResponse } from 'next/server';
import { dispatchOne } from '@/lib/services/deskV2/editorOutbox.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const t0 = Date.now();
  try {
    const origin = request.nextUrl.origin;
    const result = await dispatchOne({ origin });
    return NextResponse.json({ success: true, ...result, tookMs: Date.now() - t0 });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'คนเฝ้าประตูห้องรอทำงานล้มเหลว',
      errorType: 'EDITOR_DISPATCH_ERROR',
      tookMs: Date.now() - t0,
    }, { status: 500 });
  }
}
