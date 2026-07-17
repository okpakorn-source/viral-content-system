// ============================================================
// GET /api/mega/recipe?job=MG-xxxx — สูตรเปิดงานคิวปกในเอดิเตอร์ /cover-tester
// ------------------------------------------------------------
// read-only ปลอดภัย: อ่าน job (megaJobStore) + คลังภาพเคส (imageStore ตรง ไม่ fetch ตัวเอง)
//   → buildEditorRecipe (PURE) → โครง+ภาพต่อช่อง+พูล+QC
// ไม่มีข้อมูลพอ (ไม่มี pickImages/refMatch.dna.template) → 404 typed RECIPE_NOT_READY
// ============================================================

import { NextResponse } from 'next/server';
import { getJob } from '@/lib/megaJobStore';
import { readImages } from '@/lib/imageStore';
import { buildEditorRecipe, isRecipeReady } from '@/lib/editorRecipe';

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    let jobId = '';
    try {
      jobId = (req && req.nextUrl && req.nextUrl.searchParams)
        ? req.nextUrl.searchParams.get('job')
        : new URL(req.url).searchParams.get('job');
    } catch { jobId = ''; }
    jobId = (jobId || '').trim();

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ ?job=MG-xxxx', errorType: 'JOB_ID_REQUIRED' },
        { status: 400 },
      );
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: `ไม่พบงาน ${jobId}`, errorType: 'JOB_NOT_FOUND' },
        { status: 404 },
      );
    }

    if (!isRecipeReady(job)) {
      return NextResponse.json(
        {
          success: false,
          error: 'งานนี้ยังไม่มีข้อมูลพอทำสูตร (ต้องมีการเลือกภาพ + โครงปกจาก ref ก่อน)',
          errorType: 'RECIPE_NOT_READY',
          status: job.status || null,
        },
        { status: 404 },
      );
    }

    // อ่านคลังภาพเคส (prefer-rehosted URL ใน buildEditorRecipe) — ล้มก็ยังทำ recipe ต่อด้วยพูลว่าง
    let caseImages = [];
    const caseId = job.dossier && job.dossier.images && job.dossier.images.caseId;
    if (caseId) {
      try { caseImages = await readImages(caseId); } catch (e) {
        console.warn('[mega/recipe] อ่านคลังภาพเคสไม่สำเร็จ (พูลว่าง):', e.message);
      }
    }

    const recipe = buildEditorRecipe({ job, caseImages });
    return NextResponse.json({ success: true, recipe });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'ทำสูตรไม่สำเร็จ', errorType: 'RECIPE_BUILD_FAILED' },
      { status: 500 },
    );
  }
}
