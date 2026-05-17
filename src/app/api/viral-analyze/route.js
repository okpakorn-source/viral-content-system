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

A. ประเภทคอนเทนต์ (เลือก 1 จาก: ข่าวอาลัย, ข่าวสูญเสีย, ข่าวดราม่า, ข่าวแฉ, ข่าวแซะ, ข่าวบริจาค, ข่าวการเมือง, ข่าวคนจนสู้ชีวิต, ข่าวหักมุม, ข่าวเศรษฐี, ข่าวอบอุ่น, ข่าวช็อก, ข่าวคอมเมนต์เดือด, ข่าวอุบัติเหตุ, ข่าวบันเทิง, ข่าวกีฬา, ข่าวดวง, ข่าวเทคโนโลยี)

B. Emotional Pattern — อารมณ์หลักที่กระตุ้นคนอ่าน

C. Viral Structure — โครงสร้างที่ทำให้ไวรัล:
- เปิด Hook ยังไง, มีชื่อคนดัง, หักมุม, Pain Point, จังหวะอารมณ์, CTA

D. Writing DNA — เทคนิคการเขียนที่ซ่อนอยู่:
- โครงสร้างประโยค, ความยาว, คำเร่งอารมณ์, เทคนิคชวนแชร์

ตอบเป็น JSON:
{
  "category": "ประเภทข่าว (ต้องตรงกับรายการด้านบน)",
  "sub_category": "หมวดย่อย",
  "content_summary": "สรุปเนื้อหา 2-3 ประโยคสั้นๆ",
  "target_audience": "กลุ่มเป้าหมาย",
  "emotional_patterns": ["อารมณ์1", "อารมณ์2"],
  "primary_emotion": "อารมณ์หลัก 1 ตัว",
  "viral_score": 85,
  "hook_analysis": {
    "type": "ประเภท Hook",
    "opening_words": "คำเปิดที่ใช้ (คัดลอกจากเนื้อหาจริง)",
    "uses_celebrity": false,
    "uses_shock": false,
    "hook_technique": "อธิบายเทคนิค"
  },
  "structure": {
    "flow": "Hook > เนื้อหา > จุดพีค > CTA",
    "has_twist": false,
    "has_pain_point": false,
    "emotional_arc": "อธิบายจังหวะอารมณ์",
    "cta_style": "วิธีชวน engage",
    "paragraph_count": 5,
    "word_count_estimate": 300
  },
  "writing_dna": {
    "sentence_style": "สั้นกระชับ/ยาวลึกซึ้ง/สลับ",
    "avg_paragraph_length": "สั้น/กลาง/ยาว",
    "emotion_words": ["คำเร่งอารมณ์ 5 คำ"],
    "share_triggers": ["เหตุผลที่คนแชร์"],
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

      const genPrompt = `คุณคือผู้เชี่ยวชาญสร้าง Writing Prompt สำหรับเขียนคอนเทนต์ไวรัลบน Facebook

จากผลวิเคราะห์ DNA ของคอนเทนต์ไวรัลด้านล่าง ให้สร้าง "Prompt สำหรับเขียนข่าว" ที่พร้อมใช้งานทันที

=== ผลวิเคราะห์ DNA ===
${analysisData}
========================

${text ? '=== ตัวอย่างเนื้อหาต้นฉบับ (ใช้เป็น reference สไตล์เท่านั้น) ===\n' + text.slice(0, 3000) + '\n================================' : ''}

สร้าง Prompt ที่ครอบคลุม:
1. บทบาทของ AI — เป็นนักเขียนแบบไหน (เช่น "คุณคือนักเขียนข่าวที่เชี่ยวชาญ...")
2. น้ำเสียง/โทน — อบอุ่น, เข้มข้น, สะเทือนใจ ฯลฯ
3. โครงสร้าง — Hook > Body > Climax > Ending
4. เทคนิค Hook — เริ่มต้นยังไง
5. จังหวะอารมณ์ — ขึ้น-ลง-พีค
6. ความยาว/รูปแบบ — กี่ย่อหน้า กี่คำ
7. คำเร่งอารมณ์ที่แนะนำ
8. เทคนิคปิด — ทิ้งท้ายยังไงให้คนแชร์
9. สิ่งที่ห้ามทำ — ต้องชัดเจน

⚠️ สำคัญ: prompt_text ต้องเป็นคำสั่งที่ AI อ่านแล้วเขียนข่าวได้เลย ห้ามใส่ตัวอย่างเนื้อหาจริงลงใน prompt_text
⚠️ prompt_text ต้องยาว 300-500 คำ ครอบคลุมทุกส่วน

ตอบเป็น JSON:
{
  "prompt_name": "ชื่อ Prompt สั้นๆ (เช่น 'ข่าวดราม่า - สไตล์เล่าเรื่องเข้มข้น')",
  "category": "ประเภทข่าว (ตรงกับผลวิเคราะห์)",
  "emotional_type": "อารมณ์หลัก",
  "hook_style": "สไตล์ Hook",
  "tone": "น้ำเสียง",
  "structure": "Hook > Body > Climax > Ending",
  "cta_style": "แบบ CTA",
  "writing_style": "สไตล์การเขียน",
  "viral_score": 85,
  "prompt_text": "คำสั่งเต็มสำหรับ AI (300-500 คำ ห้ามมีตัวอย่างเนื้อหาจริง)",
  "do_not": ["สิ่งที่ห้ามทำ 1", "สิ่งที่ห้ามทำ 2", "สิ่งที่ห้ามทำ 3"],
  "example_hooks": ["ตัวอย่าง Hook ภาษาไทย 1", "ตัวอย่าง Hook ภาษาไทย 2"]
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
