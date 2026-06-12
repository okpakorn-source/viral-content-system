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
  // ประกาศนอก try — catch ด้านล่างต้องอ่านได้ (เดิมอยู่ใน try ทำให้ error path พังซ้อน)
  let mode = null;
  let _vaStart = Date.now();
  try {
    const body = await request.json();
    const { text, analysis_input } = body;
    mode = body.mode;

    if (!text || text.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    _vaStart = Date.now();
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

      // ★ DNA v3 (12 มิ.ย. 69 — คำสั่งทีม "เรียนแต่ด้านดี"): สกัดเฉพาะสิ่งที่งานเขียนดีใช้จริง
      //   ตัดทิ้งจากกรอบเก่า: hook ช็อก/สงสาร, emotional arc ขึ้นลง, comment/share trigger เชิงเร้า, "อยากด่าคนในข่าว"
      const viralPrompt = `คุณคือ AI วิเคราะห์ "DNA งานเขียนดี" ของเพจข่าวไวรัลไทย

มาตรฐานเพจ (ทุกการวิเคราะห์ต้องยึดตามนี้): สำนวนกระชับ เข้าใจง่าย เข้าเรื่องเร็ว เล่าธรรมชาติแบบแอดมินเล่าให้แฟนเพจฟัง
นำเสนอด้านบวกตรงๆ (เช่น "เจอชมพู่ทานก๋วยเตี๋ยวข้างทาง นั่งโต๊ะใกล้กัน นิสัยดีมาก เป็นกันเองสุดๆ")
คนอ่านมีอิสรภาพทางความคิด — ไม่ชี้นำ ไม่บงการ ไม่กระชากอารมณ์ ไม่เหน็บสถานะ ไม่ลากเวลา

หน้าที่: ถอด "วิธีเขียนที่ดี" ของโพสต์นี้ออกมาเป็นแม่แบบ เพื่อสร้างพร้อมท์ให้นักเขียนผลิตงานคุณภาพเดียวกัน
- ห้ามสกัดกลไกเร้าอารมณ์/ปั่นเอนเกจ แม้โพสต์ต้นฉบับจะมี — เราเรียนเฉพาะด้านดี
- ใช้ Native Thai Framework ห้ามแปลจากอังกฤษในใจ

=== โพสต์ที่ต้องวิเคราะห์ ===
${text.slice(0, 8000)}
======================================

วิเคราะห์ตามมิติเหล่านี้:

1. ประเภท DNA ข่าว — เลือกจาก: ดราม่าครอบครัว, สู้ชีวิต, nostalgia, moral conflict, ข่าวชาวบ้าน, ความรักสัตว์, คนดังตกต่ำ, พลิกชีวิต, ช่วยเหลือกัน, ข่าวเศร้า, ข่าวเตือนใจ, ข่าวกีฬา, ข่าวบันเทิง, ข่าวการเมือง, ข่าวเศรษฐกิจ

2. แก่นที่ทำให้คน "รัก" เรื่องนี้ (ไม่ใช่เหตุผลที่คนคลิก) — ความดี/น้ำใจ/ความสามารถ/ความน่ารักอะไรที่เรื่องโชว์ โทนอารมณ์ต้องสม่ำเสมอทั้งเรื่อง ไม่ขึ้นสุดลงสุด

3. วิธีเปิดเรื่องแบบธรรมชาติ — ประโยคแรกเข้าเรื่องยังไง (ภาพการกระทำของคน / คำพูดจริง / ตัวเลขผูกประโยคเต็ม) + ทำไมถึงดึงคนโดยไม่ต้องช็อก/บังคับอารมณ์ — ห้ามจัดประเภทเป็น hook ช็อก/สงสาร

4. เหตุผลที่คนอยากคุยต่อแบบธรรมชาติ — ความน่ารัก/ความประทับใจอะไรที่ชวนเล่าต่อเอง (ห้ามวิเคราะห์เป็นกลไกยั่วคอมเมนต์/ยั่วโกรธ)

5. เหตุผลที่คนแชร์เอง — ความดีอะไรที่คนอยากส่งต่อ (ห้ามมี "อยากด่าใคร" — ไม่ใช่สิ่งที่เพจต้องการ)

6. ภาษาที่ใช้ — สำนวนไทยธรรมชาติที่เจอจริง, วลีอวยตรงๆ ที่มีลูกเล่น, จังหวะประโยคสั้น-ยาว, คำ AI tone ที่โพสต์นี้ "ไม่มี" (ทั้งนี้/อย่างไรก็ตาม/ดังกล่าว), คำฟุ่มเฟือยที่โพสต์นี้เลี่ยง

7. โครงเล่ากระชับ — ย่อหน้า 1 ทำหน้าที่อะไร / 2 / 3 (โพสต์ดีไม่ควรเกิน 3-4 ย่อหน้า) + จุดที่ "เข้าเรื่อง" อยู่ตรงไหน (ต้องอยู่ประโยคแรกๆ) + จบที่ใจความหรือคำอวยพรสั้น ไม่อวยต่อยืด

8. ภาพจำ — ภาพเดียวที่ติดหัวคนอ่าน (จากการกระทำจริงในเรื่อง ไม่ใช่ภาพดราม่าจัดฉาก)

9. จุดที่โพสต์นี้ "ไม่ทำ" (anti-pattern ที่ต้องรักษาไว้) — เช็คว่าโพสต์นี้สะอาดจากอะไร:
   - ไม่มีคำถามชี้นำคนอ่าน ("ถ้าเป็นคุณจะทำยังไง") ใช่ไหม
   - ไม่เหน็บ/ย้อนแย้งสถานะ ("แม้รวยแต่...") ใช่ไหม
   - ไม่เกริ่นยาวก่อนเข้าเรื่อง ใช่ไหม
   - ไม่จบด้วยอวยยืดไร้ใจความ ใช่ไหม
   - ไม่บังคับเศร้า/ลุ้นเกินจริง ใช่ไหม
   (ข้อไหนที่โพสต์ "มี" ปัญหา ให้บันทึกใน flaws ตรงๆ)

10. คะแนนคุณภาพ 0-100 ตามเกณฑ์เพจ: ความกระชับ, ความเป็นธรรมชาติ, เข้าเรื่องเร็ว, ภาพจำ, ความน่าแชร์แบบบวก, ความอ่านง่าย, อิสรภาพคนอ่าน (ไม่ชี้นำ)

11. DNA Template — สูตรโครงกระชับ + สูตรโทนบวกสม่ำเสมอ + สูตรภาษาธรรมชาติ + สูตรจังหวะ

12. คำแนะนำสำหรับสร้างพร้อมท์ — สิ่งที่พร้อมท์ต้องสอน (จากด้านดีของโพสต์นี้) + สิ่งที่พร้อมท์ต้องห้าม (ชี้นำ/เหน็บ/บังคับอารมณ์/เกริ่นยาว/อวยยืด/AI tone)

ตอบเป็น JSON (ชื่อ field คงเดิมเพื่อระบบเดิม แต่ความหมายตามมิติ v3 ข้างบน):
{
  "dna_type": "ประเภท DNA ข่าว (เลือกจากรายการข้อ 1)",
  "sub_type": "หมวดย่อย",
  "content_summary": "สรุปเนื้อหา 2-3 ประโยค",
  "target_audience": "กลุ่มเป้าหมาย",

  "emotional_core": {
    "primary_emotion": "โทนอารมณ์หลักของเรื่อง (โทนเดียวสม่ำเสมอ เช่น อบอุ่นใจ/ชื่นชม/ภูมิใจ)",
    "emotion_open": "โทนตอนเปิด (ต้องโทนเดียวกับหลัก)",
    "emotion_middle": "โทนตอนกลาง (ต้องโทนเดียวกับหลัก)",
    "emotion_close": "โทนตอนจบ (ต้องโทนเดียวกับหลัก)",
    "emotional_patterns": ["ความรู้สึกดีๆ ที่เรื่องนี้ให้คนอ่าน"],
    "why_this_emotion": "แก่นที่ทำให้คนรักเรื่องนี้ — ความดี/น้ำใจ/ความน่ารักอะไร"
  },

  "stop_scrolling_hook": {
    "hook_sentence": "ประโยคแรกจริงของโพสต์ (คัดลอกตรงๆ)",
    "hook_type": "ภาพการกระทำ/คำพูดจริง/ตัวเลขผูกประโยค/เล่าตรงๆ (ห้ามใช้คำว่า ช็อก หรือ สงสาร)",
    "why_it_stops": "ทำไมดึงคนได้แบบธรรมชาติ ไม่ต้องช็อก/บังคับอารมณ์",
    "hook_technique": "เทคนิคเข้าเรื่องเร็วที่ใช้",
    "alternative_hooks": ["ตัวอย่างประโยคเปิดธรรมชาติแนวเดียวกัน 2 ประโยค"]
  },

  "comment_triggers": {
    "main_trigger": "ความประทับใจ/ความน่ารักที่ชวนคนคุยต่อเองตามธรรมชาติ",
    "triggers": ["เหตุผลเชิงบวก1", "เหตุผลเชิงบวก2"],
    "predicted_comments": ["ตัวอย่างคอมเมนต์เชิงบวกที่คาดว่าจะเจอ 3 ข้อ (ห้ามมีคอมเมนต์ด่า/ดราม่า)"]
  },

  "share_triggers": {
    "main_reason": "ความดีที่คนอยากส่งต่อเอง (ห้ามมี อยากด่า/อยากประจาน)",
    "triggers": ["เหตุผลเชิงบวก1", "เหตุผลเชิงบวก2"],
    "share_context": "คนแชร์แล้วเขียน caption เชิงบวกว่าอะไร"
  },

  "language_analysis": {
    "language_style": "ภาษาคนเล่า/ชาวบ้าน/แอดมินเพจ",
    "ai_tone_words": ["คำ AI tone ที่เจอในโพสต์ (ถ้ามี — โพสต์ดีควรว่าง)"],
    "natural_words": ["สำนวนไทยธรรมชาติที่เจอจริง 5 คำ"],
    "viral_words": ["วลีอวยตรงๆ มีลูกเล่นที่เจอจริง 5 คำ"],
    "sentence_style": "สั้นกระชับ/สลับสั้นยาว",
    "avg_paragraph_length": "สั้น/กลาง/ยาว"
  },

  "story_structure": {
    "opening": "ย่อหน้า 1 ทำหน้าที่อะไร + เข้าเรื่องที่ประโยคไหน",
    "emotion_build": "รักษาโทนเดียวยังไงโดยไม่ขึ้นสุดลงสุด",
    "peak_moment": "ใจความสำคัญของเรื่องอยู่ย่อหน้าไหน",
    "ending": "จบที่ใจความ/คำอวยพรสั้นยังไง (ไม่อวยยืด)",
    "full_flow": "เปิดเข้าเรื่อง > รายละเอียด > ใจความ > จบสั้น",
    "paragraph_count": 3,
    "word_count_estimate": 300
  },

  "visual_imagination": {
    "key_image": "ภาพเดียวที่ติดหัวคนอ่าน (จากการกระทำจริง)",
    "supporting_images": ["ภาพรอง 2-3 ภาพจากเรื่องจริง"],
    "emotional_image": "ภาพที่ให้ความรู้สึกดีที่สุด (ไม่ใช่ภาพดราม่า)"
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
    "flaws_detail": ["จุดที่ผิดเกณฑ์เพจ (เกริ่นยาว/ชี้นำ/เหน็บ/บังคับอารมณ์/อวยยืด) — ระบุตรงๆ ถ้ามี"],
    "improvement_suggestions": ["คำแนะนำให้สะอาดตามเกณฑ์เพจ"]
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
      "hook": "เข้าเรื่องเร็ว+ธรรมชาติแค่ไหน",
      "emotional": "โทนบวกสม่ำเสมอแค่ไหน (ขึ้นลงสุด = หักคะแนน)",
      "facebook_language": "ภาษาแอดมินเล่าธรรมชาติแค่ไหน",
      "share_potential": "ความดีน่าส่งต่อแค่ไหน",
      "comment_potential": "ชวนคุยต่อแบบธรรมชาติแค่ไหน",
      "readability": "กระชับอ่านลื่นแค่ไหน",
      "visual_imagination": "ภาพจำชัดแค่ไหน"
    }
  },

  "dna_template": {
    "structure_formula": "สูตรโครงกระชับ (3-4 ย่อหน้า เข้าเรื่องประโยคแรก)",
    "emotion_formula": "สูตรโทนบวกสม่ำเสมอ",
    "language_formula": "สูตรภาษาธรรมชาติ",
    "rhythm_formula": "สูตรจังหวะสั้น-ยาว"
  },

  "prompt_recommendations": {
    "must_have": ["สิ่งที่พร้อมท์ต้องสอน (จากด้านดีของโพสต์นี้)"],
    "must_avoid": ["ชี้นำคนอ่าน", "เหน็บสถานะ", "บังคับอารมณ์", "เกริ่นยาว", "อวยยืดท้ายเรื่อง", "AI tone"],
    "key_instructions": "คำแนะนำหลักสำหรับสร้างพร้อมท์"
  },

  "why_viral": "สรุป 3-5 ประโยค ว่าอะไรคือ 'ด้านดี' ที่ทำให้คนรักโพสต์นี้ (ห้ามวิเคราะห์เป็นกลไกปั่นเอนเกจ)",
  "key_takeaways": ["บทเรียนวิธีเขียนดี1", "บทเรียน2", "บทเรียน3", "บทเรียน4", "บทเรียน5"]
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
    // ★ v3 (12 มิ.ย. 69): โครงตายตัว แอดมินเพจ + 3 ย่อหน้า + เข้าเรื่องทันที + ข้อห้ามครบ
    //   พร้อมท์ที่สร้างเสร็จต้องผ่านด่านคัด 6 เกณฑ์ก่อนส่งกลับ (ตก → ลองใหม่ 1 ครั้ง → error)
    if (mode === 'generate-prompt') {
      console.log('[Generate-Prompt] === CREATING PROMPT FROM DNA v3 ===');
      const analysisData = typeof analysis_input === 'object' ? JSON.stringify(analysis_input, null, 2) : (analysis_input || '');

      const buildGenPrompt = (retryNote = '') => `คุณคือ บก.เพจข่าวไวรัลไทย สร้าง Writing Prompt ให้นักเขียนของเพจ
${retryNote}
มาตรฐานเพจ (พร้อมท์ทุกตัวต้องสอนตามนี้เท่านั้น): สำนวนกระชับ เข้าใจง่าย เข้าเรื่องทันที เล่าธรรมชาติแบบแอดมินเล่าให้แฟนเพจฟัง
นำเสนอด้านบวกตรงๆ มีลูกเล่นแต่ไม่เว่อร์ คนอ่านมีอิสรภาพทางความคิด

จาก DNA งานเขียนดีด้านล่าง สร้าง "พร้อมท์เขียนข่าว" ที่ production-ready:

=== ผลวิเคราะห์ DNA งานเขียนดี ===
${analysisData}
================================

${text ? '=== ตัวอย่างเนื้อหาต้นฉบับ (reference สไตล์เท่านั้น ห้าม copy) ===\n' + text.slice(0, 3000) + '\n================================' : ''}

โครงสร้างที่ prompt_text ต้องมี (ตายตัว):
1. บทบาท — "คุณคือแอดมินเพจข่าวไวรัลไทย เล่าเรื่องให้แฟนเพจฟังแบบธรรมชาติ" (ห้ามใช้บทบาทแนว "นักเล่าเรื่องสะเทือนใจ")
2. กฎเข้าเรื่องทันที — ประโยคแรกต้องเป็นเหตุการณ์/การกระทำ/คำพูดจริงของเรื่อง ห้ามเกริ่นบรรยากาศ ห้ามพรรณนาสถานที่ก่อนเข้าเรื่อง
3. โครง 3 ย่อหน้า — ย่อหน้า 1: เข้าเรื่อง+ใจความหลัก / ย่อหน้า 2: รายละเอียดที่ทำให้รักเรื่องนี้ / ย่อหน้า 3: ปิดสั้นที่ใจความหรือคำอวยพร 1-2 ประโยค
4. โทนเดียวสม่ำเสมอ — ระบุโทนบวกจาก DNA (อบอุ่นใจ/ชื่นชม/ภูมิใจ) ห้ามสั่งดันอารมณ์ขึ้นลง
5. ภาษา — สำนวนไทยธรรมชาติจาก DNA, วลีอวยตรงๆ มีลูกเล่น, สลับประโยคสั้น-ยาว, Native Thai Framework
6. ภาพจำ — ให้คนอ่านเห็นภาพการกระทำจริง 1 ภาพ

⚠️ กฎเหล็ก:
- prompt_text ต้องเป็นคำสั่งที่ AI อ่านแล้วเขียนข่าวได้เลย ยาว 300-500 คำ (กระชับกว่ารุ่นเก่า — พร้อมท์ยืดสอนนักเขียนให้ยืด)
- ห้ามใส่ตัวอย่างเนื้อหาจริง / ชื่อบุคคล / ชื่อสถานที่จากต้นฉบับลงใน prompt_text ใช้คำกลางๆ เช่น 'บุคคลในข่าว'
- ห้ามมีคำสั่งเหล่านี้ใน prompt_text เด็ดขาด: สร้างจุดพีค, ดันอารมณ์, กระตุ้นให้คอมเมนต์, ตั้งคำถามทิ้งท้ายให้คนอ่านตอบ, ให้คนอ่านจินตนาการว่าเป็นคนในข่าว, เปิดด้วยความเศร้า/ความสูญเสีย

⚠️ HUMAN WRITING DNA (ต้องฝังใน prompt_text ทุกตัว):
- ห้ามคำทางการ: "ทั้งนี้", "อย่างไรก็ตาม", "ในขณะเดียวกัน", "ซึ่งถือว่า", "เป็นอย่างมาก", "เป็นอย่างยิ่ง", "ดังกล่าว", "สืบเนื่อง", "กล่าวได้ว่า", "ถือเป็น"
- ห้ามซ้ำคำเดียวกันเกิน 2 ครั้ง / ห้ามคำลอยฟุ่มเฟือย / เปลี่ยนจังหวะเปิดทุกย่อหน้า
- เขียนเหมือนเล่าให้เพื่อนฟัง ไม่ใช่รายงานข่าว

⚠️ do_not ต้องมีครบทุกข้อนี้ + เพิ่มจาก DNA ได้:
- "ห้ามเกริ่นยาว ต้องเข้าเรื่องตั้งแต่ประโยคแรก"
- "ห้ามชี้นำหรือบงการคนอ่าน เช่น 'ลองนึกภาพถ้าคุณเป็นเขา' 'ถ้าเป็นคุณจะทำยังไง'"
- "ห้ามเหน็บหรือย้อนแย้งสถานะ เช่น 'แม้จะรวยแต่ก็ยังกินข้างทาง'"
- "ห้ามกระชากอารมณ์ขึ้นสุดลงสุด โทนเดียวทั้งเรื่อง"
- "ห้ามปิดท้ายด้วยการอวยยืดยาวไร้ใจความ จบที่ใจความหรืออวยพรสั้นๆ"
- "ห้ามเปิดบังคับเศร้าหรือลุ้นระทึกเกินจริง"
- "ห้ามใช้ภาษาทางการ ห้ามคำว่า ทั้งนี้ อย่างไรก็ตาม ดังกล่าว"

ตอบเป็น JSON:
{
  "prompt_name": "ชื่อ Prompt (รูปแบบ: [หมวดหมู่-โทนบวก] ธีมเรื่อง เช่น '[อบอุ่นใจ-ชื่นชม] คนดังติดดินเป็นกันเอง')",
  "category": "เลือกจาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน",
  "emotional_tags": ["เลือก 3-5 โทนบวกเท่านั้น จาก: ซึ้ง, ตื้นตัน, ภูมิใจ, ชื่นชม, สนุก, ขำ, อบอุ่น, เห็นใจ"],
  "conflict_tags": ["ความท้าทายในเรื่อง (เชิงข้อเท็จจริง ไม่ใช่เชื้อดราม่า) เช่น การต่อสู้, ความผิดพลาด — หรือ [] ถ้าไม่มี"],
  "narrative_archetype": "เลือก 1 จาก: สู้ชีวิต, ฮีโร่ชาวบ้าน, น้ำใจคนไทย, ชีวิตพลิกผัน, คนดังติดดิน, คนเก่งน่าชื่นชม",
  "target_categories": ["เลือก 1-3 จาก: ช่วยเหลือกัน, สู้ชีวิต, ดราม่าครอบครัว, ดราม่าสังคม, ข่าวเตือนใจ, ข่าวอาชญากรรม, ความรัก, อบอุ่นใจ, ฮีโร่ชาวบ้าน, ชีวิตพลิกผัน"],
  "hook_style": "เข้าเรื่องทันทีด้วย (ภาพการกระทำ/คำพูดจริง/ตัวเลขผูกประโยค)",
  "tone": "โทนบวกสม่ำเสมอจาก DNA",
  "structure": "โครง 3 ย่อหน้า: เข้าเรื่อง+ใจความ / รายละเอียด / ปิดสั้น",
  "cta_style": "ไม่มี CTA บังคับ — จบที่ใจความหรืออวยพรสั้น",
  "writing_style": "แอดมินเพจเล่าให้แฟนเพจฟัง",
  "viral_score": 85,
  "dna_template": {
    "structure_formula": "สูตรโครงกระชับ",
    "emotion_formula": "สูตรโทนบวกสม่ำเสมอ",
    "language_formula": "สูตรภาษาธรรมชาติ",
    "rhythm_formula": "สูตรจังหวะ"
  },
  "emotional_arc": {
    "open": "โทนบวกเดียวกัน",
    "middle": "โทนบวกเดียวกัน",
    "close": "โทนบวกเดียวกัน"
  },
  "visual_imagination_instruction": "คำสั่งให้คนอ่านเห็นภาพการกระทำจริง 1 ภาพ",
  "comment_trigger_instruction": "เล่าความน่ารัก/ความประทับใจให้ชัดจนคนอยากคุยต่อเอง — ห้ามมีคำสั่งยั่วคอมเมนต์/ตั้งคำถามทิ้งท้าย",
  "share_trigger_instruction": "เล่าความดีให้ชัดจนคนอยากส่งต่อเอง — ห้ามมีคำสั่งกระตุ้นแชร์",
  "prompt_text": "คำสั่งเต็ม production-ready 300-500 คำ ตามโครงตายตัว 6 ข้อด้านบน",
  "do_not": ["ครบ 7 ข้อบังคับด้านบน + เพิ่มจาก DNA ได้"],
  "example_hooks": ["ตัวอย่างประโยคเปิดเข้าเรื่องทันที (pattern กลางๆ ไม่ใช่ประโยคจริงจากต้นฉบับ) 3 แบบ"]
}`;

      const { screenContent: screenPrompt, VERDICT_LABELS: SCREEN_LABELS } = await import('@/lib/services/contentScreen');

      let promptData = null;
      let lastScreen = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const retryNote = attempt === 2 && lastScreen
          ? `\n⚠️ รอบที่แล้วพร้อมท์ถูกปัดตก (${lastScreen.verdict}: ${lastScreen.why}) — แก้จุดนี้ให้ขาด\n`
          : '';
        const result = await callAI({ prompt: buildGenPrompt(retryNote), temperature: 0.4, maxTokens: 8000 });

        let candidate;
        try {
          const raw = typeof result === 'string' ? result : JSON.stringify(result);
          candidate = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
        } catch {
          candidate = typeof result === 'object' ? result : { prompt_name: 'ไม่สามารถสร้างได้', raw: String(result).slice(0, 500) };
        }

        // ด่านคัดพร้อมท์: prompt_text ต้องไม่สอนผิดเกณฑ์ 6 ข้อ
        const screen = await screenPrompt(String(candidate.prompt_text || ''), 'prompt');
        if (screen.pass) {
          promptData = candidate;
          if (screen.needsReview) promptData.screen_note = 'ตรวจอัตโนมัติไม่สำเร็จ — ควรตรวจมือ';
          break;
        }
        lastScreen = screen;
        console.warn(`[Generate-Prompt] รอบ ${attempt} ตกด่านคัด: ${screen.verdict} — ${screen.why}`);
      }

      if (!promptData) {
        logPipeline({ step: 'generate-prompt', status: 'failed', duration: Date.now() - _vaStart, error: 'ตกด่านคัด 2 รอบ: ' + (lastScreen?.verdict || '') }).catch(() => {});
        return NextResponse.json({
          success: false,
          error: `พร้อมท์ที่สร้างไม่ผ่านมาตรฐานเพจ 2 รอบ (${SCREEN_LABELS[lastScreen?.verdict] || lastScreen?.verdict}: ${lastScreen?.why || ''}) — ลองวิเคราะห์เนื้อหาต้นทางใหม่หรือเปลี่ยนตัวอย่าง`,
          errorType: 'PROMPT_SCREEN_REJECTED',
        }, { status: 422 });
      }

      console.log(`[Generate-Prompt] Done (ผ่านด่านคัด): name=${promptData.prompt_name}`);
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
