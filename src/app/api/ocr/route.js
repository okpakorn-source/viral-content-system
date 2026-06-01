import { NextResponse } from 'next/server';
import { performOcr } from '@/lib/services/ocrService';

/**
 * POST /api/ocr
 * รับ 2 formats:
 *  1. FormData: form.get('image') — single file upload (ใช้จาก manual UI)
 *  2. JSON: { images: string[], mode: string } — base64 array (ใช้จาก /api/auto/process)
 */
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let dataUrls = [];
    let mode = 'full';

    // ── Format 1: FormData (single image upload from UI) ──────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const imageFile = formData.get('image');

      if (!imageFile) {
        return NextResponse.json({ success: false, error: 'ไม่พบภาพ' }, { status: 400 });
      }

      const bytes    = await imageFile.arrayBuffer();
      const buffer   = Buffer.from(bytes);
      const base64   = buffer.toString('base64');
      const mimeType = imageFile.type || 'image/png';
      dataUrls = [`data:${mimeType};base64,${base64}`];
      console.log(`[OCR] FormData: ${imageFile.name}, ${(buffer.length / 1024).toFixed(0)}KB`);

    // ── Format 2: JSON { images: base64[], mode } (from process route) ─
    } else {
      const body = await request.json();
      mode = body.mode || 'full';

      const rawImages = body.images || (body.imageData ? [body.imageData] : []);
      if (!rawImages || rawImages.length === 0) {
        return NextResponse.json({ success: false, error: 'ไม่พบภาพ' }, { status: 400 });
      }

      // Normalize each image to data URL format
      dataUrls = rawImages.slice(0, 4).map(img => {
        if (!img || typeof img !== 'string') return null;
        // Already a data URL
        if (img.startsWith('data:')) return img;
        // Raw base64 — assume JPEG
        return `data:image/jpeg;base64,${img}`;
      }).filter(Boolean);

      if (dataUrls.length === 0) {
        return NextResponse.json({ success: false, error: 'รูปภาพไม่ถูกต้อง' }, { status: 400 });
      }
      console.log(`[OCR] JSON: ${dataUrls.length} image(s), mode: ${mode}`);
    }

    // Call OCR Service directly
    const result = await performOcr({ dataUrls, mode });
    return NextResponse.json(result);

  } catch (error) {
    console.error('[OCR-Route] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'อ่านภาพไม่สำเร็จ: ' + (error.message || 'Unknown error'),
    }, { status: 500 });
  }
}

