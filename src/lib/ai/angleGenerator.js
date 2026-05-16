import { callAI } from './openai.js';
import { VIRAL_ANGLE_PROMPT } from './prompts.js';

/**
 * สร้างมุมมองไวรัล — headlines, hooks, angles
 */
export async function generateAngles(content, analysis) {
  const userPrompt = VIRAL_ANGLE_PROMPT.user
    .replace('{content}', content)
    .replace('{analysis}', JSON.stringify(analysis, null, 2));
  
  const result = await callAI({
    systemPrompt: VIRAL_ANGLE_PROMPT.system,
    userPrompt,
    temperature: 0.8,
  });

  return result;
}
