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
 * เรียก AI — รองรับ 2 แบบ:
 * 1. prompt เดียว (ใหม่): callAI({ prompt: "..." })
 * 2. แยก system/user (เก่า): callAI({ systemPrompt: "...", userPrompt: "..." })
 */
export async function callAI({ prompt, systemPrompt, userPrompt, model = 'gpt-4o-mini', temperature = 0.7, maxTokens = 4000 }) {
  const client = getOpenAIClient();

  if (!client) {
    throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');
  }

  // สร้าง messages — ถ้ามี prompt เดียว ใส่ใน user message
  const messages = prompt
    ? [
        { role: 'system', content: 'ตอบเป็น JSON เท่านั้น' },
        { role: 'user', content: prompt },
      ]
    : [
        { role: 'system', content: systemPrompt || 'ตอบเป็น JSON เท่านั้น' },
        { role: 'user', content: userPrompt },
      ];

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  console.log(`[callAI] OK: model=${model}, tokens=${response.usage?.total_tokens || '?'}`);

  if (!content) throw new Error('AI ไม่ส่งข้อมูลกลับ');

  try {
    return JSON.parse(content);
  } catch (e) {
    console.error('[callAI] JSON parse failed:', content.slice(0, 300));
    throw new Error('AI ส่งข้อมูลที่ parse ไม่ได้');
  }
}
