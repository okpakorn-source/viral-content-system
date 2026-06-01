import { callAI } from './openai.js';
import { getPrompt } from './promptStore.js';

/**
 * วิเคราะห์เนื้อหาและให้คะแนนศักยภาพไวรัล
 */
export async function analyzeContent(cleanedText) {
  const promptData = getPrompt('analysis_score');

  const prompt = promptData?.prompt
    ? promptData.prompt.replace('{content}', cleanedText.slice(0, 5000))
    : `คุณคือผู้เชี่ยวชาญวิเคราะห์ศักยภาพไวรัลของคอนเทนต์บนโซเชียลมีเดียไทย

วิเคราะห์เนื้อหาต่อไปนี้แล้วให้คะแนนศักยภาพไวรัล:

${cleanedText.slice(0, 5000)}

ตอบเป็น JSON:
{
  "summary": "สรุปเนื้อหา 1-2 ประโยค",
  "viral_scores": {
    "drama": 0, "emotional_intensity": 0, "sympathy": 0,
    "anger": 0, "shock_value": 0, "curiosity": 0,
    "debate_potential": 0, "shareability": 0,
    "comment_probability": 0, "viral_probability": 0
  },
  "emotional_analysis": {
    "primary_emotion": "", "secondary_emotions": [],
    "audience_reaction": "", "controversy_level": "low"
  },
  "recommended_angle": "",
  "target_audience": ""
}`;

  try {
    const result = await callAI({ prompt, temperature: 0.4 });
    const scores = result?.viral_scores || {};
    const values = Object.values(scores).filter(v => typeof v === 'number');
    const avgScore = values.length > 0
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    return { ...result, viral_probability: avgScore };
  } catch (err) {
    console.error('[analyzeContent] Error:', err.message);
    return {
      summary: 'วิเคราะห์ไม่สำเร็จ: ' + err.message,
      viral_scores: { drama: 50, emotional_intensity: 50, sympathy: 50, anger: 50, shock_value: 50, curiosity: 50, debate_potential: 50, shareability: 50, comment_probability: 50, viral_probability: 50 },
      emotional_analysis: { primary_emotion: 'ไม่ทราบ', secondary_emotions: [], audience_reaction: '', controversy_level: 'low' },
      recommended_angle: '', target_audience: '', viral_probability: 50,
    };
  }
}
