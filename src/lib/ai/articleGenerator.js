import { callAI } from './openai.js';
import { ARTICLE_GENERATION_PROMPT } from './prompts.js';

/**
 * สร้างบทความไวรัล
 */
export async function generateArticle({ headline, hook, content, tone = 'emotional', instructions = '' }) {
  const userPrompt = ARTICLE_GENERATION_PROMPT.user
    .replace('{headline}', headline)
    .replace('{hook}', hook || '')
    .replace('{content}', content)
    .replace('{tone}', tone)
    .replace('{instructions}', instructions);
  
  const result = await callAI({
    systemPrompt: ARTICLE_GENERATION_PROMPT.system,
    userPrompt,
    temperature: 0.8,
  });

  return result;
}

/**
 * เขียนบทความใหม่ด้วยโทนที่ต่างออกไป
 */
export async function rewriteArticle({ originalBody, newTone, feedback = '' }) {
  const systemPrompt = ARTICLE_GENERATION_PROMPT.system;
  const userPrompt = `เขียนบทความนี้ใหม่ด้วยโทน "${newTone}"

===== บทความเดิม =====
${originalBody}

===== Feedback =====
${feedback}
===================

ตอบเป็น JSON:
{
  "headline": "หัวข้อใหม่",
  "body": "เนื้อหาใหม่",
  "hook": "hook ใหม่",
  "closing": "ปิดใหม่",
  "caption": "แคปชั่นใหม่",
  "hashtags": ["แฮชแท็ก"]
}`;

  return await callAI({ systemPrompt, userPrompt, temperature: 0.9 });
}
