export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { createEnhanceJob, getEnhanceJob, ENHANCE_TIERS } from '@/lib/services/photoEnhanceService';

/**
 * POST /api/photo-enhance  { image: dataURI, tier: 'standard'|'high' } → { id, status }
 *   สร้างงาน upscale 1 ภาพ (Real-ESRGAN, face_enhance=false) — แต่ละภาพ = 1 งานอิสระ (คิวฝั่ง Replicate รองรับหลายคนพร้อมกัน)
 * GET  /api/photo-enhance?id=xxx → { status, output, error }  poll จนเสร็จ
 */
export async function POST(request) {
  try {
    const { image, tier = 'standard' } = await request.json();
    if (!image || typeof image !== 'string' || !/^data:image\//.test(image)) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งภาพ (รูปแบบ data URI)', errorType: 'MISSING_IMAGE' }, { status: 400 });
    }
    // กันไฟล์ใหญ่เกิน (data URI ~13MB ≈ ภาพ ~10MB)
    if (image.length > 14_000_000) {
      return NextResponse.json({ success: false, error: 'ไฟล์ใหญ่เกินไป (เกิน ~10MB) — ลองย่อภาพก่อน', errorType: 'IMAGE_TOO_LARGE' }, { status: 413 });
    }
    if (!ENHANCE_TIERS[tier]) {
      return NextResponse.json({ success: false, error: 'ระดับความชัดไม่ถูกต้อง', errorType: 'INVALID_TIER' }, { status: 400 });
    }
    const job = await createEnhanceJob({ image, tier });
    return NextResponse.json({ success: true, id: job.id, status: job.status, tier });
  } catch (error) {
    console.error('[PhotoEnhance]', error.message);
    return NextResponse.json({ success: false, error: error.message || 'สร้างงานไม่สำเร็จ', errorType: 'ENHANCE_ERROR' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'MISSING_ID' }, { status: 400 });
    const job = await getEnhanceJob(id);
    return NextResponse.json({ success: true, ...job });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'เช็กสถานะไม่สำเร็จ', errorType: 'STATUS_ERROR' }, { status: 500 });
  }
}
