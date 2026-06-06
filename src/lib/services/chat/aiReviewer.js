/**
 * AI Reviewer Service — สมองหลักของ AI Content Review Chat
 * 
 * ใช้ Claude Sonnet 4 สำหรับ review text
 * ใช้ GPT-4o Vision สำหรับ review image
 * 
 * Functions:
 * - reviewNews() — วิเคราะห์ว่าข่าวนี้ควรทำคอนเทนต์ไหม
 * - reviewCaption() — ตรวจคุณภาพ caption + แนะนำแก้ไข
 * - reviewImage() — ตรวจภาพปกว่าเหมาะสมไหม
 */
import { callAI } from '@/lib/ai/openai';
import { checkAllRules } from './contentRules';
import { searchSimilar } from './viralLibrary';

// =============================================
// Constants
// =============================================

const CLAUDE_SONNET = 'claude-sonnet-4-20250514';
const GPT4O_VISION = 'gpt-4o';

// Category detection keywords
const CATEGORY_KEYWORDS = {
  death: ['เสียชีวิต', 'จากไป', 'อาลัย', 'ตาย', 'สิ้น', 'ดับ', 'สูญเสีย', 'ร่วงหล่น', 'เสีย', 'วายชนม์'],
  crime: ['จับ', 'ตำรวจ', 'คดี', 'ฆาตกรรม', 'ปล้น', 'ลัก', 'โจร', 'อาชญากรรม', 'ศาล', 'จำคุก', 'ฉ้อโกง'],
  accident: ['อุบัติเหตุ', 'ชน', 'พลิกคว่ำ', 'ไฟไหม้', 'จมน้ำ', 'ระเบิด', 'ตกจาก', 'พังยับ'],
  celebrity: ['ดารา', 'นักร้อง', 'นักแสดง', 'คนดัง', 'เซเลบ', 'ไอดอล', 'ซุปตาร์', 'แฟนคลับ'],
  feel_good: ['ประทับใจ', 'ซึ้ง', 'น้ำตา', 'อบอุ่น', 'ให้กำลังใจ', 'ช่วยเหลือ', 'น่ารัก', 'ปลื้ม', 'สุดยอด', 'ฮีโร่'],
  scandal: ['ฉาว', 'แฉ', 'แอบ', 'เบื้องหลัง', 'ลับ', 'หลุด', 'ดราม่า', 'แตกหัก', 'นอกใจ', 'ตีแผ่'],
  politics: ['การเมือง', 'นายก', 'สส.', 'พรรค', 'เลือกตั้ง', 'รัฐบาล', 'สภา', 'ครม.', 'รัฐมนตรี'],
  health: ['สุขภาพ', 'โรค', 'ป่วย', 'รักษา', 'หมอ', 'โรงพยาบาล', 'วัคซีน', 'ไข้', 'ติดเชื้อ', 'ระบาด'],
  education: ['เรียน', 'สอบ', 'มหาวิทยาลัย', 'ครู', 'นักเรียน', 'ทุน', 'การศึกษา', 'ปริญญา'],
  sports: ['กีฬา', 'แข่ง', 'เหรียญ', 'ฟุตบอล', 'มวย', 'วิ่ง', 'แชมป์', 'โอลิมปิก', 'ลีก'],
  technology: ['เทคโนโลยี', 'AI', 'แอป', 'มือถือ', 'อินเทอร์เน็ต', 'หุ่นยนต์', 'ดิจิทัล', 'ออนไลน์'],
};

// =============================================
// detectCategory — ตรวจจับหมวดข่าว
// =============================================

