import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { detectTemplate, TEMPLATES, getZones } from '@/lib/imageTemplates.js';
import { createLogger } from '@/lib/logger';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const rlog = createLogger('IMAGE-ANALYZE');

/**
 * Image Analyzer — GPT-4o Vision
 * customPrompt (Prompt 1) = PRIMARY instruction — ใช้แทนระบบ default ทั้งหมด
 * ผลลัพธ์ = JSON assignments สำหรับ Sharp compositor เท่านั้น
 * ไม่เชื่อมกับ content system
 */
export async function POST(request) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { images, newsTitle, newsType, customPrompt } = body;

    if (!images || images.length < 1) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งรูปอย่างน้อย 1 รูป' }, { status: 400 });
    }

    rlog.start(`images: ${images.length} | newsType: ${newsType||'-'} | title: "${(newsTitle||'').slice(0,40)}"`);

    const suggestedTemplate = detectTemplate(newsType || '', newsTitle || '');
    const tmpl = TEMPLATES[suggestedTemplate];

    // ✅ FIX: ใช้ getZones() รองรับทั้ง template เดิม (.layout.zones) และใหม่ (.zones)
    const allZones = getZones(tmpl);
    const availableZones = allZones
      .filter(z => z.role !== 'background')
      .map(z => `"${z.id}" (role: ${z.role})`)
      .join(', ');
    const maxIdx = images.length - 1;

    rlog.step('template-detect', `template: "${suggestedTemplate}" (${tmpl.name}) | zones: ${allZones.length} | images: ${images.length}`);

    // ── System instruction ─────────────────────────────────────
    // ถ้ามี customPrompt → ใช้เป็น PRIMARY SYSTEM PROMPT (ไม่ใช่แค่ hint)
    // ถ้าไม่มี → ใช้ default
    const usingCustomPrompt = Boolean(customPrompt?.trim());
    const systemInstruction = usingCustomPrompt
      ? customPrompt.trim()
      : `You are an expert Thai news thumbnail layout editor.
Analyze each image and assign it to the best matching zone based on content and visual quality.
Prioritize: clear face → MAIN, event/evidence → EVENT, context/environment → CONTEXT, formal portrait → MEMORIAL.`;

    rlog.prompt(
      usingCustomPrompt ? 'CUSTOM image-select prompt' : 'DEFAULT layout analyzer prompt',
      `length: ${systemInstruction.length}ch | images: ${images.length}`
    );
    rlog.model('gpt-4o (vision)', `detail: low | max_tokens: 600 | temp: 0.1 | images: ${Math.min(images.length,5)}`);

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

    rlog.step('gpt4o-vision-call', `calling GPT-4o with ${Math.min(images.length,5)} images + prompt...`);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: contentParts }],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    rlog.step('gpt4o-vision-done', `tokens: ${response.usage?.total_tokens||'?'} | finish: ${response.choices[0]?.finish_reason}`);

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

    const elapsed = ((Date.now() - startTime)/1000).toFixed(1);
    rlog.done(`template: "${finalTemplate}" | confidence: ${result.confidence||80}% | assignments: ${JSON.stringify(assignments)} | customPrompt: ${usingCustomPrompt?'YES':'NO'} | ${elapsed}s`);
    console.log(`[ImageAnalyze] ✅ ${finalTemplate} | confidence: ${result.confidence}% | assignments: ${JSON.stringify(assignments)} | ${elapsed}s`);

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
