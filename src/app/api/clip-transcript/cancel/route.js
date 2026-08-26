import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * POST /api/clip-transcript/cancel  { id }  (27 มิ.ย. — ผู้ใช้สั่ง)
 *   ยกเลิกงานคลิป → หยุดถอด/หยุด retry ทันที (ใช้กับลิงก์เสีย/ไม่พบคอนเทนต์ที่วนซ้ำ)
 *   ★ 26 ส.ค. 69: เดิม "ลบใบทิ้ง" ทำให้ประวัติหาย → เปลี่ยนเป็นตั้งสถานะ 'cancelled' + ล้าง lease
 *     ใบยกเลิกไม่เข้าเงื่อนไข claim ของ worker (pending/retry_wait/processing เท่านั้น) = ไม่ถูกหยิบต่อ
 *   🔴 แตะเฉพาะ store 'clip-jobs' (ระบบถอดประเด็น) — ไม่กระทบระบบทำข่าวอัตโนมัติ
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FINISHED = ['done', 'error', 'cancelled'];

export async function POST(request) {
  try {
    const { id } = await request.json().catch(() => ({}));
    if (!id) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'MISSING_ID' }, { status: 400 });
    }
    const store = createStore('clip-jobs');
    const job = await store.findById(String(id));
    if (!job) {
      return NextResponse.json({
        success: false,
        error: 'ไม่พบงานในคิว (อาจถูกล้างไปแล้ว)',
        errorType: 'JOB_NOT_FOUND',
      }, { status: 404 });
    }
    if (FINISHED.includes(job.status)) {
      return NextResponse.json({
        success: false,
        error: 'งานจบไปแล้ว ยกเลิกไม่ได้',
        errorType: 'JOB_ALREADY_FINISHED',
      }, { status: 400 });
    }
    const nowIso = new Date().toISOString();
    await store.update(String(id), {
      status: 'cancelled',
      cancelledAt: nowIso,
      updatedAt: nowIso,
      // ล้าง lease — กัน worker เดิมถือ claimToken แล้วเขียนทับ (worker/route.js ตรวจสถานะ cancelled อีกชั้น)
      claimToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      nextRetryAt: null,
      statusNote: '🚫 ผู้ใช้ยกเลิกงานนี้',
    });
    console.log(`[ClipCancel] 🚫 ยกเลิกงานคลิป ${String(id).slice(0, 10)} (สถานะเดิม ${job.status})`);
    return NextResponse.json({ success: true, cancelled: id, cancelledAt: nowIso });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, errorType: 'CANCEL_ERROR' }, { status: 500 });
  }
}
