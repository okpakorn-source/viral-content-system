import { NextResponse } from 'next/server';
import { transcribeYoutube } from '@/lib/services/youtubeService';

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let result;

    if (contentType.includes('multipart/form-data')) {
      // === Mode: Upload video file → Whisper ===
      const formData = await request.formData();
      const videoFile = formData.get('video');

      if (!videoFile) {
        return NextResponse.json({ success: false, error: 'ไม่พบไฟล์วิดีโอ' }, { status: 400 });
      }

      console.log(`[YouTube-Route] Upload mode: ${videoFile.name}, ${(videoFile.size / 1024 / 1024).toFixed(1)}MB`);

      const bytes = await videoFile.arrayBuffer();
      const videoBuffer = Buffer.from(bytes);

      result = await transcribeYoutube({
        videoBuffer,
        mimeType: videoFile.type
      });

    } else {
      // === Mode: YouTube URL → ดึง Subtitle ===
      const { url } = await request.json();

      if (!url) {
        return NextResponse.json({ success: false, error: 'ไม่พบ URL' }, { status: 400 });
      }

      console.log(`[YouTube-Route] URL mode: ${url}`);
      result = await transcribeYoutube({ url });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[YouTube-Route] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'ดึง transcript ไม่สำเร็จ: ' + (error.message || 'Unknown error'),
      needUpload: true,
    }, { status: 500 });
  }
}
