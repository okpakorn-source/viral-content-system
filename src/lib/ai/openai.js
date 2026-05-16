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

export async function callAI({ systemPrompt, userPrompt, model = 'gpt-4o-mini', temperature = 0.7, maxTokens = 4000 }) {
  const client = getOpenAIClient();
  
  if (!client) {
    throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');
  }

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
  console.log(`[callAI] OK: model=${model}, tokens=${response.usage?.total_tokens || '?'}, len=${content?.length}`);

  if (!content) {
    throw new Error('AI ไม่ส่งข้อมูลกลับ');
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    console.error('[callAI] JSON parse failed, raw:', content.slice(0, 500));
    throw new Error('AI ส่งข้อมูลที่ parse ไม่ได้');
  }
}
