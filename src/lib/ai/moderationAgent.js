/**
 * ========================================
 * MODERATION AGENT — OpenAI Moderation API
 * ========================================
 * ใช้สำหรับ: ตรวจ safety ของ AI output
 * ราคา: ฟรี! (ไม่มีค่าใช้จ่าย)
 * 
 * ตรวจจับ: hate, violence, sexual, self-harm, harassment
 * 
 * ใช้ OPENAI_API_KEY ตัวเดียวกับ GPT-4o
 */
import { getOpenAIClient } from './openai.js';

/**
 * ตรวจสอบ content ด้วย OpenAI Moderation API
 * @param {string} text - ข้อความที่จะตรวจ
 * @returns {{ safe: boolean, flagged: string[], scores: object, details: object }}
 */
export async function moderateContent(text) {
  const client = getOpenAIClient();
  if (!client) {
    console.warn('[Moderation] No OpenAI client — skipping');
    return { safe: true, flagged: [], scores: {}, details: {} };
  }

  try {
    // ตัดข้อความถ้ายาวเกิน (Moderation API รับได้ ~32K chars)
    const truncated = text.slice(0, 30000);
    
    const response = await client.moderations.create({
      input: truncated,
    });

    const result = response.results?.[0];
    if (!result) {
      return { safe: true, flagged: [], scores: {}, details: {} };
    }

    const flaggedCategories = [];
    const scores = {};

    // เก็บทุก category ที่ถูก flag
    for (const [category, isFlagged] of Object.entries(result.categories || {})) {
      scores[category] = result.category_scores?.[category] || 0;
      if (isFlagged) {
        flaggedCategories.push(category);
      }
    }

    // หา high-risk categories (score > 0.3 แม้ไม่ถูก flag)
    const highRisk = [];
    for (const [category, score] of Object.entries(scores)) {
      if (score > 0.3 && !flaggedCategories.includes(category)) {
        highRisk.push(`${category} (${(score * 100).toFixed(0)}%)`);
      }
    }

    const safe = flaggedCategories.length === 0;
    
    console.log(`[Moderation] ${safe ? '✅ SAFE' : '⚠️ FLAGGED: ' + flaggedCategories.join(', ')}`);
    if (highRisk.length > 0) {
      console.log(`[Moderation] ⚠️ High-risk (not flagged): ${highRisk.join(', ')}`);
    }

    return {
      safe,
      flagged: flaggedCategories,
      highRisk,
      scores,
      details: {
        violence: scores['violence'] || 0,
        sexual: scores['sexual'] || 0,
        hate: scores['hate'] || 0,
        selfHarm: scores['self-harm'] || 0,
        harassment: scores['harassment'] || 0,
      },
    };
  } catch (err) {
    console.error('[Moderation] API error:', err.message);
    // ถ้า API error → ให้ผ่าน (ไม่ block user)
    return { safe: true, flagged: [], scores: {}, details: {}, error: err.message };
  }
}

/**
 * ตรวจสอบ versions ทั้งหมดจาก analyze output
 * @param {Array} versions - array ของ { content, title, ... }
 * @returns {{ overallSafe: boolean, results: Array }}
 */
export async function moderateVersions(versions) {
  if (!versions?.length) return { overallSafe: true, results: [] };

  const results = [];
  let overallSafe = true;

  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const textToCheck = `${v.title || ''}\n${v.hook || ''}\n${v.content || ''}\n${v.closing || ''}`;
    const result = await moderateContent(textToCheck);
    results.push({
      versionIndex: i,
      style: v.style || '',
      ...result,
    });
    if (!result.safe) overallSafe = false;
  }

  console.log(`[Moderation] ${versions.length} versions checked: ${overallSafe ? '✅ ALL SAFE' : '⚠️ SOME FLAGGED'}`);
  
  return { overallSafe, results };
}
