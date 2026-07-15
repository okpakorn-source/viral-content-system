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
import { enqueueJob, patchJob, queuePosition, finishJob } from '@/lib/ytJobStore';
import { hostImagePublic } from '@/lib/publicHost';
import { createClient } from '@supabase/supabase-js';

// ★ 6 ก.ค.: เฟรมที่ต้องโชว์บนเว็บ ต้องอยู่ "ถาวร" — tmpfiles (publicHost) หมดอายุใน ~1 ชม.
//   → เก็บลง Supabase Storage (bucket สาธารณะ acs-frames) · ล้มค่อย fallback tmpfiles ชั่วคราว
const FRAME_BUCKET = 'acs-frames';
async function persistFrame(buf, name) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('ไม่มี Supabase env');
  const c = createClient(url, key);
  const p = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${name}`;
  let { error } = await c.storage.from(FRAME_BUCKET).upload(p, buf, { contentType: 'image/jpeg' });
  if (error && /bucket|not found/i.test(error.message)) {
    await c.storage.createBucket(FRAME_BUCKET, { public: true }).catch(() => {});
    ({ error } = await c.storage.from(FRAME_BUCKET).upload(p, buf, { contentType: 'image/jpeg' }));
  }
  if (error) throw new Error('อัป Storage ไม่สำเร็จ: ' + error.message);
  return c.storage.from(FRAME_BUCKET).getPublicUrl(p).data.publicUrl;
}

import { vetImages } from '@/lib/libraryTriage';
import { logCapture, listCaptureLog } from '@/lib/ytCaptureLog';
import { reporter, doneProgress, failProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const maxDuration = 600;

// ★ 9 ก.ค. (เฟส 1): ดู capture-log ย้อนหลัง — GET ?caseId=AC-xxxx&limit=30 (ไม่ระบุ = ทุกเคสล่าสุด)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const caseId = searchParams.get('caseId') || null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10) || 30, 200);
    const entries = await listCaptureLog({ caseId, limit });
    return NextResponse.json({ success: true, count: entries.length, entries });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}

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
      const clipUrl = (body.clipUrl || '').trim();
      const { job, existing } = await enqueueJob(caseId, clipUrl);
      const pos = await queuePosition(job.id);
      const posMsg = pos > 1 ? ` (รอคิวอันดับ ${pos})` : '';
      const kind = clipUrl ? 'แคปเฟรมจากคลิปที่ระบุ' : 'แคปเฟรม YouTube';
      const message = existing
        ? `🕐 งาน${kind}ของเคสนี้อยู่บนเครื่องทีมแล้ว${job.status === 'running' ? ' — กำลังรัน' : posMsg} ดูสถานะสดได้ในแถบนี้`
        : `🕐 ส่งงาน${kind}ไปรันบนเครื่องทีมแล้ว${posMsg} — สถานะสดจะโชว์ตรงนี้ เสร็จแล้วรูปเข้าคลังเอง`;
      doneProgress(jobId, { step: 'ฝากงานแล้ว', detail: message });
      return NextResponse.json({ success: true, queued: true, ytJobId: job.id, position: pos, message, added: 0 });
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

    // ★ 6 ก.ค.: งานจาก worker (มี ytJobId) → เขียนความคืบหน้าทุกขั้นลงคิว Supabase ให้เว็บโชว์สด
    //   (progress เดิมเป็น in-memory เห็นเฉพาะเครื่องที่รัน — เว็บ Vercel มองไม่เห็น)
    let lastPatch = 0;
    const P2 = (step, detail, extra = {}) => {
      P(step, detail, extra);
      if (body.ytJobId) {
        const now = Date.now();
        if (now - lastPatch > 3000) {
          lastPatch = now;
          patchJob(body.ytJobId, { progress: { step, detail: String(detail || ''), at: new Date().toISOString() } }).catch(() => {});
        }
      }
    };
    P2.onRetry = P.onRetry;

    let result;
    try {
      // ★ 6 ก.ค.: โหมดเจาะจงคลิป — วางลิงก์ FB/YouTube/TikTok/IG มาเอง = แคปจากคลิปนั้นตรงๆ (1080p+ถี่)
      const clipUrls = (body.clipUrl || '').trim() ? [(body.clipUrl || '').trim()] : undefined;
      const newsGist = (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '').slice(0, 600);
      result = await runYouTubePipeline({ caseId, keywords: c.keywords, progress: P2, clipUrls, newsGist });
    } catch (err) {
      failProgress(jobId, err.message);
      // ★ 6 ก.ค.: route เป็นคนปิดงานในคิวเอง (worker อาจวางสายไปแล้วถ้างานยาว)
      if (body.ytJobId) await finishJob(body.ytJobId, { status: 'failed', error: `[${err.errorType || 'ERROR'}] ${err.message || ''}`.slice(0, 500) }).catch(() => {});
      // ★ 9 ก.ค. (เฟส 1): บันทึก log แม้แคปล้ม — เคสสำคัญสุดที่ต้องย้อนสืบ (เช่น เพดานเวลาเขี่ยคลิปดีทิ้งหมด)
      await logCapture({
        caseId, mode: (body.clipUrl || '').trim() ? 'pinpoint' : 'search',
        clipUrl: (body.clipUrl || '').trim() || null, ok: false,
        errorType: err.errorType || 'PIPELINE_FAILED', error: (err.message || '').slice(0, 200),
        found: err.stats?.found ?? null, droppedByDuration: err.stats?.droppedByDuration || [],
        framesAdded: 0, log: err.log || [],
      }).catch(() => {});
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

    // ★ 6 ก.ค. รอบ 5: ติดป้ายตา (triage) ให้เฟรมก่อน — ★ 9 ก.ค. ย้ายมาก่อนอัปโฮสต์: vet อ่านไฟล์ local (เร็ว)
    //   ใช้ตาแค่ "ติดป้าย" ไม่คัดทิ้ง (เฟรมผ่านตาคัดตอนแคปแล้ว + ห้ามลบเฟรมเติมขั้นต่ำของโหมดเจาะจง)
    try {
      P2('ติดป้ายตาให้เฟรม', `${frames.length} ใบ`);
      const newsGist2 = (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '').slice(0, 600);
      const { vetted } = await vetImages({ images: frames, subjects: c.keywords?.subjects || [], newsGist: newsGist2, caseId });
      if (Array.isArray(vetted) && vetted.length === frames.length) frames = vetted;
    } catch {
      /* ตาล้ม → เก็บแบบไม่มีป้าย (กดคัดกรองคลังทีหลังได้) */
    }

    // นับ "สะอาดจริงหลังตาคัด" — ใช้ทั้งใน log และ (เฟส 3) ตัดสินว่าแคปคุ้มไหม
    const cleanCount = frames.filter((f) => f.triage && f.triage.clean !== false).length;
    const junkCount = frames.filter((f) => f.triage && f.triage.clean === false).length;

    // ★ 9 ก.ค. (เฟส 1): อัปเฟรมขึ้นโฮสต์สาธารณะ "ทุกครั้ง" (ไม่ใช่เฉพาะ hostPublic) — เฟรมเป็นไฟล์ local
    //   /case-frames/... บน Vercel เปิดไม่เจอ (จอดำ · บั๊กเดียวกับ ref 404) → อัป Supabase Storage ให้เว็บเห็น
    //   kill-switch: YT_FRAME_HOST_OFF=1 (กลับพฤติกรรมเดิม เก็บพาธ local อย่างเดียว)
    let hostedCount = 0;
    if (process.env.YT_FRAME_HOST_OFF !== '1') {
      P2('อัปเฟรมขึ้นโฮสต์สาธารณะ', `0/${frames.length}`);
      frames = await Promise.all(
        frames.map(async (f) => {
          try {
            if (!f.imageUrl || !f.imageUrl.startsWith('/')) return f;
            const buf = await fs.readFile(path.join(process.cwd(), 'public', f.imageUrl.replace(/^\//, '')));
            const url = await persistFrame(buf, path.basename(f.imageUrl)).catch(() => hostImagePublic(buf, path.basename(f.imageUrl)));
            hostedCount++;
            P2('อัปเฟรมขึ้นโฮสต์สาธารณะ', `${hostedCount}/${frames.length}`);
            return { ...f, imageUrl: url, thumbnailUrl: url };
          } catch {
            return f; // อัปพลาด → เก็บพาธ local (อย่างน้อยเครื่องทีมยังใช้ได้)
          }
        })
      );
    }

    // ★ 6 ก.ค. (ผู้ใช้สั่ง): เฟรมจาก "คลิปที่วางลิงก์เอง" แยกหมวดเป็น 'clip' — คลังมีชิปกรองแยกให้เลือกดู/ประเมินง่าย
    const framePlatform = (body.clipUrl || '').trim() ? 'clip' : 'youtube';
    const records = frames.map((f) => ({ ...f, platform: framePlatform, query: (body.clipUrl || '').trim() || 'youtube' }));
    const saved = await addImages(caseId, records);
    doneProgress(jobId, { step: 'เสร็จ', detail: `ได้ ${result.frames.length} เฟรมเข้าคลัง` });
    // ★ 6 ก.ค.: route ปิดงานในคิวเอง = เว็บเห็น "เสร็จ" แน่นอนแม้ worker วางสายไปก่อน
    if (body.ytJobId) await finishJob(body.ytJobId, { status: 'done', added: saved.added }).catch(() => {});
    // ★ 9 ก.ค. (เฟส 1): สรุปรอบนี้ลง capture-log — ย้อนดูได้ว่าคลิปไหนถูกใช้/สะอาดจริงกี่ใบ/โดนเพดานตัดกี่ตัว
    await logCapture({
      caseId, mode: framePlatform === 'clip' ? 'pinpoint' : 'search',
      clipUrl: (body.clipUrl || '').trim() || null, ok: true,
      found: result.stats?.found ?? null, droppedByDuration: result.stats?.droppedByDuration || [],
      clipsUsed: result.clipsUsed || [], framesAdded: saved.added, framesTotal: result.frames.length,
      cleanCount, junkCount, hosted: hostedCount, log: result.log || [],
    }).catch(() => {});

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
