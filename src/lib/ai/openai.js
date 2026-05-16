import OpenAI from 'openai';

let openaiClient = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not set');
      return null;
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * เรียก AI — Single prompt system
 * callAI({ prompt: "..." }) — prompt เดียวครบ
 */
export async function callAI({ prompt, systemPrompt, userPrompt, model = 'gpt-4o', temperature = 0.7, maxTokens = 4000 }) {
  const client = getOpenAIClient();

  if (!client) {
    throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');
  }

  // System message — บังคับ AI ให้ทำตาม user prompt เท่านั้น
  const systemMsg = `คุณเป็น AI assistant ที่ต้องปฏิบัติตามคำสั่งใน user message อย่างเคร่งครัด

กฎที่ต้องทำตาม:
1. ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
2. ใช้ข้อมูลจากเนื้อข่าวที่ให้มาใน prompt เท่านั้น ห้ามแต่งเรื่องเพิ่ม ห้ามมั่วข้อมูล
3. ถ้า prompt มีเนื้อข่าวอยู่ระหว่าง === เนื้อข่าว === ให้ใช้ข้อมูลจากส่วนนั้นเท่านั้น
4. ห้ามเอาข้อมูลจากความรู้ของตัวเองมาใส่ ต้องอ้างอิงจากเนื้อข่าวที่ให้มาเท่านั้น
5. ทำตามคำสั่งทุกข้อที่ระบุใน prompt ทั้งเรื่องสไตล์ ความยาว คำที่ห้ามใช้`;

  const messages = prompt
    ? [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt },
      ]
    : [
        { role: 'system', content: systemPrompt || systemMsg },
        { role: 'user', content: userPrompt },
      ];

  // Debug log — แสดง prompt ที่ส่งไปจริง
  console.log(`[callAI] model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
  console.log(`[callAI] prompt preview (first 500ch): ${(prompt || userPrompt || '').slice(0, 500)}`);

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  console.log(`[callAI] OK: tokens=${response.usage?.total_tokens || '?'}, output=${content?.length || 0}ch`);

  if (!content) throw new Error('AI ไม่ส่งข้อมูลกลับ');

  try {
    return JSON.parse(content);
  } catch (e) {
    console.error('[callAI] JSON parse failed:', content.slice(0, 300));
    throw new Error('AI ส่งข้อมูลที่ parse ไม่ได้');
  }
}
