import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';

// ===== AI Viral Content Analyzer + Prompt Generator =====
// แยกเป็น API ต่างหากเพื่อความเสถียร

export async function POST(request) {
  try {
    const { text, mode, analysis_input } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    // ===== MODE: viral-analyze — วิเคราะห์ DNA ของคอนเทนต์ไวรัล =====
    if (mode === 'viral-analyze') {
      console.log('[Viral-Analyze] === ANALYZING VIRAL DNA ===');

      const viralPrompt = `คุณคือผู้เชี่ยวชาญวิเคราะห์คอนเทนต์ไวรัลระดับโลก วิเคราะห์เนื้อหาที่ได้แสนไลค์ว่า "ทำไมมันถึงไวรัล"

=== เนื้อหาไวรัลที่ต้องวิเคราะห์ ===
${text.slice(0, 6000)}
======================================

วิเคราะห์ 4 มิติอย่างละเอียด:

A. ประเภทคอนเทนต์ (เลือก 1 จาก: ข่าวอาลัย, ข่าวสูญเสีย, ข่าวดราม่า, ข่าวแฉ, ข่าวแซะ, ข่าวบริจาค, ข่าวการเมือง, ข่าวคนจนสู้ชีวิต, ข่าวหักมุม, ข่าวเศรษฐี, ข่าวอบอุ่น, ข่าวช็อก, ข่าวคอมเมนต์เดือด)

B. Emotional Pattern — อารมณ์หลักที่กระตุ้นคนอ่าน (เลือกหลายข้อได้: ความสงสาร, ความโกรธ, ความสะใจ, ความอบอุ่น, ความช็อก, ความอาลัย, ความเห็นใจ, ความภูมิใจ)

C. Viral Structure — โครงสร้างที่ทำให้ไวรัล:
- เปิด Hook ยังไง (ใช้คำประเภทไหน)
- ใช้ชื่อคนดังหรือไม่
- มีการหักมุมหรือไม่
- ใช้ Pain Point หรือไม่
- จังหวะอารมณ์เป็นอย่างไร (ขึ้น-ลง-พีค)
- CTA (ชวนแชร์/คอมเมนต์) แบบไหน
- ทำให้คนเมนต์เพราะอะไร

D. Writing DNA — เทคนิคการเขียนที่ซ่อนอยู่:
- โครงสร้างประโยค (สั้น/ยาว/สลับ)
- ความยาวเฉลี่ยต่อย่อหน้า
- การใช้คำเร่งอารมณ์
- เทคนิคชวนแชร์
- เทคนิคทำให้คนอ่านต่อ
- รูปแบบย่อหน้า

ตอบเป็น JSON เท่านั้น:
{
  "category": "ประเภทข่าว",
  "sub_category": "หมวดย่อยถ้ามี",
  "emotional_patterns": ["อารมณ์1", "อารมณ์2"],
  "primary_emotion": "อารมณ์หลัก",
  "viral_score": 85,
  "hook_analysis": {
    "type": "ประเภท Hook",
    "opening_words": "คำเปิดที่ใช้",
    "uses_celebrity": false,
    "uses_shock": false,
    "hook_technique": "อธิบายเทคนิค"
  },
  "structure": {
    "flow": "Hook > เนื้อหา > จุดพีค > CTA",
    "has_twist": false,
    "has_pain_point": false,
    "emotional_arc": "อธิบายจังหวะอารมณ์",
    "cta_style": "วิธีชวน engage"
  },
  "writing_dna": {
    "sentence_style": "สั้นกระชับ/ยาวลึกซึ้ง/สลับ",
    "avg_paragraph_length": "สั้น/กลาง/ยาว",
    "emotion_words": ["คำเร่งอารมณ์ที่ใช้"],
    "share_triggers": ["เทคนิคชวนแชร์"],
    "read_hooks": ["เทคนิคดึงอ่านต่อ"],
    "paragraph_pattern": "อธิบายรูปแบบ"
  },
  "why_viral": "สรุป 2-3 ประโยค ว่าทำไมโพสต์นี้ไวรัล",
  "key_takeaways": ["บทเรียน1", "บทเรียน2", "บทเรียน3"]
}`;

      const result = await callAI({ prompt: viralPrompt, temperature: 0.3, maxTokens: 4000 });

      let analysis;
      try {
        const raw = typeof result === 'string' ? result : JSON.stringify(result);
        analysis = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        analysis = typeof result === 'object' ? result : { category: 'ไม่สามารถวิเคราะห์ได้', raw: String(result).slice(0, 500) };
      }

      console.log(`[Viral-Analyze] Done: category=${analysis.category}, score=${analysis.viral_score}`);
      return NextResponse.json({ success: true, analysis });
    }

    // ===== MODE: generate-prompt — สร้าง Prompt จากผลวิเคราะห์ =====
    if (mode === 'generate-prompt') {
      console.log('[Generate-Prompt] === CREATING PROMPT FROM DNA ===');
      const analysisData = typeof analysis_input === 'object' ? JSON.stringify(analysis_input, null, 2) : (analysis_input || '');

      const genPrompt = `คุณคือผู้เชี่ยวชาญสร้าง Writing Prompt สำหรับเขียนคอนเทนต์ไวรัล

จากผลวิเคราะห์ DNA ของคอนเทนต์ไวรัลด้านล่าง ให้สร้าง "Prompt สำหรับเขียนข่าว" ที่จะทำให้ AI เขียนข่าวประเภทเดียวกันได้ดีที่สุด

=== ผลวิเคราะห์ DNA ===
${analysisData}
========================

${text ? '=== ตัวอย่างเนื้อหาต้นฉบับ ===\n' + text.slice(0, 3000) + '\n================================' : ''}

สร้าง Prompt ที่มีครบทุกส่วน:
1. บทบาทของ AI (เป็นนักเขียนแบบไหน)
2. น้ำเสียง/โทน
3. โครงสร้างการเขียน (Hook > Body > CTA)
4. เทคนิค Hook ที่ต้องใช้
5. จังหวะอารมณ์
6. ความยาว/รูปแบบย่อหน้า
7. คำเร่งอารมณ์ที่แนะนำ
8. CTA / เทคนิคชวน engage
9. สิ่งที่ห้ามทำ

ตอบเป็น JSON เท่านั้น:
{
  "prompt_name": "ชื่อ Prompt (เช่น 'ข่าวอาลัย - สไตล์ย้อนความทรงจำ')",
  "category": "ประเภทข่าว",
  "emotional_type": "อารมณ์หลัก",
  "hook_style": "สไตล์ Hook",
  "tone": "น้ำเสียง",
  "structure": "Hook > X > Y > Z",
  "cta_style": "แบบ CTA",
  "writing_style": "สไตล์การเขียน",
  "viral_score": 85,
  "prompt_text": "Prompt เต็ม ที่พร้อมใช้งานเขียนข่าว (ละเอียด 300-500 คำ ครอบคลุมทุกส่วนที่กล่าวมา)",
  "do_not": ["สิ่งที่ห้ามทำ1", "สิ่งที่ห้ามทำ2"],
  "example_hooks": ["ตัวอย่าง Hook 1", "ตัวอย่าง Hook 2"]
}`;

      const result = await callAI({ prompt: genPrompt, temperature: 0.4, maxTokens: 4000 });

      let promptData;
      try {
        const raw = typeof result === 'string' ? result : JSON.stringify(result);
        promptData = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        promptData = typeof result === 'object' ? result : { prompt_name: 'ไม่สามารถสร้างได้', raw: String(result).slice(0, 500) };
      }

      console.log(`[Generate-Prompt] Done: name=${promptData.prompt_name}`);
      return NextResponse.json({ success: true, promptData });
    }

    return NextResponse.json({ success: false, error: 'ต้องระบุ mode: viral-analyze หรือ generate-prompt' }, { status: 400 });

  } catch (error) {
    console.error('[Viral-Analyze] Fatal:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
