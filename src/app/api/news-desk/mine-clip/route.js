/**
 * News Desk — เหมืองบทสัมภาษณ์ (เฟส 2)
 * POST { url } → ถอดเสียงคลิป → ขุดนาทีทอง → ลงคลังโต๊ะข่าว (lane: interview)
 * ใช้ได้เฉพาะเครื่องที่มี yt-dlp (local) สำหรับ FB/IG — YouTube/TikTok ใช้ได้ทุกที่
 */
import { NextResponse } from 'next/server';
import { mineClip } from '@/lib/services/newsDesk/interviewMiner';
import { createStore } from '@/lib/persistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600; // ถอดเสียงคลิปยาว + ขุด

// ขุดทีละคลิปต่อเครื่อง — Whisper+ดาวน์โหลดหนัก
let _mineLock = Promise.resolve();

export async function POST(request) {
  const prev = _mineLock;
  let release;
  _mineLock = new Promise((r) => (release = r));
  await prev;
  try {
    const { url, _queueJobId = null } = await request.json();
    if (!url || !/^https?:\/\//.test(url)) {
      return NextResponse.json({ success: false, error: 'ต้องวางลิงก์คลิป (YouTube / Facebook / IG / TikTok)', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ★ บน production (Linux) ไม่มี yt-dlp — ส่งเข้าคิวให้เครื่องทีมขุดแทน (บัคจริง: ผู้ใช้กดจากเว็บ prod แล้วพัง)
    if (process.platform !== 'win32' && !_queueJobId) {
      const { enqueueJob } = await import('@/lib/services/queueService');
      const q = await enqueueJob({ jobType: 'mineclip', url, input: url }, 'desk-mineclip');
      return NextResponse.json({
        success: true, queued: true, jobId: q.jobId,
        message: '⏳ ส่งให้เครื่องทีมขุดแล้ว — เสร็จจะโผล่ในแท็บ 🎙️ เอง (~3-6 นาที, เครื่องทีมต้องเปิดอยู่)',
      });
    }

    const store = createStore('news-desk');
    const item = await mineClip(url);

    // เคยขุดคลิปนี้แล้ว → อัปเดตทับ (ขุดใหม่ได้ผลใหม่)
    const all = await store.getAll();
    if (all.find(i => i.id === item.id)) {
      await store.update(item.id, (ex) => ({ ...ex, ...item, status: ex.status === 'sent' ? 'sent' : 'new' }));
    } else {
      await store.add({
        ...item,
        finalScore: Math.min(100, Math.round(22 + 10 + item.judgeScore * 5)), // fit สัมภาษณ์ 22 + fresh 10 + judge
        status: 'new',
        claimedBy: null,
        harvestedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true, item: { ...item, fullText: undefined }, golden: item.goldenMoments });
  } catch (error) {
    console.error('[MineClip]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'MINE_CLIP_ERROR' }, { status: 500 });
  } finally {
    release();
  }
}
