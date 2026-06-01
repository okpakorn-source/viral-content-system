import { NextResponse } from 'next/server';
import { enhanceImage } from '@/lib/services/imageEnhanceService';

/**
 * FAL.ai Flux Kontext — Image Enhancement (Thin wrapper)
 */
export async function POST(request) {
  try {
    const { layoutBase64, templateRefBase64, newsTitle } = await request.json();

    if (!process.env.FAL_KEY) {
      return NextResponse.json({ success: false, error: 'FAL_KEY ยังไม่ได้ตั้งค่า' }, { status: 500 });
    }
    if (!layoutBase64) {
      return NextResponse.json({ success: false, error: 'ต้องการ layoutBase64' }, { status: 400 });
    }

    const res = await enhanceImage({ layoutBase64, templateRefBase64, newsTitle });
    if (!res.success) {
      return NextResponse.json({ success: false, error: res.error }, { status: 500 });
    }

    return NextResponse.json(res);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

