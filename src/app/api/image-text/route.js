import { NextResponse } from 'next/server';
import { addTextOverlay } from '@/lib/services/imageTextService';

/**
 * Ideogram Text Overlay — Thin wrapper using imageTextService
 */
export async function POST(request) {
  try {
    if (!process.env.IDEOGRAM_API_KEY) {
      return NextResponse.json({ success: false, error: 'IDEOGRAM_API_KEY ยังไม่ได้ตั้งค่า' }, { status: 500 });
    }

    const body = await request.json();
    const { imageBase64, headline, template, customPrompt } = body;

    if (!imageBase64 || !headline) {
      return NextResponse.json({ success: false, error: 'ต้องการ imageBase64 และ headline' }, { status: 400 });
    }

    const res = await addTextOverlay({ imageBase64, headline, template, customPrompt });
    if (!res.success) {
      return NextResponse.json({ success: false, error: res.error }, { status: 500 });
    }

    return NextResponse.json(res);
  } catch (error) {
    console.error('[ImageText] ❌', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

