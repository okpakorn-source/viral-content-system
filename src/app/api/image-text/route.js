import { NextResponse } from 'next/server';

const IDEOGRAM_API_URL = 'https://api.ideogram.ai/edit';
const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY;

/**
 * Ideogram Text Overlay
 * รับ base image (base64) + headline text → เพิ่มข้อความสวยงามบนรูป
 */
export async function POST(request) {
  try {
    if (!IDEOGRAM_KEY) {
      return NextResponse.json({ success: false, error: 'IDEOGRAM_API_KEY ยังไม่ได้ตั้งค่า' }, { status: 500 });
    }

    const body = await request.json();
    const { imageBase64, headline, template, colorScheme } = body;

    if (!imageBase64 || !headline) {
      return NextResponse.json({ success: false, error: 'ต้องการ imageBase64 และ headline' }, { status: 400 });
    }

    // Choose text color based on template
    const textColor = {
      accident: '#ffffff',
      crime:    '#ffffff',
      politics: '#ffffff',
      economy:  '#fef3c7',
      entertainment: '#ffffff',
    }[template] || '#ffffff';

    const borderColor = colorScheme?.border || '#22c55e';

    // Ideogram prompt for text overlay
    const textPrompt = `Add bold Thai news headline text at the bottom of this news thumbnail image.
Text to add: "${headline}"
Text style: Bold, white color with dark shadow/outline for readability, modern Thai news style
Position: Bottom 20% of image, horizontally centered
Background: Semi-transparent dark bar behind text (#000000 at 65% opacity)
Font: Modern sans-serif, large and impactful
Do NOT change the main photo composition, only add the text overlay at the bottom
Keep all existing image elements exactly as they are`;

    // Convert base64 to blob for multipart form
    const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    const formData = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });
    formData.append('image_file', imageBlob, 'base.jpg');
    formData.append('prompt', textPrompt);
    formData.append('model', 'V_2');
    formData.append('style_type', 'REALISTIC');
    formData.append('image_weight', '90');

    const res = await fetch(IDEOGRAM_API_URL, {
      method: 'POST',
      headers: { 'Api-Key': IDEOGRAM_KEY },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ideogram API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const outputUrl = data?.data?.[0]?.url;

    if (!outputUrl) throw new Error('Ideogram ไม่ return URL รูป');

    // Fetch result and convert to base64
    const resultRes = await fetch(outputUrl);
    const resultBuf = await resultRes.arrayBuffer();
    const resultB64 = `data:image/jpeg;base64,${Buffer.from(resultBuf).toString('base64')}`;

    console.log('[ImageText] ✅ Ideogram text added:', headline.slice(0, 40));

    return NextResponse.json({
      success: true,
      imageBase64: resultB64,
      provider: 'ideogram',
    });

  } catch (error) {
    console.error('[ImageText]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
