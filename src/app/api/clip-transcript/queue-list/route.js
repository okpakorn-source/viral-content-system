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
const FINISHED = ['done', 'error', 'cancelled'];

export async function GET() {
  try {
    const store = createStore('clip-jobs');
    const all = await store.getAll();
    // ★ 26 ส.ค. 69: ส่ง statusNote/lastError/user/cancelledAt ติดไปด้วย (มีในใบงานอยู่แล้ว แต่ไม่เคยส่งออก)
    //   UI ต้องบอกได้ว่าใบไหนติดอะไร ใครส่ง ยกเลิกเมื่อไร — error เต็มไม่ตัด (พิมพ์เขียวข้อ 1)
    const slim = (j) => ({
      id: j.id,
      url: j.url,
      platform: j.platform,
      kind: j.kind || 'insight',
      user: j.user || '',
      status: j.status,
      attempts: j.attempts || 0,
      nextRetryAt: j.nextRetryAt || null,
      statusNote: j.statusNote || '',
      lastError: j.lastError || '',
      createdAt: j.createdAt,
      startedAt: j.startedAt || null,
      doneAt: j.doneAt || null,
      cancelledAt: j.cancelledAt || null,
      error: j.status === 'error' ? String(j.error || '') : '',
    });

    // active เรียงเก่า→ใหม่ (ตัวที่เข้าคิวก่อนอยู่บน)
    const active = all
      .filter((j) => ACTIVE.includes(j.status))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(slim);

    // เสร็จ/ล้ม/ยกเลิก ล่าสุด 6 ชิ้น (ใหม่→เก่า) — ให้เห็นว่าคิวเดินจริง
    //   ★ 26 ส.ค.: รวมใบ cancelled ด้วย (เดิม cancel ลบใบทิ้ง ประวัติหาย)
    const recent = all
      .filter((j) => FINISHED.includes(j.status))
      .sort((a, b) => new Date(b.doneAt || b.cancelledAt || b.createdAt) - new Date(a.doneAt || a.cancelledAt || a.createdAt))
      .slice(0, 6)
      .map(slim);

    const counts = {
      pending: active.filter((j) => j.status === 'pending').length,
      processing: active.filter((j) => j.status === 'processing').length,
      retry_wait: active.filter((j) => j.status === 'retry_wait').length,
      cancelled: all.filter((j) => j.status === 'cancelled').length,
      active: active.length,
    };

    return NextResponse.json({ success: true, counts, active, recent });
  } catch (error) {
    console.error('[ClipQueueList]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
