import { NextResponse } from 'next/server';
import { submitClipJob } from '@/lib/services/clipJobs';

/**
 * POST /api/clip-transcript/submit (24 มิ.ย.) — พนักงานส่งลิงก์คลิปเข้า "คิวคลิป" (clip-jobs)
 *   → เครื่องทีม (clip-worker บนเครื่อง Windows) จะดึงไปถอดให้ → ผลเด้งกลับ
 * ★ คิวแยกเฉพาะคลิป (store 'clip-jobs') — ไม่แตะ job_queue/ระบบทำข่าวอัตโนมัติเด็ดขาด
 * Body: { url, kind?: 'insight'|'transcript', tidy?: boolean, user?: string }
 *   (★ 14 ส.ค. 69: ถอดฟิลด์ smooth ตามคำสั่งเจ้าของ — ระบบแบบการเล่าถูกลบทั้งชุด กลับพรอมต์ยุคนิ่งตัวเดียว)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { url, kind = 'insight', tidy = false, user = '', model = '', force = false } = await request.json();
    const result = await submitClipJob({ url, kind, tidy, user, model, force });
    // คง JSON เดิมทุก field — ใบซ้ำเดิมไม่มี position/platform และใบใหม่ไม่มี dup
    const { jobId, status, position, platform, dup, message } = result;
    return NextResponse.json(dup
      ? { success: true, jobId, status, dup, message }
      : { success: true, jobId, status, position, platform });
  } catch (error) {
    const legacyType = { BAD_URL: 'MISSING_URL', UNSUPPORTED_PLATFORM: 'UNSUPPORTED_URL' }[error.errorType];
    if (legacyType) {
      return NextResponse.json({ success: false, error: error.message, errorType: legacyType }, { status: 400 });
    }
    console.error('[ClipSubmit]', error.message);
    return NextResponse.json({ success: false, error: error.message || 'ส่งเข้าคิวไม่สำเร็จ', errorType: 'SUBMIT_ERROR' }, { status: 500 });
  }
}
