import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const IDEOGRAM_REMIX_URL = 'https://api.ideogram.ai/remix';
const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY;
const rlog = createLogger('IDEOGRAM');

/**
 * Ideogram Text Overlay — ใช้ Remix API
 * รับ base image (base64) + headline text → เพิ่มข้อความสวยงามบนรูป
 * Prompt ทั้งหมดถูกล็อคจาก image-maker เท่านั้น — ไม่เชื่อมกับ content system
 */
export async function POST(request) {
  try {
    if (!IDEOGRAM_KEY) {
      return NextResponse.json({ success: false, error: 'IDEOGRAM_API_KEY ยังไม่ได้ตั้งค่า' }, { status: 500 });
    }

    const body = await request.json();
    const { imageBase64, headline, template, customPrompt } = body;

    if (!imageBase64 || !headline) {
      return NextResponse.json({ success: false, error: 'ต้องการ imageBase64 และ headline' }, { status: 400 });
    }

    // Default prompt — locked to text overlay only
    const defaultPrompt = `Add bold Thai news headline text at the bottom of this image.
Text: "${headline}"
Style: Bold white text, dark stroke/shadow for readability, professional Thai news broadcast style
Position: Bottom 15-20% of image, horizontally centered
Background: Semi-transparent black bar (65% opacity) behind text
Font size: Large and impactful
IMPORTANT: Do NOT change any other part of the image. Only add text at the bottom.`;

    // ถ้ามี customPrompt จาก Prompt Manager — ใช้แทน default แต่ยังล็อค scope
    const usingCustom = Boolean(customPrompt?.trim());
    const finalPrompt = usingCustom
      ? `${customPrompt.trim()}\nText to add: "${headline}"\nDo NOT change any other part of the image.`
      : defaultPrompt;

    rlog.start(`headline: "${headline.slice(0,50)}" | template: ${template||'-'}`);
    rlog.prompt(
      usingCustom ? 'CUSTOM text-style prompt' : 'DEFAULT text overlay prompt',
      `length: ${finalPrompt.length}ch | headline: "${headline.slice(0,40)}"`
    );
    rlog.model('Ideogram V_2 /remix', `style: REALISTIC | image_weight: 85% preserve | aspect: 1:1`);
    rlog.inject('IDEOGRAM_KEY', IDEOGRAM_KEY ? '✅ set' : '❌ MISSING');

    // Convert base64 → Buffer → Blob
    const b64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(b64Data, 'base64');
    const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });

    // Ideogram Remix requires: image_request (JSON) + image_file (multipart)
    const imageRequest = JSON.stringify({
      prompt: finalPrompt,
      aspect_ratio: 'ASPECT_1_1',
      model: 'V_2',
      style_type: 'REALISTIC',
      image_weight: 85,  // 85% preserve original, 15% apply prompt
    });

    const formData = new FormData();
    formData.append('image_request', imageRequest);
    formData.append('image_file', imageBlob, 'layout.jpg');

    rlog.step('ideogram-call', `calling /remix | image: ${(imageBuffer.length/1024).toFixed(0)}KB`);
    console.log('[ImageText] 📤 Calling Ideogram /remix — headline:', headline.slice(0, 50));

    const res = await fetch(IDEOGRAM_REMIX_URL, {
      method: 'POST',
      headers: { 'Api-Key': IDEOGRAM_KEY },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ideogram /remix error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const outputUrl = data?.data?.[0]?.url;

    if (!outputUrl) throw new Error('Ideogram ไม่ return URL รูป — response: ' + JSON.stringify(data).slice(0, 200));

    // Fetch result → base64
    const resultRes = await fetch(outputUrl);
    if (!resultRes.ok) throw new Error('ดาวน์โหลดรูปจาก Ideogram ไม่สำเร็จ');
    const resultBuf = await resultRes.arrayBuffer();
    const resultB64 = `data:image/jpeg;base64,${Buffer.from(resultBuf).toString('base64')}`;

    rlog.done(`✅ Text overlay done via Ideogram | headline: "${headline.slice(0,40)}" | url: ${outputUrl.slice(0,60)}...`);
    console.log('[ImageText] ✅ Text added via Ideogram /remix:', headline.slice(0, 40));

    return NextResponse.json({ success: true, imageBase64: resultB64, provider: 'ideogram-remix' });

  } catch (error) {
    console.error('[ImageText] ❌', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
