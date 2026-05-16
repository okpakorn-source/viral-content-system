import { callAI } from './openai.js';
import { getPrompt } from './promptStore.js';

/**
 * สร้างบทความไวรัล
 */
export async function generateArticle({ headline, hook, content, tone = 'emotional', instructions = '' }) {
  const prompt = getPrompt('article');

  const systemPrompt = prompt?.system || 'คุณคือนักเขียนคอนเทนต์ไวรัล ตอบ JSON เท่านั้น';

  const userPrompt = (prompt?.user || `เขียนบทความ:
หัวข้อ: {headline}
Hook: {hook}
เนื้อหา: {content}
โทน: {tone}

ตอบ JSON:
{
  "headline": "",
  "body": "",
  "hook": "",
  "closing": "",
  "caption": "",
  "hashtags": []
}`)
    .replace('{headline}', headline || '')
    .replace('{hook}', hook || '')
    .replace('{content}', content?.slice(0, 4000) || '')
    .replace('{tone}', tone)
    .replace('{instructions}', instructions);

  try {
    return await callAI({
      systemPrompt,
      userPrompt,
      temperature: 0.7,
    });
  } catch (err) {
    console.error('[generateArticle] Error:', err.message);
    return {
      headline: headline || '(สร้างไม่สำเร็จ)',
      body: 'เกิดข้อผิดพลาด: ' + err.message,
      hook: hook || '',
      closing: '',
      caption: '',
      hashtags: [],
    };
  }
}

/**
 * เขียนบทความใหม่ด้วยโทนที่ต่างออกไป
 */
export async function rewriteArticle({ originalBody, newTone, feedback = '' }) {
  const prompt = getPrompt('article');
  const systemPrompt = prompt?.system || 'คุณคือนักเขียนคอนเทนต์ไวรัล ตอบ JSON เท่านั้น';

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

  try {
    return await callAI({ systemPrompt, userPrompt, temperature: 0.8 });
  } catch (err) {
    console.error('[rewriteArticle] Error:', err.message);
    return {
      headline: '(เขียนใหม่ไม่สำเร็จ)',
      body: 'เกิดข้อผิดพลาด: ' + err.message,
      hook: '', closing: '', caption: '', hashtags: [],
    };
  }
}
