/**
 * ============================================================
 * 🎬 /api/desk/editor/flush-clips — ตัวปิดวงจรคลิปของ บก. (18 ก.ค. 69, แก้บัค audit #2)
 * ============================================================
 * GET → ไล่เช็คลีดคลิปที่รอถอด (clipJobRef) → งานถอด done จริง → แนบเนื้อ+กลั่น+ส่งเข้าคิวเขียนอัตโนมัติ
 * ผู้เรียก: cron ทุก 2 นาที (vercel.json) + ปุ่ม "↻ เช็ค+ส่งตอนนี้" ใน EditorPanel
 * ต่างจาก /api/desk/editor/dispatch (ห้องรอโหมด polite — กดปล่อยเอง): route นี้จัดการเฉพาะ
 * "คลิปที่ผ่านการคัด/กดส่งมาแล้วแต่ติดรอถอด" ไม่ตัดสินใจเลือกข่าวแทน บก. และไม่แตะห้องรอ
 * 🔴 kill-switch: DESK_CLIP_FLUSH=0 (ปิดใน service — คืน disabled)
 */
import { NextResponse } from 'next/server';
import { flushReadyClips } from '@/lib/services/deskV2/clipFlush.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // งบจริงใน service = 240s + margin ตอบกลับ

export async function GET(request) {
  try {
    const result = await flushReadyClips({ origin: request.nextUrl.origin });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'flush คลิปล้มเหลว',
      errorType: 'CLIP_FLUSH_ERROR',
    }, { status: 500 });
  }
}
