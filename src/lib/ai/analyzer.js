import { callAI } from './openai.js';
import { CONTENT_ANALYSIS_PROMPT } from './prompts.js';

/**
 * วิเคราะห์เนื้อหาและให้คะแนนศักยภาพไวรัล
 */
export async function analyzeContent(cleanedText) {
  const userPrompt = CONTENT_ANALYSIS_PROMPT.user.replace('{content}', cleanedText);
  
  const result = await callAI({
    systemPrompt: CONTENT_ANALYSIS_PROMPT.system,
    userPrompt,
    temperature: 0.5,
  });

  // คำนวณ viral probability เฉลี่ย
  const scores = result.viral_scores;
  const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
  
  return {
    ...result,
    viral_probability: Math.round(avgScore),
  };
}
