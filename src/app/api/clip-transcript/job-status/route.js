import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * GET /api/clip-transcript/job-status?id=xxx (24 มิ.ย.) — UI poll สถานะงานคลิปในคิว
 *  คืน { status, result, error, position } — position = คิวข้างหน้า (ถ้ายัง pending)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id' }, { status: 400 });
    const store = createStore('clip-jobs');
    const job = await store.findById(id);
    if (!job) {
      return NextResponse.json({ success: false, error: 'ไม่พบงานในคิว (อาจถูกล้าง — ส่งใหม่ได้)', errorType: 'JOB_NOT_FOUND' }, { status: 404 });
    }
    let position = 0;
    if (job.status === 'pending') {
      const all = await store.getAll();
      const ahead = all.filter(j => j.status === 'pending' && new Date(j.createdAt) < new Date(job.createdAt)).length;
      const processing = all.filter(j => j.status === 'processing').length;
      position = ahead + processing + 1;
    }
    return NextResponse.json({
      success: true, status: job.status, position,
      result: job.status === 'done' ? job.result : null,
      error: job.status === 'error' ? job.error : '',
      // ★ 26 มิ.ย.: สถานะ retry_wait (Gemini แน่น รอลองใหม่อัตโนมัติ) — บอกผู้ใช้ว่าทำไมยังไม่ได้ผล + นับครั้ง
      statusNote: job.statusNote || '',
      attempts: job.attempts || 0,
      nextRetryAt: job.nextRetryAt || null,
      platform: job.platform, kind: job.kind,
    });
  } catch (error) {
    console.error('[ClipJobStatus]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
