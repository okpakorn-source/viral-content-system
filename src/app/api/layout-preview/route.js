import { NextResponse } from 'next/server';

/**
 * Layout Preview Generator — Ideogram Text-to-Image
 * รับ layout prompt → สร้างภาพ concept ด้วย Ideogram
 */
export async function POST(request) {
  try {
    if (!process.env.IDEOGRAM_API_KEY) {
      return NextResponse.json({ success: false, error: 'IDEOGRAM_API_KEY ยังไม่ได้ตั้งค่า' }, { status: 500 });
    }

    const body = await request.json();
    const { layoutPrompt, newsType = 'accident' } = body;

    if (!layoutPrompt?.trim()) {
      return NextResponse.json({ success: false, error: 'กรุณาใส่ layout prompt' }, { status: 400 });
    }

    const colorMap = {
      accident:      '#22c55e',
      crime:         '#ef4444',
      politics:      '#3b82f6',
      economy:       '#f59e0b',
      entertainment: '#ec4899',
    };
    const accentColor = colorMap[newsType] || '#22c55e';

    // Full prompt for Ideogram — layout concept design
    const fullPrompt = `${layoutPrompt}

Style requirements:
- Flat UI mockup / wireframe style for news thumbnail
- 1:1 square format (1080x1080)
- Dark background (#0c0c14)
- Accent color: ${accentColor}
- Show placeholder zones with labels in Thai: ใบหน้าหลัก, เหตุการณ์, บุคคลรอง, บริบท, ข้อความข่าว
- Professional Thai news broadcast aesthetic
- No real photos, only design zones and layout structure
- Show text area at bottom with headline placeholder`;

    const form = new FormData();
    form.append('prompt', fullPrompt);
    form.append('aspect_ratio', 'ASPECT_1_1');
    form.append('model', 'V_2');
    form.append('style_type', 'DESIGN');
    form.append('num_images', '2'); // สร้าง 2 ตัวอย่างให้เลือก

    const ideogramRes = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: { 'Api-Key': process.env.IDEOGRAM_API_KEY },
      body: form,
    });

    if (!ideogramRes.ok) {
      const errText = await ideogramRes.text();
      throw new Error(`Ideogram error ${ideogramRes.status}: ${errText.slice(0, 200)}`);
    }

    const ideogramData = await ideogramRes.json();
    const imageUrls = ideogramData.data?.map(img => img.url).filter(Boolean) || [];

    if (imageUrls.length === 0) {
      throw new Error('Ideogram ไม่ส่งรูปกลับมา');
    }

    // Convert URLs → base64 for embedding
    const base64Images = await Promise.all(
      imageUrls.map(async (url) => {
        const imgRes = await fetch(url);
        if (!imgRes.ok) return null;
        const buf = await imgRes.arrayBuffer();
        return `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;
      })
    );

    return NextResponse.json({
      success: true,
      previews: base64Images.filter(Boolean),
      prompt: layoutPrompt,
      newsType,
    });

  } catch (error) {
    console.error('[LayoutPreview] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
