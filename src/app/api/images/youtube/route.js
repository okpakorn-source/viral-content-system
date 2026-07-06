// ============================================================
// [ระบบทำปกออโต้] POST /api/images/youtube
// ------------------------------------------------------------
// body: { caseId }
// ค้นคลิป → โหลด → แคปเฟรม → Gemini คัด → เก็บเข้าคลังรูป (youtube)
// ⚠️ ใช้เวลานาน (โหลด+ประมวลผลวิดีโอ) — เครื่องทีมเท่านั้น
// ============================================================

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getCase } from '@/lib/caseStore';
import { runYouTubePipeline } from '@/lib/youtubePipeline';
import { addImages } from '@/lib/imageStore';
import { enqueueJob } from '@/lib/ytJobStore';
import { hostImagePublic } from '@/lib/publicHost';

import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId || null;
  const P = reporter(jobId);
  try {
    const caseId = (body.caseId || '').trim();

    // ★ 6 ก.ค. (ผู้ใช้สั่ง): บนเว็บ (Vercel/Linux) แคปเฟรมเองไม่ได้ → "ฝากงานให้เครื่องทีมรันอัตโนมัติ"
    //   แทนการตอบ error — worker (scripts/acs-yt-worker.mjs) จะหยิบไปรัน แล้วรูปเข้าคลังเคสนี้เอง
    //   ⚠️ ใช้ platform ไม่ใช่ env.VERCEL (เครื่องทีมมี VERCEL=1 หลอกใน .env.local — บทเรียนเก่า)
    if (process.platform !== 'win32') {
      if (!caseId) {
        return NextResponse.json({ success: false, error: 'ต้องมี caseId', errorType: 'BAD_INPUT' }, { status: 400 });
      }
      const { job, existing } = await enqueueJob(caseId);
      const message = existing
        ? `🕐 เคสนี้มีงานแคปเฟรมค้างอยู่บนเครื่องทีมแล้ว (${job.status === 'running' ? 'กำลังรัน' : 'รอคิว'}) — เสร็จแล้วรูปจะเข้าคลังเอง`
        : '🕐 ส่งงานแคปเฟรม YouTube ไปรันบนเครื่องทีมแล้ว — เสร็จแล้วรูปจะเข้าคลังเคสนี้เอง (รีเฟรชดูได้)';
      doneProgress(jobId, { step: 'ฝากงานแล้ว', detail: message });
      return NextResponse.json({ success: true, queued: true, ytJobId: job.id, message, added: 0 });
    }

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

    let frames = result.frames;

    // ★ 6 ก.ค. (ผู้ใช้สั่ง): งานที่มาจากเว็บ (hostPublic) — อัปเฟรมขึ้นโฮสต์สาธารณะก่อนเก็บ
    //   (เฟรมเป็นไฟล์ local /case-frames/... เว็บมองไม่เห็น) อัปพลาดใบไหนคงพาธ local ไว้ (ใช้บนเครื่องทีมได้)
    if (body.hostPublic) {
      P('อัปเฟรมขึ้นโฮสต์สาธารณะ', `0/${frames.length}`);
      let hosted = 0;
      frames = await Promise.all(
        frames.map(async (f) => {
          try {
            if (!f.imageUrl || !f.imageUrl.startsWith('/')) return f;
            const buf = await fs.readFile(path.join(process.cwd(), 'public', f.imageUrl.replace(/^\//, '')));
            const url = await hostImagePublic(buf, path.basename(f.imageUrl));
            hosted++;
            P('อัปเฟรมขึ้นโฮสต์สาธารณะ', `${hosted}/${frames.length}`);
            return { ...f, imageUrl: url, thumbnailUrl: url };
          } catch {
            return f; // อัปพลาด → เก็บพาธ local (อย่างน้อยเครื่องทีมยังใช้ได้)
          }
        })
      );
    }

    const records = frames.map((f) => ({ ...f, platform: 'youtube', query: 'youtube' }));
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