function detectCategory(text) {
  if (!text) return 'other';

  const normalizedText = text.toLowerCase();
  let bestCategory = 'other';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (normalizedText.includes(kw)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// =============================================
// formatViralExamples — สรุปตัวอย่างสำหรับ prompt
// =============================================

function formatViralExamples(examples) {
  if (!examples || examples.length === 0) return 'ไม่มีตัวอย่างอ้างอิง';

  return examples.map((ex, i) => {
    const engagement = [
      ex.likes ? `❤️ ${ex.likes}` : null,
      ex.shares ? `🔄 ${ex.shares}` : null,
      ex.comments ? `💬 ${ex.comments}` : null,
    ].filter(Boolean).join(' | ');

    return `[ตัวอย่าง ${i + 1}] "${ex.title}"
Engagement: ${engagement || 'N/A'}
${ex.writing_notes ? `โน้ต: ${ex.writing_notes}` : ''}
เนื้อหา (ย่อ): ${(ex.content || '').slice(0, 300)}...`;
  }).join('\n\n');
}

// =============================================
// reviewNews — วิเคราะห์ข่าวว่าควรทำคอนเทนต์ไหม
// =============================================

/**
 * วิเคราะห์ข่าวว่ามี viral potential ไหม + แนะนำแนวทางเขียน
 * @param {{ title: string, body: string, url?: string, roomId?: string }} params
 * @returns {Promise<{ success: boolean, review?: object, error?: string, errorType?: string }>}
 */
export async function reviewNews({ title, body, url, roomId }) {
  try {
    if (!title && !body) {
      return { success: false, error: 'ต้องมี title หรือ body อย่างน้อยหนึ่งอย่าง', errorType: 'VALIDATION_ERROR' };
    }

    const fullText = `${title || ''}\n${body || ''}`;

    // Step 1: ตรวจ banned words + rules
    const rulesResult = await checkAllRules(fullText);

    // Step 2: ตรวจจับหมวดข่าว
    const detectedCategory = detectCategory(fullText);

    // Step 3: หาตัวอย่างข่าวไวรัลที่คล้าย
    const viralExamples = await searchSimilar(body || title, detectedCategory);

    // Step 4: AI วิเคราะห์
    const viralExamplesText = formatViralExamples(viralExamples);

    const prompt = `คุณเป็น "บรรณาธิการข่าวไวรัล" ที่ชำนาญเรื่อง Facebook viral content
ทีมงานส่งข่าวมาให้คุณพิจารณาว่าควรทำคอนเทนต์หรือไม่

=== ข่าวที่ต้องวิเคราะห์ ===
หัวข้อ: ${title || '(ไม่มี)'}
เนื้อหา: ${body || '(ไม่มี)'}
URL: ${url || '(ไม่มี)'}
หมวดที่ตรวจจับได้: ${detectedCategory}
=== จบข่าว ===

=== คำต้องห้ามที่พบ ===
${rulesResult.violations.length > 0
  ? rulesResult.violations.map(v => `- "${v.word}" [${v.severity}/${v.action}] — ${v.description}`).join('\n')
  : '✅ ไม่พบคำต้องห้าม'}
=== จบคำต้องห้าม ===

=== ตัวอย่างข่าวไวรัลที่คล้าย (จากคลังของเรา) ===
${viralExamplesText}
=== จบตัวอย่าง ===

กรุณาวิเคราะห์ข่าวนี้ตามเกณฑ์ต่อไปนี้:

1. **Viral Potential** — ข่าวนี้มีโอกาส viral ไหม? คนจะสนใจไหม? จะ share ไหม?
2. **ความทันเวลา** — เป็นข่าวร้อนๆ ที่ต้องรีบทำไหม?
3. **ความอ่อนไหว** — ต้องระวังอะไรบ้าง?
4. **แนวทางเขียน** — ถ้าจะทำ ควรเขียนแบบไหน?

กฎพิเศษตามหมวดข่าว:
- **ข่าวคนเสียชีวิต (death)**: ต้องไว้อาลัย สดุดีความดี ห้ามเล่ารายละเอียดการตายหรือทำให้น่ากลัว ต้อง warm + respectful
- **ข่าวอาชญากรรม (crime)**: เปิดด้วยตัวเลข/สถิติที่น่าตกใจ สร้าง urgency + awareness ห้ามทำให้กลัวจนเกินไป
- **ข่าว feel good**: เล่าให้ warm เน้น emotional storytelling ให้คนอยาก share เพื่อส่งต่อกำลังใจ
- **ข่าวดราม่า/ฉาว (scandal)**: ระวังไม่ฟันธง ให้เล่าข้อเท็จจริง ให้คนตัดสินเอง
- **ข่าวการเมือง (politics)**: เป็นกลาง ห้ามเข้าข้าง ให้ข้อเท็จจริงทั้งสองฝ่าย

ตอบเป็น JSON ตามโครงสร้างนี้:
{
  "verdict": "GO | CAUTION | SKIP",
  "viralScore": 1-10,
  "category": "${detectedCategory}",
  "reasoning": "เหตุผลว่าทำไมถึงตัดสินแบบนี้ (2-3 ประโยค)",
  "viralFactors": ["ปัจจัยที่ทำให้ viral ข้อ 1", "ข้อ 2"],
  "risks": ["ความเสี่ยงข้อ 1", "ข้อ 2"],
  "writingGuide": {
    "hookSuggestion": "แนะนำ hook แรก (ประโยคแรกที่ควรใช้)",
    "tone": "โทนที่ควรใช้เขียน",
    "angle": "มุมที่ควรเล่า",
    "avoidTopics": ["สิ่งที่ควรหลีกเลี่ยง"],
    "keyEmotions": ["อารมณ์ที่ควรกระตุ้น"]
  },
  "bannedWordsFound": ${JSON.stringify(rulesResult.violations.filter(v => v.severity === 'CRITICAL' || v.severity === 'HIGH').map(v => v.word))},
  "styleWarnings": ${JSON.stringify(rulesResult.violations.filter(v => v.severity === 'STYLE').map(v => v.word))},
  "viralExampleRef": ${viralExamples.length > 0 ? `"ดูตัวอย่าง: ${viralExamples[0]?.title || ''}"` : 'null'}
}`;

    const result = await callAI({
      prompt,
      model: CLAUDE_SONNET,
      temperature: 0.4,
      maxTokens: 3000,
    });

    return {
      success: true,
      review: {
        ...result,
        rulesCheck: rulesResult,
        detectedCategory,
        viralExamplesUsed: viralExamples.length,
        reviewedAt: new Date().toISOString(),
        roomId: roomId || null,
      },
    };
  } catch (err) {
    console.error('[aiReviewer] reviewNews exception:', err.message);
    return { success: false, error: err.message, errorType: 'AI_REVIEW_ERROR' };
  }
}

// =============================================
// reviewCaption — ตรวจคุณภาพ caption
// =============================================

/**
 * ตรวจและแนะนำปรับปรุง caption
 * @param {{ caption: string, newsTitle?: string, newsBody?: string, roomId?: string }} params
 * @returns {Promise<{ success: boolean, review?: object, error?: string, errorType?: string }>}
 */
export async function reviewCaption({ caption, newsTitle, newsBody, roomId }) {
  try {
    if (!caption) {
      return { success: false, error: 'ต้องมี caption ให้ตรวจ', errorType: 'VALIDATION_ERROR' };
    }

    // Step 1: ตรวจ banned words + rules
    const rulesResult = await checkAllRules(caption);

    // Step 2: ตรวจจับหมวดและหาตัวอย่าง
    const fullContext = `${newsTitle || ''}\n${newsBody || ''}\n${caption}`;
    const detectedCategory = detectCategory(fullContext);
    const viralExamples = await searchSimilar(newsBody || caption, detectedCategory);
    const viralExamplesText = formatViralExamples(viralExamples);

    // Step 3: AI ตรวจ caption
    const prompt = `คุณเป็น "ผู้ตรวจสอบ caption ข่าว" ระดับมืออาชีพ
ทีมเขียนส่ง caption มาให้คุณตรวจก่อนเผยแพร่บน Facebook

=== Caption ที่ต้องตรวจ ===
${caption}
=== จบ Caption ===

=== บริบทข่าว ===
หัวข้อข่าว: ${newsTitle || '(ไม่มี)'}
เนื้อข่าว: ${(newsBody || '(ไม่มี)').slice(0, 1000)}
หมวด: ${detectedCategory}
=== จบบริบท ===

=== คำต้องห้ามที่พบ ===
${rulesResult.violations.length > 0
  ? rulesResult.violations.map(v => `- "${v.word}" [${v.severity}/${v.action}]`).join('\n')
  : '✅ ไม่พบ'}
=== จบ ===

=== ตัวอย่าง caption ไวรัลที่คล้าย ===
${viralExamplesText}
=== จบตัวอย่าง ===

ตรวจ caption ตามเกณฑ์เหล่านี้:

**1. Hook Strength (ความแรงของ hook)**
- ประโยคแรกกระชากใจไหม?
- คนจะหยุด scroll อ่านไหม?
- ถ้า hook อ่อน ให้แนะนำ hook ใหม่

**2. Word Economy (ความกระชับ)**
- มีคำเปลืองไหม? (เช่น: "ทั้งนี้", "อย่างไรก็ตาม", "ซึ่ง")
- ตัดคำไหนออกได้บ้างโดยไม่เสียความหมาย?
- ภาษาราชการหรือภาษา AI ที่ต้องเปลี่ยนเป็นภาษาคน

**3. Emotional Impact (พลังอารมณ์)**
- อ่านแล้วรู้สึกอะไร?
- อารมณ์ตรงกับเนื้อข่าวไหม?
- คนจะอยาก share ไหม?

**4. Facebook Safety**
- มีคำที่ Facebook อาจ flag ไหม?
- มีคำที่ละเมิด community standards ไหม?

**5. ภาษา AI ที่ต้องกำจัด**
- ดมกลิ่น AI: มีสำนวนที่ฟังไม่เป็นธรรมชาติไหม?
- ถ้ามี → ชี้ให้เห็นและแนะนำแก้

กฎพิเศษ:
- ข่าวคนตาย → caption ต้อง respectful, ไว้อาลัย, ห้ามเล่ารายละเอียดการตาย
- ข่าวอาชญากรรม → เน้น awareness, ตัวเลข/สถิติ, สร้าง urgency
- ข่าว feel good → เล่าให้ warm, ใช้ภาษาเห็นภาพ

ตอบเป็น JSON:
{
  "verdict": "PASS | NEEDS_EDIT | REWRITE",
  "score": 1-10,
  "hookAnalysis": {
    "current": "hook ปัจจุบัน (ประโยคแรก)",
    "strength": "แข็ง | พอใช้ | อ่อน",
    "suggestedHook": "hook ที่แนะนำ (ถ้า hook ปัจจุบันอ่อน)"
  },
  "issues": [
    {
      "type": "banned_word | style | ai_smell | weak_hook | too_long | safety | emotion",
      "text": "ข้อความที่มีปัญหา",
      "fix": "แนะนำแก้ไข",
      "severity": "CRITICAL | HIGH | MEDIUM | LOW"
    }
  ],
  "wordEconomy": {
    "wastedWords": ["คำเปลืองที่พบ"],
    "suggestedCuts": "แนะนำตัดตรงไหน"
  },
  "emotionalImpact": {
    "currentEmotion": "อารมณ์ที่ caption สื่อตอนนี้",
    "targetEmotion": "อารมณ์ที่ควรจะสื่อ",
    "gap": "ส่วนต่าง (ถ้ามี)"
  },
  "improvedVersion": "caption ฉบับที่ปรับปรุงแล้ว (เขียนใหม่ทั้งอัน)",
  "viralExampleRef": "อ้างอิงตัวอย่างที่ใช้เปรียบเทียบ (ถ้ามี)"
}`;

    const result = await callAI({
      prompt,
      model: CLAUDE_SONNET,
      temperature: 0.4,
      maxTokens: 4000,
    });

    return {
      success: true,
      review: {
        ...result,
        rulesCheck: rulesResult,
        detectedCategory,
        viralExamplesUsed: viralExamples.length,
        reviewedAt: new Date().toISOString(),
        roomId: roomId || null,
      },
    };
  } catch (err) {
    console.error('[aiReviewer] reviewCaption exception:', err.message);
    return { success: false, error: err.message, errorType: 'AI_REVIEW_ERROR' };
  }
}

// =============================================
// reviewImage — ตรวจภาพปก
// =============================================

/**
 * ตรวจภาพปกว่าเหมาะสมกับข่าวไวรัลไหม
 * @param {{ imageBase64: string, newsTitle?: string, roomId?: string }} params
 * @returns {Promise<{ success: boolean, review?: object, error?: string, errorType?: string }>}
 */
export async function reviewImage({ imageBase64, newsTitle, roomId }) {
  try {
    if (!imageBase64) {
      return { success: false, error: 'ต้องมีภาพ (base64) ให้ตรวจ', errorType: 'VALIDATION_ERROR' };
    }

    // Detect image format from base64 header
    let mediaType = 'image/jpeg';
    if (imageBase64.startsWith('/9j/')) mediaType = 'image/jpeg';
    else if (imageBase64.startsWith('iVBOR')) mediaType = 'image/png';
    else if (imageBase64.startsWith('R0lGOD')) mediaType = 'image/gif';
    else if (imageBase64.startsWith('UklGR')) mediaType = 'image/webp';

    // Clean base64 if it has data URL prefix
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

    const prompt = `คุณเป็น "ผู้ตรวจสอบภาพปกข่าว" สำหรับ Facebook Page ข่าวไวรัล
ทีมงานส่งภาพปกมาให้ตรวจก่อนใช้กับข่าว

หัวข้อข่าว: ${newsTitle || '(ไม่ระบุ)'}

กรุณาวิเคราะห์ภาพนี้ตามเกณฑ์:

**1. คุณภาพภาพ (Image Quality)**
- ภาพชัดหรือเบลอ? ความละเอียดเพียงพอไหม?
- แสงสว่าง/มืดเกินไปไหม?
- สัดส่วนภาพเหมาะกับ Facebook ไหม? (แนะนำ 1200x630 px)

**2. ความเกี่ยวข้องกับข่าว (Relevance)**
- ภาพสื่อตรงกับเนื้อข่าวไหม?
- คนเห็นภาพจะเข้าใจข่าวไหม?

**3. ข้อความบนภาพ (Text Overlay)**
- มีข้อความซ้อนบนภาพไหม?
- ถ้ามี อ่านง่ายไหม? สีตัดกับพื้นหลังไหม?
- ข้อความยาวเกินไปไหม?
- Font เหมาะสมไหม?

**4. Emotional Impact (พลังดึงดูด)**
- ภาพน่าสนใจพอที่คนจะหยุด scroll ไหม?
- สีสันดึงดูดสายตาไหม?
- มี human element (หน้าคน, อารมณ์) ไหม?

**5. Facebook Safety**
- มีเนื้อหาที่ Facebook อาจ flag ไหม?
- ภาพรุนแรง/เลือด/ศพ?
- ภาพล่อแหลม/ยั่วยุ?
- มีโลโก้/ลายน้ำที่ไม่ควรมีไหม?

ตอบเป็น JSON:
{
  "verdict": "PASS | NEEDS_EDIT | REJECT",
  "score": 1-10,
  "imageDescription": "อธิบายสิ่งที่เห็นในภาพ (2-3 ประโยค)",
  "quality": {
    "resolution": "ดี | พอใช้ | ต่ำ",
    "lighting": "ดี | มืด | สว่างเกิน",
    "composition": "ดี | ปรับปรุง"
  },
  "relevance": {
    "matchesNews": true/false,
    "note": "อธิบาย"
  },
  "textOverlay": {
    "hasText": true/false,
    "readability": "ดี | ปรับปรุง | แย่",
    "note": "อธิบาย"
  },
  "issues": [
    {
      "type": "quality | relevance | text | safety | composition",
      "description": "อธิบายปัญหา",
      "suggestion": "แนะนำแก้ไข",
      "severity": "CRITICAL | HIGH | MEDIUM | LOW"
    }
  ],
  "suggestions": [
    "คำแนะนำเพิ่มเติม"
  ],
  "facebookSafety": {
    "safe": true/false,
    "risks": ["ความเสี่ยงที่พบ"]
  }
}`;

    const imageContents = [
      {
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${cleanBase64}`,
          detail: 'high',
        },
      },
    ];

    const result = await callAI({
      prompt,
      imageContents,
      model: GPT4O_VISION,
      temperature: 0.3,
      maxTokens: 3000,
    });

    return {
      success: true,
      review: {
        ...result,
        reviewedAt: new Date().toISOString(),
        roomId: roomId || null,
      },
    };
  } catch (err) {
    console.error('[aiReviewer] reviewImage exception:', err.message);
    return { success: false, error: err.message, errorType: 'AI_REVIEW_ERROR' };
  }
}
