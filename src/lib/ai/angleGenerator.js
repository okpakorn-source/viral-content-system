import { callAI } from './openai.js';
import { getPrompt } from './promptStore.js';

/**
 * สร้างมุมมองไวรัล — headlines, hooks, angles
 */
export async function generateAngles(content, analysis) {
  const prompt = getPrompt('angle');

  const systemPrompt = prompt?.system || 'คุณคือนักกลยุทธ์คอนเทนต์ไวรัล ตอบ JSON เท่านั้น';

  const userPrompt = (prompt?.user || `จากเนื้อหา สร้างมุมมองไวรัล:
{content}
{analysis}

ตอบ JSON:
{
  "headlines": ["หัวข้อ 1"],
  "hooks": ["ประโยคเปิด 1"],
  "comment_baits": ["ตอนจบ 1"],
  "discussion_angles": ["มุมถกเถียง 1"],
  "emotional_directions": [{"direction": "", "description": "", "expected_reaction": ""}]
}`)
    .replace('{content}', content?.slice(0, 4000) || '')
    .replace('{analysis}', typeof analysis === 'string' ? analysis : JSON.stringify(analysis || {}, null, 2));

  try {
    return await callAI({
      systemPrompt,
      userPrompt,
      temperature: 0.7,
    });
  } catch (err) {
    console.error('[generateAngles] Error:', err.message);
    return {
      headlines: ['(สร้างหัวข้อไม่สำเร็จ: ' + err.message + ')'],
      hooks: [''],
      comment_baits: [''],
      discussion_angles: [''],
      emotional_directions: [],
    };
  }
}
