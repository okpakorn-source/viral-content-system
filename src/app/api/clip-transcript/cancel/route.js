import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * POST /api/clip-transcript/cancel  { id }  (27 มิ.ย. — ผู้ใช้สั่ง)
 *   ลบงานคลิปออกจากคิว "จริงๆ" → หยุดถอด/หยุด retry ทันที (ใช้กับลิงก์เสีย/ไม่พบคอนเทนต์ที่วนซ้ำ)
 *   worker หยิบงานจาก store นี้ — พอลบออก = ไม่มีให้หยิบ = หยุดวน
 *   🔴 แตะเฉพาะ store 'clip-jobs' (ระบบถอดประเด็น) — ไม่กระทบระบบทำข่าวอัตโนมัติ
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { id } = await request.json().catch(() => ({}));
    if (!id) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ id' }, { status: 400 });
    }
    const store = createStore('clip-jobs');
    await store.remove(String(id));
    console.log(`[ClipCancel] 🗑️ ลบงานคลิป ${String(id).slice(0, 10)} ออกจากคิว (ผู้ใช้กดลบ — หยุด retry)`);
    return NextResponse.json({ success: true, removed: id });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
