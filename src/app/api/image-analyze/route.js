import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { detectTemplate, TEMPLATES } from '@/lib/imageTemplates';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Image Analyzer — GPT-4o Vision (Direct OpenAI call, ไม่ผ่าน callAI wrapper)
 * รับรูป 2-5 รูป + ข้อมูลข่าว → layout JSON
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { images, newsTitle, newsType } = body;

    if (!images || images.length < 1) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งรูปอย่างน้อย 1 รูป' }, { status: 400 });
    }

    const suggestedTemplate = detectTemplate(newsType || '', newsTitle || '');
    const tmpl = TEMPLATES[suggestedTemplate];

    const availableZones = tmpl.layout.zones
      .filter(z => z.role !== 'background')
      .map(z => `"${z.id}" (role: ${z.role})`)
      .join(', ');

    // Build content array: text + images
    const contentParts = [
      {
        type: 'text',
        text: `คุณคือผู้เชี่ยวชาญออกแบบปกข่าวไทย

วิเคราะห์รูป ${images.length} รูปต่อไปนี้สำหรับข่าว:
หัวข้อ: "${newsTitle || 'ไม่ระบุ'}"
ประเภทข่าว: ${newsType || 'ไม่ระบุ'}

Template แนะนำ: "${suggestedTemplate}" (${tmpl.name})
Zones ใน template: ${availableZones}

กฎ:
- assignments.bg, assignments.main ต้องมีเสมอ (index 0-${images.length - 1})
- ถ้ารูปน้อย ให้ใช้ index ซ้ำได้
- ถ้าไม่มีรูป memorial ให้ละ key นั้น

ตอบเป็น JSON เท่านั้น (ห้ามมีข้อความอื่น):
{
  "template": "${suggestedTemplate}",
  "assignments": {"bg": 0, "main": 0, "context": 1, "event": 2, "secondary": 1, "memorial": 3},
  "hasMemorial": false,
  "confidence": 85,
  "reasoning": "เหตุผลสั้นๆ ภาษาไทย"
}`,
      },
      ...images.slice(0, 5).map(src => ({
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
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content || '{}';
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error('AI ตอบกลับ JSON ไม่ถูกต้อง: ' + raw.slice(0, 100));
    }

    // Validate & sanitize
    const finalTemplate = TEMPLATES[result.template] ? result.template : suggestedTemplate;
    const assignments = result.assignments || {};
    // Ensure bg and main exist
    if (assignments.bg === undefined) assignments.bg = 0;
    if (assignments.main === undefined) assignments.main = 0;
    // Clamp all indexes to valid range
    const maxIdx = images.length - 1;
    for (const key of Object.keys(assignments)) {
      assignments[key] = Math.min(Math.max(0, parseInt(assignments[key]) || 0), maxIdx);
    }

    console.log('[ImageAnalyze] ✅ Template:', finalTemplate, '| Confidence:', result.confidence);

    return NextResponse.json({
      success: true,
      layout: {
        template: finalTemplate,
        templateName: TEMPLATES[finalTemplate].name,
        assignments,
        hasMemorial: Boolean(result.hasMemorial),
        confidence: result.confidence || 80,
        reasoning: result.reasoning || '',
      },
    });

  } catch (error) {
    console.error('[ImageAnalyze] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
