import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * ★ 19 มิ.ย. (ผู้ใช้): สถานะคิวสกัดข่าวแบบเรียลไทม์ — พนักงานหลายคนใช้พร้อมกัน เห็นว่าคิวเหลือเท่าไหร่
 * GET → { processing, queued }  (หน้าเว็บ poll ทุก ~2.5 วิ มาโชว์ตัวเลข)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = createStore('news-filter-queue');
    const all = await store.getAll();
    const cut = Date.now() - 120000; // งานค้างเกิน 2 นาที = ถือว่าหลุด ไม่นับ
    const live = all.filter(j => new Date(j.startedAt || j.queuedAt || 0).getTime() >= cut);
    return NextResponse.json({
      success: true,
      processing: live.filter(j => j.status === 'processing').length,
      queued: live.filter(j => j.status === 'queued').length,
    });
  } catch (error) {
    return NextResponse.json({ success: false, processing: 0, queued: 0 });
  }
}
