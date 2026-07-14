import { NextResponse } from 'next/server';
import { MODEL_VISION } from '@/lib/ai/modelConfig';
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
    const { imageBase64, templateName, autoSave = false, format = 'composer' } = await request.json();

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

    // ═══════════════════════════════════════════════════════════════
    // COVER FORMAT — Portrait 1080x1350 system prompt (★ 14 ก.ค.: ย่อจาก 1200 ตาม canvas หน้า /cover-tester)
    // ═══════════════════════════════════════════════════════════════
    const isCoverFormat = format === 'cover';

    const coverSystemPrompt = `You are a pixel-accurate Template Layout Analyzer for Thai news cover images.
Your ONLY job: analyze the uploaded image and output a JSON template with EVERY photo zone.

=== CRITICAL: COUNT ALL ZONES ===
Before outputting, you MUST count EVERY distinct photo in the image.
Most Thai news covers have 4-6 photo zones. If you find fewer than 4, look again more carefully.
Common pattern: 1 main hero + 1-2 backgrounds + 1 highlight box + 1-2 circles = 4-6 total.

=== CANVAS ===
Canvas = 1080 x 1350 px (portrait, Facebook/IG 4:5)
- Left edge = x:0, Right edge = x:1080
- Top edge = y:0, Bottom edge = y:1350
- Center = x:540, y:675

=== STEP-BY-STEP ANALYSIS ===
1. Find the LARGEST photo (hero/main face) — usually 50-65% of width, full height
2. Find background areas that fill BEHIND the hero — these are bg_top and bg_bottom
3. Find any BORDERED rectangle (yellow/gold/green/red border) — this is highlight
4. Find any CIRCLE-cropped photos — could be 1-3 circles with different sizes and borders
5. Find any small detail photos that don't fit above categories
6. VERIFY: total zones should be 4-6

=== SLOT TYPES ===
- "bg_top"      = background photo upper-right area. Fades: fadeLeft + fadeBottom. zIndex: 0
- "bg_bottom"   = background photo lower-right area. Fades: fadeLeft + fadeTop. zIndex: 0
- "bg_right"    = single background covering right side full-height. Fades: fadeLeft. zIndex: 0
- "main"        = largest hero photo (left side usually). Fades: fadeRight. zIndex: 2
- "sub_left"    = secondary photo. Fades vary. zIndex: 1
- "highlight"   = rectangle with colored border. draggable: true. zIndex: 3
- "circle"      = circle-cropped photo. draggable: true. zIndex: 4
- "circle_small"= smaller secondary circle. draggable: true. zIndex: 5
- "detail"      = additional detail photo. zIndex: 1

=== TYPICAL LAYOUT EXAMPLE (5 zones) ===
Hero left (60% width) + bg_top (upper right) + bg_bottom (lower right) + yellow highlight (center right) + circle (bottom left)

=== FADE EFFECTS (in pixels) ===
- fadeRight: 230-320 = photo fades to transparent on right edge (for left-side images)
- fadeLeft: 180-270  = fades on left edge (for right-side backgrounds)
- fadeTop: 140-200   = fades on top edge
- fadeBottom: 140-200 = fades on bottom edge
Background slots should overlap slightly with the main image area to prevent black gaps.

=== BORDER COLORS ===
Match the EXACT border color you see:
- Gold/Yellow = "#FFD700"
- Red = "#FF0000" or "#ef4444"
- Green/Lime = "#c4ff00" or "#a3e635"
- White = "#FFFFFF"
- Blue = "#4FC3F7"

=== OUTPUT FORMAT ===
{
  "templateName": "descriptive name in Thai",
  "desc": "short layout description in Thai",
  "slots": [
    {
      "id": "bg_top",
      "label": "🖼 ฉากหลัง (บน-ขวา)",
      "x": 414, "y": 0, "w": 666, "h": 600,
      "fadeLeft": 198, "fadeBottom": 140,
      "zIndex": 0
    },
    {
      "id": "bg_bottom",
      "label": "🖼 ฉากหลัง (ล่าง-ขวา)",
      "x": 414, "y": 700, "w": 666, "h": 650,
      "fadeLeft": 198, "fadeTop": 140,
      "zIndex": 0
    },
    {
      "id": "main",
      "label": "★ ภาพหลัก",
      "x": 0, "y": 0, "w": 666, "h": 1350,
      "fadeRight": 270,
      "zIndex": 2
    },
    {
      "id": "highlight",
      "label": "⭐ ไฮไลท์ (กรอบเหลือง)",
      "x": 486, "y": 380, "w": 522, "h": 420,
      "border": "#FFD700", "borderWidth": 5,
      "zIndex": 3,
      "draggable": true
    },
    {
      "id": "circle",
      "label": "⭕ วงกลม",
      "x": 54, "y": 880,
      "shape": "circle", "diameter": 324,
      "border": "#FFFFFF", "borderWidth": 5,
      "zIndex": 4,
      "draggable": true
    }
  ],
  "textSlots": [
    {
      "id": "line1",
      "label": "📝 บรรทัด 1",
      "x": 540, "y": 1060,
      "fontSize": 52,
      "color": "#FFD700",
      "fontWeight": "bold",
      "align": "center",
      "maxWidth": 972,
      "stroke": "#000000",
      "strokeWidth": 3,
      "bg": "#1a1a2e",
      "bgPadX": 18, "bgPadY": 14,
      "bgFullWidth": true,
      "placeholder": "พาดหัวหลัก..."
    }
  ]
}

=== TEXT OVERLAY DETECTION ===
7. After detecting photo zones, look for ANY text overlays in the image
8. Text can appear as: headlines, captions, labels, banners, name tags
9. For each text area, determine: position (x,y), font size, color, alignment
10. Common text styles: white text with black stroke, yellow on dark strip, black on white label

=== TEXT SLOT PROPERTIES ===
- id: "line1", "line2", "line3" (sequential)
- label: "📝 บรรทัด 1", "📝 บรรทัด 2", etc
- x, y: center position of the text on 1080x1350 canvas
- fontSize: estimated font size in pixels (30-60 typical)
- color: text color (match the template)
- fontWeight: "bold" or "normal"
- align: "center", "left", or "right"
- maxWidth: max text width before wrapping (usually 700-980)
- stroke: stroke/outline color (usually "#000000" for readability)
- strokeWidth: 2-5 pixels
- bg: background strip color behind text (if visible). Use hex color or "rgba(0,0,0,0.7)"
- bgPadX, bgPadY: padding around text background (12-20px typical)
- bgFullWidth: true if the background strip extends full canvas width
- placeholder: default placeholder text in Thai

=== RULES ===
- You MUST include bg_top and/or bg_bottom for background areas (don't skip them!)
- highlight and circle: MUST have "draggable": true
- circle: MUST have "shape": "circle" and "diameter" (NOT w/h)
- If you see 2 circles, use "circle" for larger and "circle_small" for smaller
- Background slots should extend slightly beyond visible area for bleed
- If the image has NO text, set "textSlots": []
- If the image HAS text, include ALL text lines as textSlots
- Minimum 4 image slots, maximum 8 slots
- Return ONLY the JSON. No markdown. No explanation. No code blocks.`;

    const userMessage = isCoverFormat 
      ? `Analyze this news cover template image with extreme precision.
Canvas = 1080x1350 pixels (portrait format).
Template name: "${templateName || 'custom_cover'}"

IMPORTANT: Count every distinct photo zone carefully. Most covers have 4-6 zones.
You MUST include background zones (bg_top/bg_bottom) — don't skip them!
Return ONLY the JSON with ALL slot positions.`
      : `Analyze this news thumbnail template image precisely.
Canvas = 1080x1080 pixels.
Template name: "${templateName || 'custom_template'}"
Return ONLY the JSON object with all slot positions.`;

    rlog.step('gpt4o-vision', 'calling GPT-4o Vision (detail:high, max_tokens:2500)...');

    // ★ GPT-5.5 compatibility
    const _isNew = MODEL_VISION.startsWith('gpt-5') || MODEL_VISION.startsWith('o1') || MODEL_VISION.startsWith('o3');
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_VISION,
        ...(_isNew ? { max_completion_tokens: isCoverFormat ? 4000 : 2500 } : { max_tokens: isCoverFormat ? 4000 : 2500 }),
        ...(_isNew ? {} : { temperature: 0.05 }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: isCoverFormat ? coverSystemPrompt : systemPrompt },
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

    // ── Cover format: normalize slots differently ──────────────────
    let coverSlots = null;
    if (isCoverFormat) {
      coverSlots = (templateData.slots || []).map((s, i) => {
        const slot = {
          id: s.id || ('slot_' + (i + 1)),
          label: s.label || s.id || ('Slot ' + (i + 1)),
          x: Math.round(s.x ?? s.position?.x ?? 0),
          y: Math.round(s.y ?? s.position?.y ?? 0),
          zIndex: s.zIndex ?? i,
        };
        // Circle slots
        if (s.shape === 'circle' || s.id?.includes('circle')) {
          slot.shape = 'circle';
          slot.diameter = Math.round(s.diameter || s.w || s.position?.w || 300);
        } else {
          slot.w = Math.round(s.w ?? s.position?.w ?? 300);
          slot.h = Math.round(s.h ?? s.position?.h ?? 300);
        }
        // Fade effects
        if (s.fadeRight) slot.fadeRight = Math.round(s.fadeRight);
        if (s.fadeLeft) slot.fadeLeft = Math.round(s.fadeLeft);
        if (s.fadeTop) slot.fadeTop = Math.round(s.fadeTop);
        if (s.fadeBottom) slot.fadeBottom = Math.round(s.fadeBottom);
        // Border
        if (s.border) { slot.border = s.border; slot.borderWidth = s.borderWidth || 5; }
        // Draggable
        if (s.draggable || s.id === 'highlight' || s.id === 'circle' || s.id?.includes('highlight') || s.id?.includes('circle')) {
          slot.draggable = true;
        }
        return slot;
      });
    }

    if (slots.length === 0 && !coverSlots?.length) {
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
    rlog.done('Template: "' + finalTemplate.templateName + '" | ' + (isCoverFormat ? (coverSlots?.length || 0) : slots.length) + ' slots | tokens: ' + tokens + ' | ' + elapsed + 's');

    // ── Build cover-format template for saving to library ───────────
    let coverTemplate = null;
    if (isCoverFormat && coverSlots) {
      // Normalize text slots from AI output
      const coverTextSlots = (templateData.textSlots || []).map((ts, i) => ({
        id: ts.id || ('line' + (i + 1)),
        label: ts.label || ('📝 บรรทัด ' + (i + 1)),
        x: Math.round(ts.x ?? 540),
        y: Math.round(ts.y ?? (1060 + i * 100)),
        fontSize: ts.fontSize || 48,
        color: ts.color || '#FFFFFF',
        fontWeight: ts.fontWeight || 'bold',
        align: ts.align || 'center',
        maxWidth: ts.maxWidth || 960,
        stroke: ts.stroke || '#000000',
        strokeWidth: ts.strokeWidth || 3,
        ...(ts.bg && { bg: ts.bg, bgPadX: ts.bgPadX || 18, bgPadY: ts.bgPadY || 14, bgEditable: true }),
        ...(ts.bgFullWidth && { bgFullWidth: true }),
        placeholder: ts.placeholder || 'พิมพ์ข้อความ...',
      }));

      coverTemplate = {
        id: templateId,
        name: templateData.templateName || templateName || 'Custom Cover',
        desc: templateData.desc || templateData.analysis || '',
        canvasW: 1080,   // ★ 14 ก.ค.: แสตมป์สเปซพิกัด — ตัวโหลดฝั่ง UI ใช้แยกแทมเพลตเก่า 1200 / ใหม่ 1080
        canvasH: 1350,
        textSlots: coverTextSlots,
        slots: coverSlots,
        source: 'ai_analyzed',
        createdAt: new Date().toISOString(),
      };
    }

    // ── Auto-save to library ────────────────────────────────────────
    if (autoSave || isCoverFormat) {
      try {
        const toSave = isCoverFormat ? coverTemplate : finalTemplate;
        await saveTemplate(toSave);
        console.log('[TemplateAnalyzer] ✅ Saved to library:', templateId);
      } catch (e) {
        console.warn('[TemplateAnalyzer] Save failed:', e.message);
      }
    }

    return NextResponse.json({
      success: true,
      templateId,
      template: isCoverFormat ? coverTemplate : finalTemplate,
      saved: autoSave || isCoverFormat,
      tokensUsed: tokens,
      durationSeconds: parseFloat(elapsed),
    });

  } catch (error) {
    console.error('[TemplateAnalyzer] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
