import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { detectTemplate, TEMPLATES } from '@/lib/imageTemplates';

/**
 * Image Analyzer — GPT-4o Vision
 * รับรูป 2-5 รูป + ข้อมูลข่าว → ตัดสินใจ layout JSON
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { images, newsTitle, newsContent, newsType } = body;

    if (!images || images.length < 1) {
      return NextResponse.json({ success: false, error: 'กรุณาส่งรูปอย่างน้อย 1 รูป' }, { status: 400 });
    }

    // Auto-detect template from news context
    const suggestedTemplate = detectTemplate(newsType || '', newsTitle || '');
    const tmpl = TEMPLATES[suggestedTemplate];

    const availableRoles = tmpl.layout.zones
      .filter(z => z.role !== 'background')
      .map(z => `"${z.role}" (${z.id})`)
      .join(', ');

    // Build vision messages with images
    const imageContents = images.slice(0, 5).map((src, i) => ({
      type: 'image_url',
      image_url: {
        url: src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`,
        detail: 'low',
      },
    }));

    const systemPrompt = `คุณคือผู้เชี่ยวชาญออกแบบปกข่าวไทย วิเคราะห์รูปที่ได้รับและกำหนด layout ที่เหมาะสมที่สุด`;

    const userPrompt = `วิเคราะห์รูป ${images.length} รูปต่อไปนี้สำหรับข่าว:
หัวข้อ: "${newsTitle || 'ไม่ระบุ'}"
ประเภทข่าว: ${newsType || 'ไม่ระบุ'}

Template ที่แนะนำ: "${suggestedTemplate}" (${tmpl.name})
Zone ที่มีใน template: ${availableRoles}

งาน:
1. ดูรูปแต่ละรูป แล้วกำหนดว่ารูปไหนควรเป็น role อะไร
2. ถ้ารูปไหนเหมาะจะเป็น memorial (คนเสียชีวิต/สูญเสีย) ให้ระบุ
3. ถ้ามีรูปน้อยกว่า zone ที่ต้องการ ให้ใช้รูปเดิมซ้ำในบาง zone ได้
4. เลือก template ที่เหมาะสมที่สุด (อาจเปลี่ยนจากที่แนะนำได้)

ตอบเป็น JSON เท่านั้น:
{
  "template": "accident|crime|politics|economy|entertainment",
  "assignments": {
    "bg": 0,
    "main": 0,
    "context": 1,
    "event": 2,
    "secondary": 1,
    "memorial": 3
  },
  "hasMemorial": true|false,
  "colorOverride": null,
  "confidence": 0-100,
  "reasoning": "อธิบายสั้นๆ ว่าทำไมถึงเลือก layout นี้"
}

หมายเหตุ: assignments values คือ index ของรูป (0-based) ที่ส่งมา`;

    const result = await callAI({
      model: 'gpt-4o',
      systemPrompt,
      prompt: userPrompt,
      imageContents,
      temperature: 0.2,
      maxTokens: 600,
    });

    if (!result || typeof result !== 'object') {
      throw new Error('AI ไม่สามารถวิเคราะห์รูปได้');
    }

    // Validate template
    const template = TEMPLATES[result.template] ? result.template : suggestedTemplate;

    return NextResponse.json({
      success: true,
      layout: {
        template,
        templateName: TEMPLATES[template].name,
        assignments: result.assignments || { bg: 0, main: 0 },
        hasMemorial: result.hasMemorial || false,
        colorOverride: result.colorOverride || null,
        confidence: result.confidence || 80,
        reasoning: result.reasoning || '',
      },
    });

  } catch (error) {
    console.error('[ImageAnalyze]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
