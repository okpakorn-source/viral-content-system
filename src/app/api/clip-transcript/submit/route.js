import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { randomUUID } from 'crypto';

/**
 * POST /api/clip-transcript/submit (24 มิ.ย.) — พนักงานส่งลิงก์คลิปเข้า "คิวคลิป" (clip-jobs)
 *   → เครื่องทีม (clip-worker บนเครื่อง Windows) จะดึงไปถอดให้ → ผลเด้งกลับ
 * ★ คิวแยกเฉพาะคลิป (store 'clip-jobs') — ไม่แตะ job_queue/ระบบทำข่าวอัตโนมัติเด็ดขาด
 * Body: { url, kind?: 'insight'|'transcript', tidy?: boolean, user?: string }
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function detectClipType(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch|instagram\.com/i.test(url)) return 'meta';
  return null;
}

export async function POST(request) {
  try {
    const { url, kind = 'insight', tidy = false, user = '' } = await request.json();
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป (http/https)', errorType: 'MISSING_URL' }, { status: 400 });
    }
    const platform = detectClipType(url);
    if (!platform) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL' }, { status: 400 });
    }
    const store = createStore('clip-jobs');
    // กันส่งซ้ำ: ลิงก์เดียวกันที่ยัง "active" (pending/processing/retry_wait) → คืน job เดิม
    //   ★ Batch B (18 ก.ค.): dedup จากสถานะ active ล้วน ไม่ผูกกรอบเวลา — เดิม 3 ชม. สั้นกว่าช่วง retry จริง ~4 ชม.
    //   (RETRY_DELAY_MS×MAX_ATTEMPTS ใน worker/route.js) ทำให้ชั่วโมงที่ 3-4 งานเดิมยัง active แต่หลุด dedup → สร้างซ้ำ
    //   งาน active มีเพดานอายุ ~4 ชม.อยู่แล้ว (พ้นนั้นเป็น error/done จึงหลุด filter นี้เอง) — ไม่ต้องมีกรอบเวลาซ้อน
    const all = await store.getAll();
    const recent = all.find(j => j.url === url && (j.status === 'pending' || j.status === 'processing' || j.status === 'retry_wait'));
    if (recent) {
      return NextResponse.json({ success: true, jobId: recent.id, status: recent.status, dup: true, message: 'คลิปนี้อยู่ในคิวแล้ว (กำลังทำ/รอลองใหม่)' });
    }
    const jobId = randomUUID();
    // ★ 8 ก.ค.: เพิ่ม kind 'hunt' (ถอด+ค้นข่าวคล้าย → คลังค้นประเด็นยูสเซอร์)
    await store.add({
      id: jobId, url, platform, kind: kind === 'transcript' ? 'transcript' : kind === 'hunt' ? 'hunt' : 'insight', tidy: !!tidy,
      user: String(user || 'ไม่ระบุชื่อ').slice(0, 40),
      status: 'pending', createdAt: new Date().toISOString(),
    });
    // เก็บกวาดงานเก่า > 50 ชิ้น (กันคิวบวม)
    if (all.length > 50) {
      const old = all.filter(j => j.status === 'done' || j.status === 'error')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 50);
      for (const o of old) await store.remove(o.id).catch(() => {});
    }
    const pending = all.filter(j => j.status === 'pending' || j.status === 'processing').length;
    return NextResponse.json({ success: true, jobId, status: 'pending', position: pending + 1, platform });
  } catch (error) {
    console.error('[ClipSubmit]', error.message);
    return NextResponse.json({ success: false, error: error.message || 'ส่งเข้าคิวไม่สำเร็จ', errorType: 'SUBMIT_ERROR' }, { status: 500 });
  }
}
