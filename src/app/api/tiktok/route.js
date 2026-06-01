import { NextResponse } from 'next/server';
import { transcribeTiktok } from '@/lib/services/tiktokService';

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let result;

    if (contentType.includes('multipart/form-data')) {
      // === Mode: Upload video file ===
      const formData = await request.formData();
      const videoFile = formData.get('video');

      if (!videoFile) {
        return NextResponse.json({ success: false, error: 'ไม่พบไฟล์วิดีโอ' }, { status: 400 });
      }

      console.log(`[TikTok-Route] Upload mode: ${videoFile.name}, ${(videoFile.size / 1024 / 1024).toFixed(1)}MB`);

      const bytes = await videoFile.arrayBuffer();
      const videoBuffer = Buffer.from(bytes);

      result = await transcribeTiktok({
        videoBuffer,
        mimeType: videoFile.type || 'video/mp4'
      });

    } else {
      // === Mode: TikTok URL ===
      const { url } = await request.json();

      if (!url || !url.includes('tiktok')) {
        return NextResponse.json({ success: false, error: 'URL TikTok ไม่ถูกต้อง' }, { status: 400 });
      }

      console.log(`[TikTok-Route] URL mode: ${url}`);
      result = await transcribeTiktok({ url });
    }

    if (result.success === false) {
      return NextResponse.json(result, { status: result.statusCode || 500 });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[TikTok-Route] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'ถอดเสียงไม่สำเร็จ: ' + (error.message || 'Unknown error'),
      needUpload: error.message?.includes('download') || false,
    }, { status: 500 });
  }
}
