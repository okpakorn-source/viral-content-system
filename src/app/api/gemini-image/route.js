import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { composeCover } from '@/lib/coverComposer';

export const maxDuration = 60;

/**
 * Gemini Cover Maker API — "AI คิด + Sharp.js ทำ"
 * 1. Gemini (text) วิเคราะห์ Prompt → ส่ง JSON layout plan
 * 2. Sharp.js จัดวางรูปจริง + ใส่ข้อความ → ไม่บิดเบือน 100%
 */

const SYSTEM_PROMPT = `คุณคือ AI วางแผน Layout ปกข่าวไทย ให้วิเคราะห์คำสั่งของผู้ใช้แล้วตอบเป็น JSON เท่านั้น

Layout ที่รองรับ:
- "grid_circle": Grid 2×2 + วงกลมตรงกลาง (ดีสุดสำหรับ 4-5 รูป) ← ค่าเริ่มต้น
- "grid_2x2": Grid 2×2 ธรรมดา (4 รูป)
- "grid_2x3": Grid 3 คอลัมน์ 2 แถว (5-6 รูป)
- "big_left": รูปใหญ่ซ้าย + รูปเล็กขวา (3-4 รูป)
- "horizontal_strip": แถวยาว (3-5 รูป)
- "single_hero": รูปเดียวเต็มจอ (1-2 รูป)

ตอบ JSON นี้เท่านั้น ห้ามตอบอย่างอื่น:
{
  "layout": "grid_circle",
  "borderColor": "#1a3a2a",
  "headline": "พาดหัวข่าว (สร้างจากบริบทของ prompt ถ้ามี หรือเว้นว่าง)",
  "subheadline": "หัวข้อย่อย (ถ้ามี หรือเว้นว่าง)",
  "accentColor": "#c62828",
  "circlePhotoIndex": 2,
  "photoOrder": [0, 1, 3, 4]
}

กฎ:
- circlePhotoIndex: รูปไหนอยู่วงกลมกลาง (0-based index) ถ้าไม่มีวงกลมใส่ -1
- photoOrder: ลำดับรูปที่จัดวาง (ไม่รวมรูปวงกลม)
- borderColor: สีพื้นหลังระหว่างรูป (hex)
- accentColor: สีเน้นของ headline bar (hex)
- ถ้าผู้ใช้ไม่ระบุ headline ให้เว้นว่าง ""
- ถ้าผู้ใช้ระบุหัวข้อข่าวมา ให้ใส่เป็น headline`;

// ═══ Gemini Layout Planner (with retry + fallback) ═══
async function planLayout(prompt, numPhotos) {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);

  const fullSystemPrompt = SYSTEM_PROMPT + `\n\nจำนวนรูปที่อัปโหลด: ${numPhotos} รูป`;
  const modelsToTry = ['gemini-2.5-pro', 'gemini-2.5-pro'];
  const maxRetries = 2;

  let lastError = '';
  for (const modelName of modelsToTry) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
        console.log(`[Planner] Trying ${modelName} (attempt ${attempt + 1})`);

        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([fullSystemPrompt, `คำสั่งผู้ใช้: ${prompt}`]);
        const text = result.response.text();

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastError = `${modelName}: ไม่ส่ง JSON — ${text.slice(0, 100)}`;
          continue;
        }

        const plan = JSON.parse(jsonMatch[0]);

        // Defaults & validation
        plan.width = plan.width || 1080;
        plan.height = plan.height || 1080;
        plan.layout = plan.layout || 'grid_circle';
        plan.borderColor = plan.borderColor || '#1a2a3a';
        plan.headline = plan.headline || '';
        plan.subheadline = plan.subheadline || '';
        plan.accentColor = plan.accentColor || '#c62828';
        plan.circlePhotoIndex = plan.circlePhotoIndex ?? -1;
        plan.photoOrder = plan.photoOrder || Array.from({ length: numPhotos }, (_, i) => i);
        plan.modelUsed = modelName;

        return plan;
      } catch (e) {
        lastError = `${modelName}: ${e.message?.slice(0, 120)}`;
        console.warn(`[Planner] ⚠️ ${lastError}`);
        // If 503 (overloaded), retry; otherwise try next model
        if (!e.message?.includes('503') && !e.message?.includes('overloaded')) break;
      }
    }
  }

  throw new Error(`Layout planning ล้มเหลว: ${lastError}`);
}

// ═══ Main API Handler ═══
export async function POST(request) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { prompt, referenceImages } = body;

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'กรุณาระบุ Prompt' }, { status: 400 });
    }
    if (!referenceImages || referenceImages.length === 0) {
      return NextResponse.json({ success: false, error: 'กรุณาอัปโหลดรูปข่าวอย่างน้อย 1 รูป' }, { status: 400 });
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ success: false, error: 'GEMINI_API_KEY ยังไม่ได้ตั้งค่า' }, { status: 500 });
    }

    console.log(`[CoverMaker] 🎨 Start | photos: ${referenceImages.length} | prompt: "${prompt.slice(0, 80)}"`);

    // Step 1: Gemini plans the layout (with retry + fallback)
    console.log('[CoverMaker] 🧠 Gemini planning layout...');
    const plan = await planLayout(prompt, referenceImages.length);
    console.log(`[CoverMaker] 📐 Layout: ${plan.layout} | headline: "${plan.headline}" | model: ${plan.modelUsed}`);

    // Step 2: Convert base64 images to buffers
    const imageBuffers = referenceImages.map(img => {
      const b64 = img.replace(/^data:image\/\w+;base64,/, '');
      return Buffer.from(b64, 'base64');
    });

    // Step 3: Sharp.js composes the cover
    console.log('[CoverMaker] 🖼️ Sharp.js composing...');
    const resultBuffer = await composeCover(plan, imageBuffers);
    const resultBase64 = `data:image/png;base64,${resultBuffer.toString('base64')}`;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[CoverMaker] ✅ Done | ${elapsed}s`);

    return NextResponse.json({
      success: true,
      images: [{ base64: resultBase64, mimeType: 'image/png' }],
      plan,
      model: `${plan.modelUsed} (text) + Sharp.js`,
      promptUsed: prompt,
      durationSeconds: parseFloat(elapsed),
    });
  } catch (error) {
    console.error('[CoverMaker] ERROR:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
