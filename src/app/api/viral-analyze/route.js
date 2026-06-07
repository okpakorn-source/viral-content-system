export const maxDuration = 300; // Allow 5 minutes for heavy LLM operations
import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { MODEL_PRIMARY } from '@/lib/ai/modelConfig';
import { logPipeline } from '@/lib/pipelineLogger';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';

// ===== AI Viral Content DNA Analyzer + Prompt Generator =====
// Deep DNA Analysis Framework v2.0 — 12 มิติ

export async function POST(request) {
  try {
    const { text, mode, analysis_input } = await request.json();

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    const _vaStart = Date.now();
    let _user = { userId: null, userName: null };
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get('auth_token')?.value;
      const session = await getSession(token);
      if (session) _user = { userId: session.memberId, userName: session.displayName || session.username };
    } catch {}
    logPipeline({ step: mode || 'viral-analyze', status: 'started', detail: 'Input: ' + text.length + 'ch, mode=' + mode, ..._user }).catch(() => {});

    // ===== MODE: viral-analyze — วิเคราะห์ DNA 12 มิติ =====
    if (mode === 'viral-analyze') {
      console.log('[Viral-Analyze] === DEEP DNA ANALYSIS (12 Dimensions) ===');

      const viralPrompt = `คุณคือ AI วิเคราะห์ "DNA ข่าวไวรัล Facebook" ระดับมืออาชีพ

หน้าที่: ถอดโครงสร้างข่าว/โพสต์ไวรัลทั้งหมดออกมาเป็น "แม่แบบเชิงอารมณ์และเชิงภาษา" เพื่อใช้สร้างคอนเทนต์ใหม่ในระดับไวรัลใกล้เคียงต้นฉบับ

สำคัญ:
- ห้ามสรุปเนื้อหาแบบทั่วไป
- ห้ามวิเคราะห์แบบนักเรียน
- คิดเหมือน: นักวิเคราะห์พฤติกรรมคนแชร์ + นักจิตวิทยา social media + content strategist เพจไวรัลระดับประเทศ
- ห้ามประมวลผลเป็นภาษาอังกฤษแล้วแปลกลับ (No internal translation). ให้ใช้ Native Thai Framework ในการวิเคราะห์

=== เนื้อหาไวรัลที่ต้องวิเคราะห์ ===
${text.slice(0, 8000)}
======================================

วิเคราะห์ 12 มิติ ต่อไปนี้อย่างละเอียด:

1. ประเภท DNA ข่าว — เลือกจาก: ดราม่าครอบครัว, สู้ชีวิต, nostalgia, moral conflict, ข่าวชาวบ้าน, ความรักสัตว์, คนดังตกต่ำ, พลิกชีวิต, ช่วยเหลือกัน, ข่าวเศร้า, ข่าวเอาคืน, ข่าวเตือนใจ, ข่าวเสียดายชีวิต, ข่าวอุบัติเหตุ, ข่าวอาชญากรรม, ข่าวดวง, ข่าวกีฬา, ข่าวบันเทิง, ข่าวการเมือง, ข่าวเศรษฐกิจ

2. Emotional Core — อารมณ์หลักที่ทำให้คนหยุดอ่าน (เลือกจาก: สงสาร, โมโห, เสียดาย, คิดถึงอดีต, อบอุ่นใจ, ช็อก, ลุ้น, สะใจ, อินความเป็นมนุษย์, ภูมิใจ, กลัว, เห็นใจ)
   ต้องจัดลำดับ: อารมณ์เปิด → อารมณ์กลาง → อารมณ์ปิด

3. Stop-Scrolling Hook — วิเคราะห์ประโยคแรกที่หยุดคน + เหตุผลว่าทำไมหยุดได้
   แยกประเภท: hook สงสาร / hook ช็อก / hook เสียดาย / hook curiosity / hook nostalgia

4. Comment Trigger — อะไรทำให้คนอยากคอมเมนต์ (moral conflict, ความเห็นต่าง, ความสงสาร, nostalgia, ความโกรธแทน, quote จำง่าย)

5. Share Trigger — ทำไมคนแชร์ (เตือนใจ, อินวัยเด็ก, สะเทือนใจ, อยากให้กำลังใจ, อยากด่าคนในข่าว, อยากให้คนรู้)

6. ภาษาที่ใช้ — วิเคราะห์:
   - ภาษาคนเล่า/ภาษาข่าว/ภาษาชาวบ้าน/ภาษาดราม่า/ภาษาคำคม/ภาษา nostalgic
   - ระบุ: คำที่เป็น AI tone (ทั้งนี้, อย่างไรก็ตาม, ในขณะเดียวกัน, ซึ่งถือว่า, เป็นอย่างมาก, เป็นอย่างยิ่ง, สะท้อนให้เห็น, เป็นเครื่องยืนยัน ฯลฯ)
   - คำที่ดูธรรมชาติ (สำนวนไทยจริง เช่น ใจหาย, ขนลุก, เจ็บแทน, อึ้ง)
   - คำที่ช่วยให้ไวรัล (คำที่มีพลังทางอารมณ์ กระชับ ตรงใจ)
   - คำฟุ่มเฟือยที่ไม่มีน้ำหนัก — ตรวจจับคำลอยที่ตัดออกได้โดยความหมายไม่เปลี่ยน
   - คำซ้ำที่ใช้บ่อยเกินในข่าวเดียว

7. โครงสร้างการเล่าเรื่อง — แตกเป็น step: เปิดด้วยอะไร → ดันอารมณ์ยังไง → จุดพีคอยู่ตรงไหน → จบแบบไหน

8. Visual Imagination — "ภาพอะไรเกิดขึ้นในหัวคนอ่าน" (เช่น เด็กยืนขายของคนเดียว, แม่จากลูกเข้าคุก)

9. จุดผิดพลาดของบทความ — ตรวจจับทุกข้อ:
   - AI tone: มีคำทางการ/คำที่คนไม่ใช้ใน Facebook ไหม
   - คำฟุ่มเฟือย: มีคำที่ตัดออกได้ไหม
   - คำซ้ำ: มีคำเดิมซ้ำมากกว่า 2 ครั้งไหม
   - opening อ่อน: เปิดไม่หยุดคนเลื่อนไหม
   - ending generic: จบแบบทั่วไปไม่มีอารมณ์ไหม
   - ประโยคยาว: มีประโยคยาวเกิน 3 บรรทัดไหม
   - emotion ไม่สุด: อารมณ์ถูกลดทอนด้วยภาษาทางการไหม
   - ไม่มีภาพจำ: อ่านจบแล้วไม่เห็นภาพอะไรในหัวไหม
   - เปิดซ้ำ: ทุกย่อหน้าเปิดด้วยรูปแบบเดิมไหม

10. Viral Score — ให้คะแนน 0-100 แต่ละด้าน: Hook, Emotional, Facebook language, Share potential, Comment potential, Readability, Visual imagination

11. DNA Template — สรุปเป็น: สูตรโครงสร้าง + สูตรอารมณ์ + สูตรภาษา + สูตรจังหวะ

12. คำแนะนำสำหรับ Prompt — สิ่งที่ต้องมีใน Prompt เพื่อรักษา DNA + สิ่งที่ต้องห้ามใน Prompt เพื่อป้องกัน AI tone

ตอบเป็น JSON:
{
  "dna_type": "ประเภท DNA ข่าว (เลือกจากรายการข้อ 1)",
  "sub_type": "หมวดย่อย",
  "content_summary": "สรุปเนื้อหา 2-3 ประโยค",
  "target_audience": "กลุ่มเป้าหมาย",

  "emotional_core": {
    "primary_emotion": "อารมณ์หลัก",
    "emotion_open": "อารมณ์เปิด",
    "emotion_middle": "อารมณ์กลาง",
    "emotion_close": "อารมณ์ปิด",
    "emotional_patterns": ["อารมณ์ที่เกิดขึ้นทั้งหมด"],
    "why_this_emotion": "อธิบายว่าทำไมอารมณ์นี้ถึงทำให้คนหยุดอ่าน"
  },

  "stop_scrolling_hook": {
    "hook_sentence": "ประโยคแรกที่หยุดฟีด (คัดลอกจริง)",
    "hook_type": "สงสาร/ช็อก/เสียดาย/curiosity/nostalgia",
    "why_it_stops": "เหตุผลว่าทำไมหยุดคนได้",
    "hook_technique": "เทคนิคที่ใช้",
    "alternative_hooks": ["ตัวอย่าง hook แบบเดียวกัน 2 ประโยค"]
  },

  "comment_triggers": {
    "main_trigger": "สิ่งที่ทำให้คอมเมนต์มากที่สุด",
    "triggers": ["trigger1", "trigger2"],
    "predicted_comments": ["ตัวอย่างคอมเมนต์ที่คาดว่าจะเจอ 3 ข้อ"]
  },

  "share_triggers": {
    "main_reason": "เหตุผลหลักที่คนแชร์",
    "triggers": ["เหตุผล1", "เหตุผล2"],
    "share_context": "คนแชร์แล้วเขียน caption ว่าอะไร"
  },

  "language_analysis": {
    "language_style": "ภาษาคนเล่า/ข่าว/ชาวบ้าน/ดราม่า/คำคม/nostalgic",
    "ai_tone_words": ["คำที่เป็น AI tone (ถ้ามี)"],
    "natural_words": ["คำที่ดูธรรมชาติ 5 คำ"],
    "viral_words": ["คำที่ช่วยให้ไวรัล 5 คำ"],
    "sentence_style": "สั้นกระชับ/ยาวลึกซึ้ง/สลับ",
    "avg_paragraph_length": "สั้น/กลาง/ยาว"
  },

  "story_structure": {
    "opening": "เปิดด้วยอะไร",
    "emotion_build": "ดันอารมณ์ยังไง",
    "peak_moment": "จุดพีคอยู่ตรงไหน",
    "ending": "จบแบบไหน",
    "full_flow": "Hook > X > Y > Z > Ending",
    "paragraph_count": 5,
    "word_count_estimate": 300
  },

  "visual_imagination": {
    "key_image": "ภาพหลักที่เกิดในหัวคนอ่าน",
    "supporting_images": ["ภาพรอง 2-3 ภาพ"],
    "emotional_image": "ภาพที่ทำให้เกิดอารมณ์สุด"
  },

  "content_flaws": {
    "has_ai_tone": false,
    "has_formal_language": false,
    "weak_opening": false,
    "generic_ending": false,
    "floating_words": false,
    "long_sentences": false,
    "emotion_not_peaked": false,
    "no_memorable_image": false,
    "flaws_detail": ["รายละเอียดจุดอ่อนแต่ละจุด"],
    "improvement_suggestions": ["คำแนะนำปรับปรุง"]
  },

  "viral_scores": {
    "hook": 85,
    "emotional": 85,
    "facebook_language": 85,
    "share_potential": 85,
    "comment_potential": 85,
    "readability": 85,
    "visual_imagination": 85,
    "overall": 85,
    "score_reasons": {
      "hook": "เหตุผลให้คะแนน",
      "emotional": "เหตุผลให้คะแนน",
      "facebook_language": "เหตุผลให้คะแนน",
      "share_potential": "เหตุผลให้คะแนน",
      "comment_potential": "เหตุผลให้คะแนน",
      "readability": "เหตุผลให้คะแนน",
      "visual_imagination": "เหตุผลให้คะแนน"
    }
  },

  "dna_template": {
    "structure_formula": "สูตรโครงสร้าง",
    "emotion_formula": "สูตรอารมณ์",
    "language_formula": "สูตรภาษา",
    "rhythm_formula": "สูตรจังหวะ"
  },

  "prompt_recommendations": {
    "must_have": ["สิ่งที่ต้องมีใน Prompt"],
    "must_avoid": ["สิ่งที่ต้องหลีกเลี่ยง"],
    "key_instructions": "คำแนะนำหลักสำหรับสร้าง Prompt"
  },

  "why_viral": "สรุป 3-5 ประโยค ว่าทำไมโพสต์นี้ไวรัล วิเคราะห์เชิงลึก",
  "key_takeaways": ["บทเรียน1", "บทเรียน2", "บทเรียน3", "บทเรียน4", "บทเรียน5"]
}`;

      const result = await callAI({ prompt: viralPrompt, temperature: 0.3, maxTokens: 8000 });

      let analysis;
      try {
        const raw = typeof result === 'string' ? result : JSON.stringify(result);
        analysis = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        analysis = typeof result === 'object' ? result : { dna_type: 'ไม่สามารถวิเคราะห์ได้', raw: String(result).slice(0, 500) };
      }

      // Backward compat: map dna_type → category for prompt matching
      if (analysis.dna_type && !analysis.category) {
        analysis.category = analysis.dna_type;
      }
      if (analysis.viral_scores?.overall && !analysis.viral_score) {
        analysis.viral_score = analysis.viral_scores.overall;
      }

      console.log(`[Viral-Analyze] Done: dna_type=${analysis.dna_type}, score=${analysis.viral_scores?.overall || analysis.viral_score}`);
      logPipeline({ step: 'viral-analyze', status: 'success', model: MODEL_PRIMARY, duration: Date.now() - _vaStart, detail: 'dna_type: ' + (analysis.dna_type || '') }).catch(() => {});
      return NextResponse.json({ success: true, analysis });
    }

    // ===== MODE: generate-prompt — สร้าง Prompt จาก DNA Analysis =====
    if (mode === 'generate-prompt') {
      console.log('[Generate-Prompt] === CREATING PROMPT FROM DNA v2 ===');
      const analysisData = typeof analysis_input === 'object' ? JSON.stringify(analysis_input, null, 2) : (analysis_input || '');

      const genPrompt = `คุณคือ content strategist ระดับประเทศ สร้าง Writing Prompt สำหรับเขียนคอนเทนต์ไวรัลบน Facebook

จาก DNA Analysis ด้านล่าง ให้สร้าง "Prompt เขียนข่าว" ที่ production-ready ทันที

=== ผลวิเคราะห์ DNA 12 มิติ ===
${analysisData}
================================

${text ? '=== ตัวอย่างเนื้อหาต้นฉบับ (reference สไตล์เท่านั้น ห้าม copy) ===\n' + text.slice(0, 3000) + '\n================================' : ''}

สร้าง Prompt ที่ครอบคลุม DNA ทั้ง 12 มิติ:

1. บทบาท AI — "คุณคือ..." (ระบุให้ชัด เช่น นักเขียนเพจข่าวไวรัล, นักเล่าเรื่องสะเทือนใจ)
2. DNA Template — ใส่สูตรโครงสร้าง + สูตรอารมณ์ + สูตรภาษา + สูตรจังหวะ
3. Emotional Arc — ระบุอารมณ์เปิด → กลาง → ปิด
4. Hook Style — ระบุเทคนิค Hook + ตัวอย่าง Hook pattern (ไม่ใช่ประโยคจริง)
5. Visual Imagination — สั่งให้ AI สร้างภาพในหัวคนอ่าน
6. Language DNA — ระบุสไตล์ภาษา + คำเร่งอารมณ์ + คำที่ห้ามใช้
7. Story Structure — เปิดยังไง → ดันอารมณ์ → จุดพีค → จบยังไง
8. Comment/Share Trigger — สั่งให้มีจุดที่กระตุ้นคอมเมนต์/แชร์
9. ความยาว — กี่ย่อหน้า กี่คำ
10. สิ่งที่ห้ามทำ — ต้องชัดเจนทุกข้อ

⚠️ กฎเหล็ก:
- prompt_text ต้องเป็นคำสั่งที่ AI อ่านแล้วเขียนข่าวได้เลย
- ห้ามใส่ตัวอย่างเนื้อหาจริงลงใน prompt_text
- ห้ามระบุชื่อบุคคล ชื่อสถานที่ หรือรายละเอียดเฉพาะเจาะจงจากต้นฉบับลงไปใน prompt_text โดยเด็ดขาด ให้ใช้คำกลางๆ เช่น 'ตัวละครหลัก', 'สถานที่เกิดเหตุ'
- prompt_text ต้องยาว 400-700 คำ ครอบคลุม DNA ทุกมิติ
- ห้าม copy ประโยคจากต้นฉบับ แต่ต้องรักษา emotional structure

⚠️ HUMAN WRITING DNA (ต้องฝังใน prompt_text ทุกตัว):
- สั่งห้ามใช้คำทางการ: "ทั้งนี้", "อย่างไรก็ตาม", "ในขณะเดียวกัน", "ซึ่งถือว่า", "เป็นอย่างมาก", "เป็นอย่างยิ่ง", "ดังกล่าว", "สืบเนื่อง", "กล่าวได้ว่า", "ถือเป็น"
- สั่งห้ามซ้ำคำ: ห้ามใช้คำเดียวกันเกิน 2 ครั้งในข่าวเดียว
- สั่งห้ามฟุ่มเฟือย: ทุกคำต้องมีน้ำหนัก ตัดคำลอยออกหมด
- สั่งห้ามเปิดย่อหน้าซ้ำรูปแบบ: เปลี่ยนจังหวะเปิดทุกย่อหน้า
- สั่งให้ใช้สำนวนไทยจริง: ใจหาย, ขนลุก, เจ็บแทน, น้ำตาจะไหล, อึ้งไปเลย
- สั่งให้สลับประโยคสั้น-ยาว สร้างจังหวะหายใจ
- สั่งให้เขียนเหมือนเล่าให้เพื่อนฟัง ไม่ใช่รายงานข่าว
- สั่งให้คิดและเขียนด้วย Native Thai Framework ห้ามแปลจากโครงสร้างภาษาอังกฤษเด็ดขาด

⚠️ do_not ต้องมีอย่างน้อย:
- "ห้ามใช้ภาษาทางการ ห้ามใช้คำว่า ทั้งนี้ อย่างไรก็ตาม ในขณะเดียวกัน"
- "ห้ามซ้ำคำเดียวกันเกิน 2 ครั้ง"
- "ห้ามฟุ่มเฟือย ห้ามใช้คำลอยไม่มีน้ำหนัก"
- "ห้ามเปิดทุกย่อหน้าด้วยคำเดิม"
- "ห้ามเขียนเหมือน AI หรือรายงานทางการ"

ตอบเป็น JSON:
{
  "prompt_name": "ชื่อ Prompt (ต้องเป็นรูปแบบ: [หมวดหมู่-อารมณ์] ธีมเรื่อง เช่น '[สู้ชีวิต-ภูมิใจ] พลิกวิกฤตสร้างแรงบันดาลใจ')",
  "category": "เลือกจาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน",
  "emotional_tags": ["เลือก 3-5 จาก: เห็นใจ, สงสาร, โกรธ, เดือด, ซึ้ง, ตื้นตัน, กลัว, ช็อก, ภูมิใจ, ชื่นชม, คาใจ, สงสัย, เศร้า, หดหู่, สนุก, ขำ, แค้น, อบอุ่น, สะเทือนใจ, หวาดกลัว"],
  "conflict_tags": ["เลือก 2-4 จาก: ความอยุติธรรม, การตัดสิน, การสูญเสีย, การต่อสู้, การเอาเปรียบ, ความผิดพลาด, การทรยศ, ความขัดแย้ง, การกดขี่, ความเหลื่อมล้ำ"],
  "narrative_archetype": "เลือก 1 จาก: สู้ชีวิต, ฮีโร่ชาวบ้าน, เปิดโปง, น้ำใจคนไทย, ชีวิตพลิกผัน, ดราม่าครอบครัว, ข่าวเตือนภัย, ความรักข้ามขีดจำกัด, ผู้ถูกกระทำ, คนดีที่โลกลืม",
  "target_categories": ["เลือก 1-3 จาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน"],
  "hook_style": "สไตล์ Hook",
  "tone": "น้ำเสียง",
  "structure": "โครงสร้างเต็ม",
  "cta_style": "แบบ CTA",
  "writing_style": "สไตล์การเขียน",
  "viral_score": 85,
  "dna_template": {
    "structure_formula": "สูตรโครงสร้าง",
    "emotion_formula": "สูตรอารมณ์",
    "language_formula": "สูตรภาษา",
    "rhythm_formula": "สูตรจังหวะ"
  },
  "emotional_arc": {
    "open": "อารมณ์เปิด",
    "middle": "อารมณ์กลาง",
    "close": "อารมณ์ปิด"
  },
  "visual_imagination_instruction": "คำสั่งให้ AI สร้างภาพในหัวคนอ่าน",
  "comment_trigger_instruction": "คำสั่งสร้างจุดกระตุ้นคอมเมนต์",
  "share_trigger_instruction": "คำสั่งสร้างจุดกระตุ้นแชร์",
  "prompt_text": "คำสั่งเต็ม production-ready (400-700 คำ ครอบคลุม DNA ทั้ง 12 มิติ)",
  "do_not": ["สิ่งที่ห้ามทำ 1", "สิ่งที่ห้ามทำ 2", "สิ่งที่ห้ามทำ 3", "สิ่งที่ห้ามทำ 4", "สิ่งที่ห้ามทำ 5"],
  "example_hooks": ["ตัวอย่าง Hook pattern 1", "ตัวอย่าง Hook pattern 2", "ตัวอย่าง Hook pattern 3"]
}`;

      const result = await callAI({ prompt: genPrompt, temperature: 0.4, maxTokens: 8000 });

      let promptData;
      try {
        const raw = typeof result === 'string' ? result : JSON.stringify(result);
        promptData = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        promptData = typeof result === 'object' ? result : { prompt_name: 'ไม่สามารถสร้างได้', raw: String(result).slice(0, 500) };
      }

      console.log(`[Generate-Prompt] Done: name=${promptData.prompt_name}`);
      logPipeline({ step: 'generate-prompt', status: 'success', model: MODEL_PRIMARY, duration: Date.now() - _vaStart, detail: 'name: ' + (promptData.prompt_name || '') }).catch(() => {});
      return NextResponse.json({ success: true, promptData });
    }

    return NextResponse.json({ success: false, error: 'ต้องระบุ mode: viral-analyze หรือ generate-prompt' }, { status: 400 });

  } catch (error) {
    console.error('[Viral-Analyze] Fatal:', error.message);
    logPipeline({ step: mode || 'viral-analyze', status: 'failed', duration: Date.now() - (_vaStart || Date.now()), error: error.message }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
