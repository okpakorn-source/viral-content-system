// ============================================================
// [ระบบทำปกออโต้] POST /api/images/youtube
// ------------------------------------------------------------
// body: { caseId }
// ค้นคลิป → โหลด → แคปเฟรม → Gemini คัด → เก็บเข้าคลังรูป (youtube)
// ⚠️ ใช้เวลานาน (โหลด+ประมวลผลวิดีโอ) — เครื่องทีมเท่านั้น
// ============================================================

import { NextResponse } from 'next/server';
import { getCase } from '@/lib/caseStore';
import { runYouTubePipeline } from '@/lib/youtubePipeline';
import { addImages } from '@/lib/imageStore';

import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId || null;
  const P = reporter(jobId);
  try {
    // ★ 5 ก.ค. (copy เข้า repo ไวรัล): แคปเฟรมใช้ yt-dlp+ffmpeg+เขียนดิสก์ = เครื่องทีม (Windows) เท่านั้น
    //   บนเว็บ (Vercel/Linux) เดิมพัง ENOENT mkdir /var/task/public — ตอบสุภาพแทน
    //   ⚠️ ใช้ platform ไม่ใช่ env.VERCEL (เครื่องทีมมี VERCEL=1 หลอกใน .env.local — บทเรียนเก่า)
    if (process.platform !== 'win32') {
      failProgress(jobId, 'แคปเฟรม YouTube ทำได้เฉพาะเครื่องทีม');
      return NextResponse.json(
        { success: false, error: 'แคปเฟรม YouTube ทำได้เฉพาะบนเครื่องทีม (ต้องใช้ yt-dlp+ffmpeg) — แหล่งอื่นทุกแหล่งใช้บนเว็บได้ปกติ', errorType: 'TEAM_MACHINE_ONLY' },
        { status: 400 }
      );
    }
    const caseId = (body.caseId || '').trim();

    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (!c.keywords || typeof c.keywords !== 'object') {
      return NextResponse.json(
        { success: false, error: 'ต้องสกัดคีย์เวิร์ดก่อนจึงจะค้นคลิปได้', errorType: 'NO_KEYWORDS' },
        { status: 400 }
      );
    }

    let result;
    try {
      result = await runYouTubePipeline({ caseId, keywords: c.keywords, progress: P });
    } catch (err) {
      failProgress(jobId, err.message);
      const map = {
        NO_GEMINI_KEY: 400,
        NO_SERPAPI_KEY: 400,
        NO_CLIPS: 200,
        NO_FRAMES: 200,
      };
      return NextResponse.json(
        {
          success: false,
          error: err.message || 'pipeline ล้มเหลว',
          errorType: err.errorType || 'PIPELINE_FAILED',
          log: err.log || undefined,
        },
        { status: map[err.errorType] || 502 }
      );
    }

    const records = result.frames.map((f) => ({ ...f, platform: 'youtube', query: 'youtube' }));
    const saved = await addImages(caseId, records);
    doneProgress(jobId, { step: 'เสร็จ', detail: `ได้ ${result.frames.length} เฟรมเข้าคลัง` });

    return NextResponse.json({
      success: true,
      caseId,
      platform: 'youtube',
      found: result.frames.length,
      added: saved.added,
      total: saved.total,
      byPlatform: saved.byPlatform,
      images: saved.images,
      clipsUsed: result.clipsUsed,
      log: result.log,
    });
  } catch (err) {
    failProgress(jobId, err.message);
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}
