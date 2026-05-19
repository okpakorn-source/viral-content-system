import { NextResponse } from 'next/server';

/**
 * Template Analyzer Agent (GPT-4o Vision)
 * รับรูปตัวอย่าง → วิเคราะห์โครงสร้าง → ส่งกลับ Template JSON
 * ห้ามทำอย่างอื่น — ทำแค่นี้เท่านั้น
 */
export async function POST(request) {
  try {
    const { imageBase64, templateName } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งรูปตัวอย่าง' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'OPENAI_API_KEY ไม่ได้ตั้งค่า' }, { status: 500 });
    }

    // ─── System Prompt: Template Analyzer Agent ───────────────────────
    const systemPrompt = `You are a Template Layout Analyzer Agent. Your ONLY job is to analyze news thumbnail image templates and extract their precise layout structure as JSON.

You must:
1. Analyze the uploaded image carefully
2. Identify ALL photo zones (rectangles, circles, overlapping areas)
3. Calculate exact positions and sizes relative to the canvas (assumed 1080x1080)
4. Determine the role of each zone
5. Return a precise JSON template definition

Zone roles to use:
- "main_face" = primary person/subject photo
- "context" = background or supporting photo
- "event" = action/event/evidence photo
- "secondary" = secondary person or location
- "memorial" = circle portrait (memorial or highlight)
- "background" = full-canvas background image

Effects to use:
- "none" = no effect
- "circle_color" = circular crop with white ring border
- "border_lime" = lime green border (#a3e635)
- "desaturate" = desaturate the image slightly
- "blur_dark" = blur and darken

IMPORTANT RULES:
- Canvas is always 1080x1080 pixels
- Be as precise as possible with coordinates
- If a photo is a circle, use effect "circle_color" and make w=h (diameter)
- Gaps between zones are usually 4-8px
- Circle zones typically overlap adjacent rectangular zones
- ONLY return the JSON, nothing else

Return this exact JSON format:
{
  "templateName": "ชื่อ template",
  "canvas": { "width": 1080, "height": 1080 },
  "totalPhotosNeeded": 5,
  "zones": [
    {
      "id": "z1",
      "role": "main_face",
      "position": { "x": 0, "y": 0, "w": 537, "h": 537 },
      "effect": "none",
      "description": "อธิบายสั้นๆว่าช่องนี้ใช้ทำอะไร"
    }
  ],
  "colorScheme": {
    "border": "#ffffff",
    "borderWidth": 6
  },
  "analysis": "อธิบายโครงสร้างโดยรวม 1-2 ประโยค"
}`;

    const userMessage = `Analyze this news thumbnail template image. Extract the EXACT layout structure with precise pixel coordinates (assuming 1080x1080 canvas). 
Template name requested: "${templateName || 'custom_template'}"
Return ONLY the JSON.`;

    // ─── Call GPT-4o Vision ────────────────────────────────────────────
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2000,
        temperature: 0.1, // ต่ำมาก — ต้องการความแม่นยำ ไม่ใช่ creativity
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`,
                  detail: 'high', // ใช้ high detail เพื่อความแม่นยำ
                },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('[TemplateAnalyzer] OpenAI error:', errText);
      return NextResponse.json({ success: false, error: `OpenAI API error: ${openaiRes.status}` }, { status: 500 });
    }

    const openaiData = await openaiRes.json();
    const rawContent = openaiData.choices?.[0]?.message?.content || '';

    console.log('[TemplateAnalyzer] Raw response length:', rawContent.length);
    console.log('[TemplateAnalyzer] Tokens used:', openaiData.usage?.total_tokens);

    // ─── Parse JSON from response ──────────────────────────────────────
    let templateData;
    try {
      // ล้าง markdown code block ถ้ามี
      const cleaned = rawContent
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/gi, '')
        .trim();
      templateData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[TemplateAnalyzer] JSON parse error:', parseErr.message);
      console.error('[TemplateAnalyzer] Raw:', rawContent.slice(0, 500));
      return NextResponse.json({
        success: false,
        error: 'วิเคราะห์ template ไม่สำเร็จ — AI ตอบผิดรูปแบบ',
        rawResponse: rawContent.slice(0, 300),
      }, { status: 422 });
    }

    // ─── Generate unique template ID ─────────────────────────────────
    const safeName = (templateData.templateName || templateName || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 30);
    const templateId = `${safeName}_${Date.now()}`;

    console.log(`[TemplateAnalyzer] ✅ Template analyzed: "${templateData.templateName}" | ${templateData.zones?.length} zones | ${templateData.totalPhotosNeeded} photos`);

    return NextResponse.json({
      success: true,
      templateId,
      template: {
        id: templateId,
        name: templateData.templateName || templateName || 'Custom Template',
        zones: templateData.zones || [],
        canvas: templateData.canvas || { width: 1080, height: 1080 },
        colorScheme: templateData.colorScheme || { border: '#ffffff', borderWidth: 6 },
        totalPhotosNeeded: templateData.totalPhotosNeeded || templateData.zones?.length || 0,
        analysis: templateData.analysis || '',
        createdAt: new Date().toISOString(),
      },
      tokensUsed: openaiData.usage?.total_tokens || 0,
    });

  } catch (error) {
    console.error('[TemplateAnalyzer] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
