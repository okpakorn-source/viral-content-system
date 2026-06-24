import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * Clip Worker bridge (24 มิ.ย.) — ให้ "clip-worker บนเครื่องทีม" ดึงงาน + รายงานผล
 *   GET  → ดึงงาน pending ที่เก่าสุด 1 ชิ้น แล้วมาร์ค processing (atomic-ish) → คืน job
 *   POST → รายงานผล { id, status:'done'|'error', result?, error? } → อัปเดต job
 * ★ คิวแยก 'clip-jobs' — ไม่แตะ job_queue/ระบบทำข่าวอัตโนมัติ
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = createStore('clip-jobs');
    const all = await store.getAll();
    // ★ กู้งานค้าง: processing ค้างเกิน 8 นาที → คืนเป็น pending (เครื่องทีมหลุด/รีสตาร์ท)
    const stuckCut = Date.now() - 8 * 60 * 1000;
    for (const j of all) {
      if (j.status === 'processing' && new Date(j.startedAt || 0).getTime() < stuckCut) {
        await store.update(j.id, ex => ({ ...ex, status: 'pending', startedAt: null })).catch(() => {});
      }
    }
    const pending = all.filter(j => j.status === 'pending')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (pending.length === 0) return NextResponse.json({ success: true, job: null });
    const next = pending[0];
    await store.update(next.id, ex => ({ ...ex, status: 'processing', startedAt: new Date().toISOString() }));
    return NextResponse.json({ success: true, job: { id: next.id, url: next.url, kind: next.kind, tidy: next.tidy, platform: next.platform } });
  } catch (error) {
    console.error('[ClipWorker:GET]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { id, status, result = null, error = '' } = await request.json();
    if (!id || !['done', 'error'].includes(status)) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ id + status (done|error)' }, { status: 400 });
    }
    const store = createStore('clip-jobs');
    await store.update(id, ex => ({
      ...ex, status,
      result: status === 'done' ? result : null,
      error: status === 'error' ? String(error).slice(0, 300) : '',
      doneAt: new Date().toISOString(),
    }));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ClipWorker:POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
