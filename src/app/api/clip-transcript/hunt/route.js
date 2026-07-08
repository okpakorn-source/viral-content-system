export const maxDuration = 800; // insight (ถอดคลิป) + ค้น+คัด — เท่าเส้นทางถอดประเด็น
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createStore } from '@/lib/persistStore';
import { runTopicHunt } from '@/lib/services/topicHuntService';
import { cleanClipUrl } from '../insight/route';

/**
 * POST /api/clip-transcript/hunt (8 ก.ค. 69) — "ถอด+ค้นข่าวคล้าย" → คลังค้นประเด็นยูสเซอร์
 *  1) เนื้อดิบ: ยิงภายในไป /api/clip-transcript/insight (ได้ dedup ฟรี — คลิปเคยถอด = 0 วิ ไม่จ่ายซ้ำ)
 *  2) topicHuntService: สไตล์→คีย์ → ค้น Serper → กรรมการคัด (≥6/10 ไม่จำกัดจำนวน)
 *  3) เก็บเคสถาวร store 'user-topic-hunts' (ไม่หมุนทิ้ง) — ลิงก์ต้นทาง+เนื้อดิบ+ข่าวที่เจอ
 *  • FB/IG บนคลาวด์ (ไม่มี yt-dlp) → ส่งเข้าคิวเครื่องทีม kind='hunt' อัตโนมัติ (auto-retry เดิมทั้งชุด)
 *  • Body: { url, user?, caseId? (ค้นเพิ่มเข้าเคสเดิม), _fromWorker? }
 * ★ แยกจากเวิร์กโฟลว์ข่าว 100% — ใช้คิว clip-jobs เท่านั้น ไม่แตะ job_queue
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
    const { url: _rawUrl, user = '', caseId = null, _fromWorker = false } = await request.json();
    if (!_rawUrl || typeof _rawUrl !== 'string') {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป', errorType: 'MISSING_URL' }, { status: 400 });
    }
    const url = cleanClipUrl(_rawUrl);
    const type = detectClipType(url);
    if (!type) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL' }, { status: 400 });
    }

    // ★ FB/IG บนคลาวด์ → เข้าคิวเครื่องทีม kind='hunt' (โครงคิว+auto-retry เดียวกับถอดประเด็นทุกอย่าง)
    if (process.platform !== 'win32' && type === 'meta' && !_fromWorker) {
      const jobs = createStore('clip-jobs');
      const all = await jobs.getAll();
      const recent = all.find(j => j.url === url && j.kind === 'hunt'
        && ['pending', 'processing', 'retry_wait'].includes(j.status)
        && Date.now() - new Date(j.createdAt || 0).getTime() < 3 * 60 * 60 * 1000);
      if (recent) return NextResponse.json({ success: true, queued: true, jobId: recent.id, dup: true });
      const jobId = randomUUID();
      await jobs.add({ id: jobId, url, platform: type, kind: 'hunt', user: String(user || '').slice(0, 40), status: 'pending', createdAt: new Date().toISOString() });
      return NextResponse.json({ success: true, queued: true, jobId, message: '⏳ ส่งเครื่องทีมถอด+ค้นแล้ว — เสร็จผลเข้า "คลังค้นประเด็นยูสเซอร์" เอง' });
    }

    // 1) เนื้อดิบ — ยิงภายในไปเครื่องถอดประเด็นเดิม (dedup/ด่าน QC/เก็บคลังถอดประเด็น ได้ครบตามเดิม)
    const insRes = await fetch(`${request.nextUrl.origin}/api/clip-transcript/insight`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, user }),
    });
    const insData = await insRes.json().catch(() => ({}));
    if (!insData.success) {
      return NextResponse.json({ success: false, error: insData.error || 'ถอดเนื้อดิบไม่สำเร็จ', errorType: insData.errorType || 'INSIGHT_FAILED' }, { status: 422 });
    }
    const insight = insData.data;

    // 2)+3) สไตล์ → ค้น → คัด
    const hunt = await runTopicHunt({ url, insight, user });

    const store = createStore('user-topic-hunts');
    // ★ ลิงก์เดิมมีเคสอยู่แล้ว (หรือกด "ค้นเพิ่มอีกรอบ" ส่ง caseId มา) → "รวมผลใหม่เข้าเคสเดิม"
    //   กันซ้ำด้วย URL — ไม่สร้างเคสซ้ำ ไม่เขียนทับผลเก่าที่เคยเจอ
    const all = await store.getAll();
    const ex = (caseId ? await store.findById(caseId) : null) || all.find(c => c.sourceUrl === url);
    if (ex) {
      const seen = new Set((ex.results || []).map(r => r.url));
      const merged = [...(ex.results || []), ...hunt.results.filter(r => !seen.has(r.url))].sort((a, b) => b.score - a.score);
      await store.update(ex.id, (e) => ({
        ...e, results: merged, insight: hunt.insight, styleProfile: hunt.styleProfile,
        searchKeys: [...new Set([...(e.searchKeys || []), ...hunt.searchKeys])],
        stats: { ...(e.stats || {}), kept: merged.length, lastHuntAt: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
      }));
      const updated = await store.findById(ex.id);
      return NextResponse.json({ success: true, data: updated, merged: true });
    }

    const record = {
      id: randomUUID(), platform: type, ...hunt,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await store.add(record); // ★ เก็บถาวร — ไม่หมุนทิ้ง (บทเรียนคลังถอดประเด็น)
    return NextResponse.json({ success: true, data: record });
  } catch (error) {
    console.error('[TopicHunt]', error.message);
    return NextResponse.json({ success: false, error: String(error.message || 'ค้นข่าวคล้ายล้มเหลว').slice(0, 200), errorType: 'HUNT_ERROR' }, { status: 500 });
  }
}
