import { NextResponse } from 'next/server';
import { huntImages } from '@/lib/services/imageHunterService';

export async function POST(request) {
  try {
    const { prompt, mode = 'images' } = await request.json();
    if (!prompt) return NextResponse.json({ success: false, error: 'กรุณาระบุคำค้นหา', errorType: 'MISSING_PROMPT' }, { status: 400 });

    const images = await huntImages(prompt, mode);

    return NextResponse.json({
      success: true,
      data: images
    });
  } catch (error) {
    console.error('[Image-Hunter] Error:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message || 'ระบบค้นหารูปภาพล้มเหลว',
      errorType: 'IMAGE_HUNTER_FAILED',
    }, { status: 500 });
  }
}
