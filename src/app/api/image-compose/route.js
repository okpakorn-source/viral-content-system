import { NextResponse } from 'next/server';
import { composeImage } from '@/lib/imageComposer';
import { TEMPLATES } from '@/lib/imageTemplates';

/**
 * Main Image Compose Orchestrator
 * รับ: รูปจริง (base64) + layout JSON จาก AI
 * ส่งออก: 2 versions — layout only + with text (Ideogram)
 */
export async function POST(request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const {
      images,           // string[] — base64 images
      layout,           // { template, assignments, colorOverride } from /api/image-analyze
      newsTitle,        // สำหรับ text version
      generateText,     // boolean — สร้าง text version ด้วยไหม
    } = body;

    if (!images?.length || !layout) {
      return NextResponse.json({ success: false, error: 'ต้องการ images และ layout' }, { status: 400 });
    }

    const tmpl = TEMPLATES[layout.template] || TEMPLATES.accident;

    // Map zone id → actual image base64 (จาก index ที่ AI กำหนด)
    const assignments = {};
    for (const [zoneId, imgIndex] of Object.entries(layout.assignments || {})) {
      if (images[imgIndex]) {
        assignments[zoneId] = images[imgIndex];
      }
    }

    // Also fill bg with first image if not assigned
    if (!assignments.bg && images[0]) {
      assignments.bg = images[0];
    }

    console.log('[ImageCompose] 🖼️ Template:', layout.template, '| Zones:', Object.keys(assignments).length);

    // ── VERSION A: Layout Only (no text) ──────────────────────
    const layoutBuf = await composeImage({
      templateId: layout.template,
      assignments,
      colorOverride: layout.colorOverride,
    });
    const layoutB64 = `data:image/jpeg;base64,${layoutBuf.toString('base64')}`;
    console.log('[ImageCompose] ✅ Layout version done');

    // ── VERSION B: With Text (Ideogram) ────────────────────────
    let textB64 = null;
    let textError = null;

    if (generateText && newsTitle && process.env.IDEOGRAM_API_KEY) {
      try {
        const origin = new URL(request.url).origin;
        const textRes = await fetch(`${origin}/api/image-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: layoutB64,
            headline: newsTitle,
            template: layout.template,
            colorScheme: tmpl.colorScheme,
          }),
        });
        const textData = await textRes.json();
        if (textData.success) {
          textB64 = textData.imageBase64;
          console.log('[ImageCompose] ✅ Text version done (Ideogram)');
        } else {
          textError = textData.error;
          console.warn('[ImageCompose] ⚠️ Text version failed:', textData.error);
        }
      } catch (e) {
        textError = e.message;
        console.warn('[ImageCompose] ⚠️ Text version error:', e.message);
      }
    } else if (generateText && !process.env.IDEOGRAM_API_KEY) {
      textError = 'IDEOGRAM_API_KEY ยังไม่ได้ตั้งค่า — ได้แค่ Layout version';
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ImageCompose] ✅ Done in ${duration}s`);

    return NextResponse.json({
      success: true,
      versions: {
        layout: { imageBase64: layoutB64, label: '🖼️ Layout (ไม่มีข้อความ)' },
        text: textB64 ? { imageBase64: textB64, label: '✏️ พร้อมข้อความ (Ideogram)' } : null,
      },
      textError,
      template: layout.template,
      templateName: tmpl.name,
      durationSeconds: parseFloat(duration),
    });

  } catch (error) {
    console.error('[ImageCompose] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
