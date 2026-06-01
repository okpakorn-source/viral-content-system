import { NextResponse } from 'next/server';
import { saveTemplate } from '@/lib/template-library/store';
import { createLogger } from '@/lib/logger';

const rlog = createLogger('TEMPLATE-ANALYZER');

/**
 * Template Reverse Engineer — GPT-4o Vision
 *
 * Upload sample image → AI extracts pixel-accurate slot layout → Template JSON
 * Optional: autoSave=true → saves to template library automatically
 *
 * Rules:
 * - Canvas assumed 1080x1080 unless image has different aspect ratio
 * - All positions are pixel coordinates (x, y, w, h)
 * - Supports: rect, circle, background slots
 * - Output slots[] compatible with imageComposer.composeImage()
 */
export async function POST(request) {
  const startTime = Date.now();
  try {
    const { imageBase64, templateName, autoSave = false } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งรูปตัวอย่าง (imageBase64)' }, { status: 400 });
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'OPENAI_API_KEY ไม่ได้ตั้งค่า' }, { status: 500 });
    }

    rlog.start('Analyzing template image | autoSave: ' + autoSave);

    // ═══════════════════════════════════════════════════════════════
    // SYSTEM PROMPT — Template Reverse Engineer
    // ═══════════════════════════════════════════════════════════════
    const systemPrompt = `You are a pixel-accurate Template Layout Analyzer for Thai news thumbnails.
Your ONLY job: analyze the uploaded image and output a JSON template defining exact slot positions.

=== HOW TO ANALYZE ===
1. Look for ALL rectangular or circular photo zones in the image
2. Estimate x, y, width, height for each zone (canvas = 1080x1080 px)
3. Identify each zone's visual role and priority
4. Note effects: blurred background, colored borders, circle crops, dark overlays
5. Note canvas background type (solid, blurred image, gradient)

=== SLOT ROLES ===
- "main_face"   = largest / primary face photo (usually left or center)
- "context"     = background scene, location, or supporting image
- "event"       = action shot, evidence, event photo (often has colored border)
- "secondary"   = secondary person or scene photo
- "memorial"    = circle-cropped portrait (small, often overlapping)
- "background"  = full-canvas blurred background image

=== EFFECTS ===
- "none"            = no effect
- "circle_color"    = circle crop with white ring border
- "circle_bw"       = circle crop, grayscale
- "soft_right"      = fade to transparent on right edge
- "soft_left"       = fade to transparent on left edge
- "soft_top"        = fade to transparent on top edge
- "blur_dark"       = heavily blurred + darkened (for backgrounds)
- "desaturate"      = desaturated / muted color
- "border_lime"     = lime green border (#a3e635)
- "border_red"      = red border (#ef4444)
- "border_green"    = green border (#22c55e)
- "border_gold"     = gold border (#f59e0b)

=== MEASUREMENT TIPS ===
- Total canvas = 1080x1080 px
- Gaps between slots = 4-8px typically
- Circles: set w = h = diameter
- Background zone always starts at x:0, y:0, w:1080, h:1080
- Be precise within ±20px

=== SLOT PRIORITIES (for subject matching) ===
Each slot must have a "priority" field:
- "face_closeup"    = needs a clear close-up face
- "context_action"  = action or scene photo
- "reaction_face"   = small circle reaction/emotion face
- "background_blur" = any image used as background
- "supporting"      = secondary content image

=== OUTPUT FORMAT (strict) ===
{
  "templateName": "descriptive name in Thai",
  "canvas": { "width": 1080, "height": 1080 },
  "totalPhotosNeeded": 4,
  "background": {
    "type": "image_blur | solid_color | gradient",
    "color": "#0c0c14",
    "blur": 28,
    "darkOverlay": 0.45,
    "source": "main_face | first_image"
  },
  "slots": [
    {
      "id": "main",
      "role": "main_face",
      "priority": "face_closeup",
      "position": { "x": 0, "y": 0, "w": 590, "h": 780 },
      "effect": "soft_right",
      "borderRadius": 0,
      "description": "หน้าหลักซ้าย"
    }
  ],
  "colorScheme": {
    "border": "#a3e635",
    "borderWidth": 8,
    "accentColor": "#a3e635"
  },
  "analysis": "อธิบายโครงสร้างรวม 1-2 ประโยค"
}

CRITICAL: Return ONLY the JSON. No markdown. No explanation. No code blocks.`;

    const userMessage = `Analyze this news thumbnail template image precisely.
Canvas = 1080x1080 pixels.
Template name: "${templateName || 'custom_template'}"
Return ONLY the JSON object with all slot positions.`;

    rlog.step('gpt4o-vision', 'calling GPT-4o Vision (detail:high, max_tokens:2500)...');

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2500,
        temperature: 0.05, // เกือบ 0 — ต้องการความแม่นยำสูงสุด
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.startsWith('data:') ? imageBase64 : 'data:image/jpeg;base64,' + imageBase64,
                  detail: 'high', // max detail — ต้องเห็น pixel positions ชัด
                },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('[TemplateAnalyzer] OpenAI error:', errText.slice(0, 200));
      return NextResponse.json({ success: false, error: 'OpenAI API error: ' + openaiRes.status }, { status: 500 });
    }

    const openaiData = await openaiRes.json();
    const rawContent = openaiData.choices?.[0]?.message?.content || '';
    const tokens = openaiData.usage?.total_tokens || 0;

    rlog.step('gpt4o-done', 'tokens: ' + tokens + ' | response: ' + rawContent.length + 'ch');

    // ── Parse JSON ──────────────────────────────────────────────────
    let templateData;
    try {
      const cleaned = rawContent.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
      templateData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[TemplateAnalyzer] Parse error:', rawContent.slice(0, 200));
      return NextResponse.json({
        success: false,
        error: 'AI ตอบ JSON ผิดรูปแบบ — ลองอีกครั้ง',
        rawResponse: rawContent.slice(0, 300),
      }, { status: 422 });
    }

    // ── Validate + normalize slots ─────────────────────────────────
    const slots = (templateData.slots || templateData.zones || []).map((s, i) => ({
      id: s.id || ('slot_' + (i + 1)),
      role: s.role || 'context',
      priority: s.priority || 'supporting',
      position: {
        x: Math.round(s.position?.x ?? s.x ?? 0),
        y: Math.round(s.position?.y ?? s.y ?? 0),
        w: Math.round(s.position?.w ?? s.width ?? 300),
        h: Math.round(s.position?.h ?? s.height ?? 300),
      },
      effect: s.effect || 'none',
      borderRadius: s.borderRadius || 0,
      darkOverlay: s.darkOverlay || 0,
      description: s.description || '',
    }));

    if (slots.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'วิเคราะห์ไม่พบ slots — ลองอัปโหลดรูปที่ชัดกว่านี้',
      }, { status: 422 });
    }

    // ── Build final template object ────────────────────────────────
    const safeName = (templateData.templateName || templateName || 'custom')
      .toLowerCase().replace(/[^a-z0-9ก-๙]/g, '_').replace(/_+/g, '_').slice(0, 40);
    const templateId = 'tmpl_' + Date.now();

    const finalTemplate = {
      id: templateId,
      templateName: templateData.templateName || templateName || 'Custom Template',
      canvas: templateData.canvas || { width: 1080, height: 1080 },
      background: templateData.background || { type: 'image_blur', blur: 28, darkOverlay: 0.4, source: 'main_face' },
      slots,
      colorScheme: templateData.colorScheme || { border: '#ffffff', borderWidth: 6, accentColor: '#ffffff' },
      totalPhotosNeeded: templateData.totalPhotosNeeded || slots.filter(s => s.role !== 'background').length,
      analysis: templateData.analysis || '',
      source: 'reverse_engineered',
      isFavorite: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // ── Compatibility: expose slots as zones[] for imageComposer ──
      zones: slots.map(s => ({
        id: s.id,
        role: s.role,
        position: s.position,
        effect: s.effect,
        borderRadius: s.borderRadius,
        darkOverlay: s.darkOverlay,
      })),
    };

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.done('Template: "' + finalTemplate.templateName + '" | ' + slots.length + ' slots | tokens: ' + tokens + ' | ' + elapsed + 's');

    // ── Auto-save to library ────────────────────────────────────────
    if (autoSave) {
      try {
        await saveTemplate(finalTemplate);
        console.log('[TemplateAnalyzer] ✅ Auto-saved to library:', templateId);
      } catch (e) {
        console.warn('[TemplateAnalyzer] Auto-save failed:', e.message);
      }
    }

    return NextResponse.json({
      success: true,
      templateId,
      template: finalTemplate,
      saved: autoSave,
      tokensUsed: tokens,
      durationSeconds: parseFloat(elapsed),
    });

  } catch (error) {
    console.error('[TemplateAnalyzer] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
