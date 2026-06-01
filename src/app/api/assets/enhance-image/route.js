import { NextResponse } from 'next/server';

// === STUB: AI Image Enhance API ===
// ⚠️ ยังไม่มี implementation จริง — เดิมใช้ Replicate API
// ใช้โดย: cover-tester/page.js → ปุ่ม "AI เพิ่มความชัด"
// เมื่อ implement จริง ควรใช้ Replicate Real-ESRGAN หรือ Stability AI upscaler

export async function POST(request) {
  try {
    const body = await request.json();
    const { base64, mode, upscale, faceRestore, outputSize, quality } = body;

    if (!base64) {
      return NextResponse.json({
        success: false,
        error: 'ไม่มีรูปภาพ',
        errorType: 'MISSING_IMAGE',
      }, { status: 400 });
    }

    // TODO: Implement real AI enhancement via Replicate or similar
    // For now return the original image as-is
    return NextResponse.json({
      success: true,
      stub: true,
      message: '⚠️ Image Enhance API ยังไม่ได้ implement — ใช้ภาพเดิม',
      data: {
        base64: base64,
        width: outputSize || 1200,
        height: outputSize || 1200,
        inputSize: { width: 0, height: 0 },
        enhancerUsed: 'none (stub)',
        mode: mode || 'auto',
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
      errorType: 'ENHANCE_IMAGE_STUB_ERROR',
    }, { status: 500 });
  }
}
