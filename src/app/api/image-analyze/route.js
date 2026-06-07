import { NextResponse } from 'next/server';
import { MODEL_VISION } from '@/lib/ai/modelConfig';
import OpenAI from 'openai';
import { detectTemplate, TEMPLATES, getZones } from '@/lib/imageTemplates.js';
import { createLogger } from '@/lib/logger';

let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
const rlog = createLogger('IMAGE-ANALYZE');

/**
 * Image Analyzer — GPT-4o Vision
 * customPrompt (Prompt 1) = PRIMARY instruction — ใช้แทนระบบ default ทั้งหมด
 * ผลลัพธ์ = JSON assignments สำหรับ Sharp compositor เท่านั้น
 * ไม่เชื่อมกับ content system
 */
export async function POST(request) {
  const startTime = Date.now();
  const openai = getOpenAI();
  try {
    const body = await request.json();
    const { images, newsTitle, newsType, customPrompt, customZones, templateName } = body;

    if (!images || images.length < 1) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งรูปอย่างน้อย 1 รูป' }, { status: 400 });
    }

    rlog.start(`images: ${images.length} | newsType: ${newsType||'-'} | customZones: ${customZones?.length||0}`);

    // ✅ FIX: ถ้ามี customZones จาก custom template → ใช้เลย ไม่ต้อง detectTemplate
    const isCustomTemplate = customZones && Array.isArray(customZones) && customZones.length > 0;
    let allZones, suggestedTemplate, tmplName;

    if (isCustomTemplate) {
      allZones = customZones;
      suggestedTemplate = newsType || 'custom';
      tmplName = templateName || 'Custom Template';
      rlog.step('custom-zones', `✅ Using custom zones: ${allZones.length} zones | template: "${suggestedTemplate}"`);
    } else {
      suggestedTemplate = detectTemplate(newsType || '', newsTitle || '');
      const tmpl = TEMPLATES[suggestedTemplate];
      allZones = getZones(tmpl);
      tmplName = tmpl.name;
      rlog.step('template-detect', `template: "${suggestedTemplate}" (${tmplName}) | zones: ${allZones.length}`);
    }

    const availableZones = allZones
      .filter(z => z.role !== 'background')
      .map(z => `"${z.id}" (role: ${z.role})`)
      .join(', ');
    const maxIdx = images.length - 1;

    // ── System instruction ─────────────────────────────────────
    // ถ้ามี customPrompt → ใช้เป็น PRIMARY SYSTEM PROMPT (ไม่ใช่แค่ hint)
    // ถ้าไม่มี → ใช้ default
    const usingCustomPrompt = Boolean(customPrompt?.trim());
    const systemInstruction = usingCustomPrompt
      ? customPrompt.trim()
      : `You are an expert Thai news thumbnail Subject Matcher.
Your job: analyze each uploaded image and assign it to the most appropriate layout zone.

=== MATCHING PRIORITIES ===
- face_closeup   → assign image with CLEAREST close-up face (sharpest, largest face)
- context_action → assign image showing a scene, location, action, or event
- reaction_face  → assign image with emotional/reaction face for circle slot
- background_blur → assign image that works well as a blurred background (scene/landscape)
- supporting     → assign remaining images to remaining slots

=== RULES ===
- Look at each image carefully before deciding
- If multiple images have faces, pick the SHARPEST and LARGEST face for face_closeup
- If duplicate indexes are needed (fewer images than zones), spread them intelligently
- Never leave a zone unassigned
- Return confidence score based on how well images match their zones`;

    rlog.prompt(
      usingCustomPrompt ? 'CUSTOM image-select prompt' : 'DEFAULT layout analyzer prompt',
      'length: ' + systemInstruction.length + 'ch | images: ' + images.length
    );
    // ✅ FIX: detail:'high' — GPT-4o เห็นหน้าคนชัดขึ้น, ไม่ตัดไปให้เหลือแค่ 512px
    rlog.model(`${MODEL_VISION} (vision)`, 'detail: HIGH | max_tokens: 800 | temp: 0.1 | images: ' + Math.min(images.length, 5));

    // Build zone priority info for AI
    const zonePriorityInfo = allZones
      .filter(z => z.role !== 'background')
      .map(z => `"${z.id}" (role:${z.role}, priority:${z.priority || z.role})`)
      .join(', ');

    const analysisPrompt = `${systemInstruction}

---
NEWS DATA:
Title: "${newsTitle || 'Not specified'}"
Type: ${newsType || 'Not specified'}
Images count: ${images.length} (indexed 0-${maxIdx})

TEMPLATE: "${suggestedTemplate}" (${tmplName})
Zones to assign (with priorities): ${zonePriorityInfo}

---
MATCHING GUIDE:
- Zone with priority "face_closeup" → image index with clearest/largest face
- Zone with priority "context_action" → image index with scene/action/location
- Zone with priority "reaction_face" → image index with emotional/circle-worthy face
- Zone with priority "background_blur" → image index that works as background
- Zone with priority "supporting" → remaining images

STRICT OUTPUT:
- Return ONLY valid JSON
- Assign EVERY zone to a real image index (0-${maxIdx})
- Use duplicate indexes if fewer images than zones

RETURN EXACTLY:
{
  "template": "${suggestedTemplate}",
  "assignments": {${allZones.filter(z => z.role !== 'background').map((z, i) => `"${z.id}": ${Math.min(i, maxIdx)}`).join(', ')}},
  "hasMemorial": false,
  "confidence": 85,
  "reasoning": "short Thai explanation of slot matching choices"
}`;

    const contentParts = [
      { type: 'text', text: analysisPrompt },
      ...images.slice(0, 5).map((src, i) => ({
        type: 'image_url',
        image_url: {
          url: src.startsWith('data:') ? src : 'data:image/jpeg;base64,' + src,
          detail: 'high', // ✅ FIX: high detail — เห็นหน้าคนและรายละเอียดของภาพ
        },
      })),
    ];

    rlog.step('gpt4o-vision-call', `calling ${MODEL_VISION} (detail:HIGH) with ` + Math.min(images.length, 5) + ' images...');
    const response = await openai.chat.completions.create({
      model: MODEL_VISION,
      messages: [{ role: 'user', content: contentParts }],
      temperature: 0.1,
      max_tokens: 800, // ✅ FIX: เพิ่มจาก 600 → 800
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

    // Validate & sanitize assignments
    const finalTemplate = isCustomTemplate ? suggestedTemplate : (TEMPLATES[result.template] ? result.template : suggestedTemplate);
    const assignments = result.assignments || {};
    // Ensure every zone has an assignment
    for (const zone of allZones.filter(z => z.role !== 'background')) {
      if (assignments[zone.id] === undefined) {
        assignments[zone.id] = 0; // default to first image
      }
    }
    for (const key of Object.keys(assignments)) {
      assignments[key] = Math.min(Math.max(0, parseInt(assignments[key]) || 0), maxIdx);
    }

    const elapsed = ((Date.now() - startTime)/1000).toFixed(1);
    rlog.done(`template: "${finalTemplate}" | confidence: ${result.confidence||80}% | assignments: ${JSON.stringify(assignments)} | customPrompt: ${usingCustomPrompt?'YES':'NO'} | ${elapsed}s`);
    console.log(`[ImageAnalyze] ✅ ${finalTemplate} | confidence: ${result.confidence}% | assignments: ${JSON.stringify(assignments)} | ${elapsed}s`);

    return NextResponse.json({
      success: true,
      layout: {
        template: suggestedTemplate,
        templateName: tmplName,
        zones: allZones, // ✅ ส่ง zones กลับไปเสมอ เพื่อให้ image-compose ใช้ custom zones ได้
        assignments,
        hasMemorial: Boolean(result.hasMemorial),
        confidence: result.confidence || 80,
        reasoning: result.reasoning || '',
        usedCustomPrompt: Boolean(customPrompt?.trim()),
        isCustomTemplate,
      },
    });

  } catch (error) {
    console.error('[ImageAnalyze] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
