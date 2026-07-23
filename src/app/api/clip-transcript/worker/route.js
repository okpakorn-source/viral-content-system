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
    const now = Date.now();
    // ★ กู้งานค้าง: processing ค้างเกิน 8 นาที → คืนเป็น pending (เครื่องทีมหลุด/รีสตาร์ท)
    //   🔴 24 ก.ค. แก้บัค (auditor #5): นับ reclaims — งานที่ถูกกู้ซ้ำเกิน 5 ครั้ง (worker พัง/หมดแรงทุกครั้งที่หยิบ
    //      เช่นคลิปใหญ่ OOM) → มาร์ค error แทนวนไม่จบ (เดิม reset โดยไม่นับ = งานพิษวนไม่มีวันชน MAX_ATTEMPTS)
    const stuckCut = now - 8 * 60 * 1000;
    const MAX_RECLAIMS = 5;
    for (const j of all) {
      if (j.status === 'processing' && new Date(j.startedAt || 0).getTime() < stuckCut) {
        const reclaims = (j.reclaims || 0) + 1;
        if (reclaims >= MAX_RECLAIMS) {
          await store.update(j.id, ex => ({ ...ex, status: 'error', startedAt: null, reclaims,
            error: `งานค้างซ้ำ ${reclaims} ครั้ง — worker น่าจะพัง/หมดแรงทุกครั้งที่หยิบงานนี้ (เช่น คลิปใหญ่เกิน/OOM) จึงข้ามถาวร · ลองส่งใหม่หรือตรวจลิงก์`,
            doneAt: new Date().toISOString() })).catch(() => {});
        } else {
          await store.update(j.id, ex => ({ ...ex, status: 'pending', startedAt: null, reclaims })).catch(() => {});
        }
      }
    }
    // ★ 26 มิ.ย.: หยิบงาน pending + งาน retry_wait ที่ถึงเวลาลองใหม่แล้ว (Gemini แน่น → รอครบเวลา → ลองอีก)
    const claimable = all.filter(j =>
      j.status === 'pending' ||
      (j.status === 'retry_wait' && new Date(j.nextRetryAt || 0).getTime() <= now)
    ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (claimable.length === 0) return NextResponse.json({ success: true, job: null });
    const next = claimable[0];
    await store.update(next.id, ex => ({ ...ex, status: 'processing', startedAt: new Date().toISOString() }));
    // ★ 8 ก.ค.: ส่ง user (ใครส่งงาน) ไปด้วย — worker ส่งต่อให้ insight API เก็บเป็น metadata คลัง
    return NextResponse.json({ success: true, job: { id: next.id, url: next.url, kind: next.kind, tidy: next.tidy, platform: next.platform, user: next.user || '' } });
  } catch (error) {
    console.error('[ClipWorker:GET]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ★ 26 มิ.ย.: auto-retry ตอน Gemini แน่น — ลองใหม่ทุก ~3 นาที จนได้ผล (สูงสุด ~4 ชม.)
//   ขยาย 2→4 ชม. (ผู้ใช้สั่ง): บางวัน Gemini แน่นยาว — ให้คิวรอจน Gemini ว่างแล้วรันเอง ไม่ทิ้งงานเร็วเกิน
const RETRY_DELAY_MS = 3 * 60 * 1000; // รอ 3 นาที/ครั้ง
const MAX_ATTEMPTS = 80;              // ~4 ชม. แล้วเลิก

export async function POST(request) {
  try {
    const { id, status, result = null, error = '' } = await request.json();
    if (!id || !['done', 'error', 'retry'].includes(status)) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ id + status (done|error|retry)' }, { status: 400 });
    }
    const store = createStore('clip-jobs');

    // ★ retry = Gemini แน่นชั่วคราว → ไม่ fail · ตั้งเวลารอแล้วให้ worker หยิบทำใหม่อัตโนมัติ
    if (status === 'retry') {
      await store.update(id, ex => {
        const attempts = (ex.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // ★ Batch B (18 ก.ค.): แจ้งสาเหตุจริงจาก lastError แทนเหมารวมว่า "Gemini แน่น" เสมอ
          //   (ดาวน์โหลดล้มถูกจับเป็นถาวรก่อนถึงจุดนี้แล้วโดย isTransient — ที่มาถึง = ชั่วคราวจริงแต่ยาวเกิน)
          const lastErr = String(ex.lastError || error || '').slice(0, 160);
          return {
            ...ex, status: 'error', attempts, startedAt: null, statusNote: '',
            error: `ถอดคลิปไม่สำเร็จหลังลองอัตโนมัติ ${attempts} ครั้ง (~${Math.round(attempts * RETRY_DELAY_MS / 60000)} นาที)${lastErr ? ` — สาเหตุล่าสุด: ${lastErr}` : ' — ลองส่งใหม่ภายหลัง'}`,
            doneAt: new Date().toISOString(),
          };
        }
        return {
          ...ex, status: 'retry_wait', attempts, startedAt: null,
          nextRetryAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
          statusNote: `⏳ Gemini แน่น — อยู่ในคิว ระบบลองใหม่ให้เองทุก ~3 นาที จน Gemini ว่าง (ลองไปแล้ว ${attempts} ครั้ง) · ปิดหน้าได้ ผลจะเข้าคลังอัตโนมัติ`,
          lastError: String(error).slice(0, 200),
        };
      });
      return NextResponse.json({ success: true, retrying: true });
    }

    await store.update(id, ex => ({
      ...ex, status,
      result: status === 'done' ? result : null,
      error: status === 'error' ? String(error).slice(0, 300) : '',
      statusNote: '', doneAt: new Date().toISOString(),
    }));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ClipWorker:POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
