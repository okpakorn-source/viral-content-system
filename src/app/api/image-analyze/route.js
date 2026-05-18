import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { detectTemplate, TEMPLATES } from '@/lib/imageTemplates.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Image Analyzer — GPT-4o Vision
 * customPrompt (Prompt 1) = PRIMARY instruction — ใช้แทนระบบ default ทั้งหมด
 * ผลลัพธ์ = JSON assignments สำหรับ Sharp compositor เท่านั้น
 * ไม่เชื่อมกับ content system
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { images, newsTitle, newsType, customPrompt } = body;

    if (!images || images.length < 1) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งรูปอย่างน้อย 1 รูป' }, { status: 400 });
    }

    const suggestedTemplate = detectTemplate(newsType || '', newsTitle || '');
    const tmpl = TEMPLATES[suggestedTemplate];
    const availableZones = tmpl.layout.zones
      .filter(z => z.role !== 'background')
      .map(z => `"${z.id}" (role: ${z.role})`)
      .join(', ');
    const maxIdx = images.length - 1;

    // ── System instruction ─────────────────────────────────────
    // ถ้ามี customPrompt → ใช้เป็น PRIMARY SYSTEM PROMPT (ไม่ใช่แค่ hint)
    // ถ้าไม่มี → ใช้ default
    const systemInstruction = customPrompt?.trim()
      ? customPrompt.trim()
      : `You are an expert Thai news thumbnail layout editor.
Analyze each image and assign it to the best matching zone based on content and visual quality.
Prioritize: clear face → MAIN, event/evidence → EVENT, context/environment → CONTEXT, formal portrait → MEMORIAL.`;

    // ── Full text prompt (ส่งต่อให้ GPT-4o) ───────────────────
    const analysisPrompt = `${systemInstruction}

---
NEWS DATA:
Title: "${newsTitle || 'Not specified'}"
Type: ${newsType || 'Not specified'}
Images count: ${images.length} (indexed 0-${maxIdx})

TEMPLATE: "${suggestedTemplate}" (${tmpl.name})
Available zones to assign: ${availableZones}

---
STRICT OUTPUT RULES:
- You MUST return ONLY valid JSON, no other text
- assignments.bg and assignments.main are REQUIRED (index 0-${maxIdx})
- Use duplicate indexes if fewer images than zones
- Only include "memorial" key if a clear formal/memorial portrait exists

RETURN EXACTLY THIS JSON FORMAT:
{
  "template": "${suggestedTemplate}",
  "assignments": {"bg": 0, "main": 0, "context": 1, "event": 2, "secondary": 1},
  "hasMemorial": false,
  "confidence": 85,
  "reasoning": "short Thai explanation of choices"
}`;

    const contentParts = [
      { type: 'text', text: analysisPrompt },
      ...images.slice(0, 5).map((src, i) => ({
        type: 'image_url',
        image_url: {
          url: src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`,
          detail: 'low',
        },
      })),
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: contentParts }],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content || '{}';
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error('AI ตอบ JSON ไม่ถูกต้อง: ' + raw.slice(0, 100));
    }

    // Validate & sanitize
    const finalTemplate = TEMPLATES[result.template] ? result.template : suggestedTemplate;
    const assignments = result.assignments || {};
    if (assignments.bg === undefined) assignments.bg = 0;
    if (assignments.main === undefined) assignments.main = 0;
    for (const key of Object.keys(assignments)) {
      assignments[key] = Math.min(Math.max(0, parseInt(assignments[key]) || 0), maxIdx);
    }

    console.log('[ImageAnalyze] ✅', finalTemplate, '| Confidence:', result.confidence, '| CustomPrompt:', customPrompt ? 'YES' : 'NO');

    return NextResponse.json({
      success: true,
      layout: {
        template: finalTemplate,
        templateName: TEMPLATES[finalTemplate].name,
        assignments,
        hasMemorial: Boolean(result.hasMemorial),
        confidence: result.confidence || 80,
        reasoning: result.reasoning || '',
        usedCustomPrompt: Boolean(customPrompt?.trim()),
      },
    });

  } catch (error) {
    console.error('[ImageAnalyze] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
