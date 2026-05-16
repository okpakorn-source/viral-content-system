import OpenAI from 'openai';

let openaiClient = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY ไม่ได้ตั้งค่า — ใช้ระบบ mock แทน');
      return null;
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export async function callAI({ systemPrompt, userPrompt, model = 'gpt-4o-mini', temperature = 0.7, maxTokens = 4000 }) {
  const client = getOpenAIClient();
  
  if (!client) {
    return generateMockResponse(userPrompt);
  }

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });
    const content = response.choices[0]?.message?.content;
    console.log(`[callAI] OK: model=${model}, tokens=${response.usage?.total_tokens || '?'}`);
    return JSON.parse(content);
  } catch (error) {
    console.error(`[callAI] FAIL: model=${model}, error=${error.message}, status=${error.status || '?'}`);
    throw new Error(`AI error: ${error.message}`);
  }
}

function generateMockResponse(prompt) {
  // 1. Analysis prompt
  if (prompt.includes('viral_scores') || prompt.includes('วิเคราะห์เนื้อหา')) {
    return {
      summary: 'เนื้อหาเกี่ยวกับเรื่องราวที่กระทบอารมณ์ของผู้อ่าน มีศักยภาพไวรัลสูง',
      viral_scores: {
        drama: Math.floor(Math.random() * 30) + 60,
        emotional_intensity: Math.floor(Math.random() * 30) + 65,
        sympathy: Math.floor(Math.random() * 30) + 55,
        anger: Math.floor(Math.random() * 40) + 30,
        shock_value: Math.floor(Math.random() * 30) + 50,
        curiosity: Math.floor(Math.random() * 25) + 70,
        debate_potential: Math.floor(Math.random() * 30) + 50,
        shareability: Math.floor(Math.random() * 20) + 70,
        comment_probability: Math.floor(Math.random() * 20) + 75,
        viral_probability: Math.floor(Math.random() * 20) + 72,
      },
      emotional_analysis: {
        primary_emotion: 'สงสาร/เห็นใจ',
        secondary_emotions: ['ซาบซึ้ง', 'ชื่นชม'],
        audience_reaction: 'คนจะแชร์พร้อมแสดงความเห็นใจ',
        controversy_level: 'medium',
        sensitivity_warning: null,
      },
      recommended_angle: 'เน้นมุมมนุษย์ — ให้คนรู้สึกอินกับตัวละคร',
      target_audience: 'คนทำงานวัย 25-45 ปี',
    };
  }

  // 2. Article prompt (ต้อง check ก่อน headlines เพราะมีคำว่า "หัวข้อ" เหมือนกัน)
  if (prompt.includes('===== โทน =====') || prompt.includes('เนื้อหาต้นฉบับ') || prompt.includes('เขียนบทความ')) {
    return {
      headline: 'ลุงก๋วยเตี๋ยว 25 บาท ไม่เคยขึ้นราคามา 45 ปี — ความดีที่โซเชียลไม่ลืม',
      body: 'ชามละ 25 บาท... ตัวเลขที่ใครได้ยินก็ต้องหยุดคิด ในยุคที่ข้าวแกงจานละ 50-60 บาท ลุงวัย 65 ยังยืนหยัดขายก๋วยเตี๋ยวราคาเดิมมาตลอด 45 ปี\n\nเมื่อลูกค้าถามว่า "ทำไมไม่ขึ้นราคา?" ลุงตอบสั้นๆ แค่ว่า "ถ้าขึ้นราคา คนจนจะกินอะไร?" ประโยคเดียวทำให้คนฟังอึ้งไปตามๆ กัน\n\nวันนี้มีคนถ่ายคลิปลงโซเชียล ยอดแชร์ทะลุแสนภายในไม่กี่ชั่วโมง คนแห่มาเข้าคิวซื้อจนหมดตั้งแต่ก่อนเที่ยง\n\nคนเราเกิดมาไม่ได้เลือกได้ แต่เลือกได้ว่าจะเป็นคนแบบไหน... ถ้าเป็นคุณ คุณจะทำยังไง?',
      hook: 'ชามละ 25 บาท... ตัวเลขที่ใครได้ยินก็ต้องหยุดคิด',
      closing: 'ถ้าเป็นคุณ คุณจะทำยังไง?',
      caption: '💔 ชามละ 25 บาท ไม่เคยขึ้นราคามา 45 ปี 😢🙏',
      hashtags: ['ก๋วยเตี๋ยว25บาท', 'คนดีที่ยังมีอยู่', 'ข่าวไวรัล'],
    };
  }

  // 3. Angles/Headlines prompt
  if (prompt.includes('headlines') || prompt.includes('หัวข้อ') || prompt.includes('มุมมองไวรัล')) {
    return {
      headlines: [
        'ลุงก๋วยเตี๋ยว 25 บาท ไม่เคยขึ้นราคามา 45 ปี — คำตอบของลุงทำเอาน้ำตาซึม',
        '"ถ้าขึ้นราคา คนจนจะกินอะไร?" — สะเทือนทั้งโซเชียล',
        'ช็อค! ก๋วยเตี๋ยวชามละ 25 บาท ยังมีอยู่จริง',
        'คลิปลุงขายก๋วยเตี๋ยว ยอดแชร์ทะลุแสน',
        'ดราม่า! ลุงวัย 65 ยืนขายก๋วยเตี๋ยว 25 บาท',
        'หัวข้อ #6', 'หัวข้อ #7', 'หัวข้อ #8', 'หัวข้อ #9', 'หัวข้อ #10',
      ],
      hooks: [
        'ชามละ 25 บาท... ในยุคนี้ยังมีอยู่จริง',
        '"ถ้าขึ้นราคา คนจนจะกินอะไร?" ทำเอาเงียบ',
        'ไม่มีใครคิดว่าจะมีจริง...',
        'ลุงวัย 65 ไม่เคยขึ้นราคาแม้แต่บาทเดียว',
        'คลิปนี้ทำให้คนหยุดเลื่อน...',
        'Hook 6', 'Hook 7', 'Hook 8', 'Hook 9', 'Hook 10',
      ],
      emotional_directions: [
        { direction: 'สะเทือนใจ', description: 'เน้นเห็นอกเห็นใจ', expected_reaction: 'แชร์ให้กำลังใจ' },
        { direction: 'ดราม่า', description: 'เน้นขัดแย้ง', expected_reaction: 'ถกเถียง' },
        { direction: 'ชื่นชม', description: 'เน้นด้านบวก', expected_reaction: 'แชร์แรงบันดาลใจ' },
        { direction: 'ช็อค', description: 'เน้นตกใจ', expected_reaction: 'แท็กเพื่อน' },
        { direction: 'ตั้งคำถาม', description: 'เน้นให้คิด', expected_reaction: 'คอมเมนต์' },
      ],
      comment_baits: [
        'ถ้าเป็นคุณ คุณจะทำยังไง?',
        'คนที่เจอแบบนี้ ยกมือ 🙋‍♂️',
        'เห็นด้วยไหม? คอมเมนต์มาเลย',
        'แชร์ให้คนที่คุณรักได้อ่าน ❤️',
        'มีใครเคยเจอแบบนี้บ้าง?',
      ],
      discussion_angles: [
        'มุม: ความเหลื่อมล้ำในสังคม',
        'มุม: ค่านิยมที่เปลี่ยนไป',
        'มุม: ระบบที่ต้องแก้ไข',
      ],
    };
  }

  // 4. Default fallback
  return {
    headline: 'บทความไวรัลตัวอย่าง',
    body: 'เนื้อหาตัวอย่างย่อหน้า 1\n\nเนื้อหาตัวอย่างย่อหน้า 2\n\nเนื้อหาตัวอย่างย่อหน้า 3\n\nจบแล้ว คุณคิดยังไง?',
    hook: 'ไม่มีใครคิดว่าจะเกิดขึ้น...',
    closing: 'ถ้าเป็นคุณ คุณจะทำยังไง?',
    caption: '💔 เรื่องนี้ทำให้ต้องหยุดคิด...',
    hashtags: ['ข่าวไวรัล', 'สะเทือนใจ'],
  };
}
