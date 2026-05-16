import { callAI } from './openai.js';
import { getPrompt } from './promptStore.js';

/**
 * สร้างมุมมองไวรัล — headlines, hooks, angles
 */
export async function generateAngles(content, analysis) {
  const promptData = getPrompt('angle');

  const prompt = (promptData?.prompt || `คุณคือนักกลยุทธ์คอนเทนต์ไวรัล

สร้างมุมมองไวรัลจากเนื้อหา:
{content}

ตอบ JSON:
{
  "headlines": ["หัวข้อ 1"],
  "hooks": ["ประโยคเปิด 1"],
  "comment_baits": ["ตอนจบ 1"],
  "discussion_angles": ["มุม 1"],
  "emotional_directions": []
}`)
    .replace('{content}', content?.slice(0, 4000) || '')
    .replace('{analysis}', typeof analysis === 'string' ? analysis : JSON.stringify(analysis || {}, null, 2));

  try {
    return await callAI({ prompt, temperature: 0.7 });
  } catch (err) {
    console.error('[generateAngles] Error:', err.message);
    return {
      headlines: ['(สร้างไม่สำเร็จ: ' + err.message + ')'],
      hooks: [''], comment_baits: [''], discussion_angles: [''], emotional_directions: [],
    };
  }
}
