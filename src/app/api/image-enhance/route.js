import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const rlog = createLogger('FAL-ENHANCE');

/**
 * FAL.ai Flux Kontext — Image Enhancement
 * รับ: Sharp layout (base64) + template reference (base64) + prompt
 * ส่งออก: Enhanced image ที่ blend ได้เป็นธรรมชาติ
 */
export async function POST(request) {
  const startTime = Date.now();
  try {
    const { layoutBase64, templateRefBase64, newsTitle } = await request.json();

    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) {
      return NextResponse.json({ success: false, error: 'FAL_KEY ยังไม่ได้ตั้งค่า' }, { status: 500 });
    }
    if (!layoutBase64) {
      return NextResponse.json({ success: false, error: 'ต้องการ layoutBase64' }, { status: 400 });
    }

    rlog.start(`layout: ${layoutBase64.length} chars | hasRef: ${!!templateRefBase64}`);
    rlog.model('FAL Flux Kontext Pro', 'image editing + blending');
    rlog.inject('FAL_KEY', FAL_KEY ? '✅ set' : '❌ MISSING');

    // ─── Build Enhancement Prompt ──────────────────────────────────
    const prompt = [
      'Professional Thai viral news thumbnail.',
      'Blend all photos naturally with seamless edges.',
      'Consistent cinematic lighting across all images.',
      'Vibrant colors, sharp faces, no black empty areas.',
      'All photos fill their zones completely.',
      newsTitle ? `News headline context: "${newsTitle.slice(0, 80)}"` : '',
      'Maintain exact layout positions. Do not add text.',
    ].filter(Boolean).join(' ');

    rlog.prompt('Flux Kontext enhancement prompt', `length: ${prompt.length}ch`);

    // ─── Call FAL Flux Kontext ─────────────────────────────────────
    // Flux Kontext: edit an existing image following text instructions
    const falBody = {
      prompt,
      image_url: layoutBase64.startsWith('data:') ? layoutBase64 : `data:image/jpeg;base64,${layoutBase64}`,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      seed: Math.floor(Math.random() * 1000000),
    };

    rlog.step('fal-api-call', 'POST fal-ai/flux-pro/kontext | steps:28 | guidance:3.5');

    const falRes = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(falBody),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error('[FAL-ENHANCE] API error:', errText.slice(0, 300));
      throw new Error(`FAL API error ${falRes.status}: ${errText.slice(0, 150)}`);
    }

    const falData = await falRes.json();
    rlog.step('fal-api-done', `status: ok | data keys: ${Object.keys(falData).join(', ')}`);

    // ─── Extract result image ──────────────────────────────────────
    const outputUrl = falData?.images?.[0]?.url || falData?.image?.url || falData?.url;
    if (!outputUrl) {
      console.error('[FAL-ENHANCE] Unexpected response:', JSON.stringify(falData).slice(0, 300));
      throw new Error('FAL ไม่ return URL รูป');
    }

    rlog.step('download-result', `fetching: ${outputUrl.slice(0, 80)}...`);

    // ─── Download result → base64 ──────────────────────────────────
    const imgRes = await fetch(outputUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) throw new Error(`ดาวน์โหลดรูปไม่ได้: HTTP ${imgRes.status}`);
    const imgBuf = await imgRes.arrayBuffer();
    const resultB64 = `data:image/jpeg;base64,${Buffer.from(imgBuf).toString('base64')}`;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.done(`✅ Enhanced image ready | ${elapsed}s | ${(imgBuf.byteLength / 1024).toFixed(0)}KB`);

    return NextResponse.json({
      success: true,
      imageBase64: resultB64,
      provider: 'fal-flux-kontext',
      durationSeconds: parseFloat(elapsed),
    });

  } catch (error) {
    rlog.error(error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
