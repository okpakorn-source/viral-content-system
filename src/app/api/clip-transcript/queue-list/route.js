import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * GET /api/clip-transcript/queue-list (26 มิ.ย.) — รายการ "คิวคลิป" ทั้งหมดให้ UI โชว์เป็นแผงรวม
 *   คืนงานที่ยัง active (pending/processing/retry_wait) เรียงเก่า→ใหม่ + งานเสร็จ/ล้มล่าสุดไม่กี่ชิ้น
 *   ผู้ใช้เห็นภาพรวมว่ามีกี่คลิปรออยู่ · ตัวไหนกำลังลองใหม่ (Gemini แน่น) · ตัวไหนเสร็จแล้ว
 *   🔴 อ่านอย่างเดียวจาก store 'clip-jobs' — ไม่แตะระบบทำข่าวอัตโนมัติ
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVE = ['pending', 'processing', 'retry_wait'];

export async function GET() {
  try {
    const store = createStore('clip-jobs');
    const all = await store.getAll();
    const slim = (j) => ({
      id: j.id,
      url: j.url,
      platform: j.platform,
      kind: j.kind,
      status: j.status,
      attempts: j.attempts || 0,
      nextRetryAt: j.nextRetryAt || null,
      createdAt: j.createdAt,
      doneAt: j.doneAt || null,
      error: j.status === 'error' ? String(j.error || '').slice(0, 140) : '',
    });

    // active เรียงเก่า→ใหม่ (ตัวที่เข้าคิวก่อนอยู่บน)
    const active = all
      .filter((j) => ACTIVE.includes(j.status))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(slim);

    // เสร็จ/ล้ม ล่าสุด 6 ชิ้น (ใหม่→เก่า) — ให้เห็นว่าคิวเดินจริง
    const recent = all
      .filter((j) => j.status === 'done' || j.status === 'error')
      .sort((a, b) => new Date(b.doneAt || b.createdAt) - new Date(a.doneAt || a.createdAt))
      .slice(0, 6)
      .map(slim);

    const counts = {
      pending: active.filter((j) => j.status === 'pending').length,
      processing: active.filter((j) => j.status === 'processing').length,
      retry_wait: active.filter((j) => j.status === 'retry_wait').length,
      active: active.length,
    };

    return NextResponse.json({ success: true, counts, active, recent });
  } catch (error) {
    console.error('[ClipQueueList]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
