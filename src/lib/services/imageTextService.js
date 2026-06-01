import { createLogger } from '@/lib/logger';

const IDEOGRAM_REMIX_URL = 'https://api.ideogram.ai/remix';
const rlog = createLogger('IDEOGRAM-SERVICE');

/**
 * Ideogram Text Overlay using Remix API
 * @param {Object} params
 * @param {string} params.imageBase64 - Base64 string of the base image
 * @param {string} params.headline - Text headline to add to the image
 * @param {string} [params.template] - Layout template name
 * @param {string} [params.customPrompt] - Custom prompt for styling
 * @returns {Promise<{success: boolean, imageBase64?: string, error?: string, provider?: string}>}
 */
export async function addTextOverlay({ imageBase64, headline, template, customPrompt }) {
  try {
    const IDEOGRAM_KEY = process.env.IDEOGRAM_API_KEY;
    if (!IDEOGRAM_KEY) {
      throw new Error('IDEOGRAM_API_KEY ยังไม่ได้ตั้งค่า');
    }
    if (!imageBase64 || !headline) {
      throw new Error('ต้องการ imageBase64 และ headline');
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

    rlog.start(`headline: "${headline.slice(0, 50)}" | template: ${template || '-'}`);
    rlog.prompt(
      usingCustom ? 'CUSTOM text-style prompt' : 'DEFAULT text overlay prompt',
      `length: ${finalPrompt.length}ch | headline: "${headline.slice(0, 40)}"`
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

    rlog.step('ideogram-call', `calling /remix | image: ${(imageBuffer.length / 1024).toFixed(0)}KB`);
    console.log('[ImageText-Service] 📤 Calling Ideogram /remix — headline:', headline.slice(0, 50));

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

    if (!outputUrl) {
      throw new Error('Ideogram ไม่ return URL รูป — response: ' + JSON.stringify(data).slice(0, 200));
    }

    // Fetch result → base64
    const resultRes = await fetch(outputUrl);
    if (!resultRes.ok) throw new Error('ดาวน์โหลดรูปจาก Ideogram ไม่สำเร็จ');
    const resultBuf = await resultRes.arrayBuffer();
    const resultB64 = `data:image/jpeg;base64,${Buffer.from(resultBuf).toString('base64')}`;

    rlog.done(`✅ Text overlay done via Ideogram | headline: "${headline.slice(0, 40)}" | url: ${outputUrl.slice(0, 60)}...`);
    console.log('[ImageText-Service] ✅ Text added via Ideogram /remix:', headline.slice(0, 40));

    return {
      success: true,
      imageBase64: resultB64,
      provider: 'ideogram-remix',
    };
  } catch (error) {
    console.error('[ImageText-Service] ❌', error.message);
    return { success: false, error: error.message };
  }
}
