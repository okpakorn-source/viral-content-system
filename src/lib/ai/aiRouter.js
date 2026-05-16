/**
 * ========================================
 * AI ROUTER — Smart Model Selection
 * ========================================
 * เลือก AI model ที่เหมาะสมสำหรับแต่ละ task อัตโนมัติ
 * 
 * Strategy:
 *   Extraction → Gemini Flash (เร็ว + ถูก)
 *   Breakdown  → GPT-4o (คิดลึก + structured)
 *   Writing    → Claude Sonnet (เขียนไทยดี)
 *   Fallback   → GPT-4o (ถ้าไม่มี API key)
 */
import { callAI } from './openai.js';
import { callClaude, isClaudeAvailable } from './claudeClient.js';
import { callGemini, isGeminiAvailable } from './geminiClient.js';

/**
 * เลือก model + เรียก AI อัตโนมัติ
 * @param {string} task - 'extract', 'breakdown', 'write', 'general'
 * @param {object} options - { prompt, temperature, maxTokens, systemPrompt }
 */
export async function callSmartAI(task, options) {
  const { prompt, temperature, maxTokens, systemPrompt } = options;
  
  // กำหนด strategy ตาม task
  const strategy = getStrategy(task);
  
  console.log(`[SmartAI] Task="${task}" → Strategy: ${strategy.primary} → fallback: ${strategy.fallback}`);

  // ลอง primary model ก่อน
  try {
    const result = await callModel(strategy.primary, { prompt, temperature: temperature ?? strategy.defaultTemp, maxTokens: maxTokens ?? strategy.defaultMaxTokens, systemPrompt });
    console.log(`[SmartAI] ✅ ${strategy.primary} succeeded`);
    return { result, model: strategy.primary };
  } catch (err) {
    console.warn(`[SmartAI] ⚠️ ${strategy.primary} failed: ${err.message}`);
  }

  // Fallback
  try {
    const result = await callModel(strategy.fallback, { prompt, temperature: temperature ?? strategy.defaultTemp, maxTokens: maxTokens ?? strategy.defaultMaxTokens, systemPrompt });
    console.log(`[SmartAI] ✅ Fallback ${strategy.fallback} succeeded`);
    return { result, model: strategy.fallback };
  } catch (err) {
    console.error(`[SmartAI] ❌ Fallback ${strategy.fallback} also failed: ${err.message}`);
    throw new Error(`AI ทุก model ล้มเหลว: ${err.message}`);
  }
}

function getStrategy(task) {
  switch (task) {
    case 'extract':
      // Extraction: ใช้ Gemini Flash (ถูก + เร็ว)
      return {
        primary: isGeminiAvailable() ? 'gemini' : 'gpt4o',
        fallback: 'gpt4o',
        defaultTemp: 0.2,
        defaultMaxTokens: 4000,
      };

    case 'breakdown':
      // Breakdown: ใช้ GPT-4o (คิดลึก)
      return {
        primary: 'gpt4o',
        fallback: isClaudeAvailable() ? 'claude' : 'gpt4o',
        defaultTemp: 0.5,
        defaultMaxTokens: 8000,
      };

    case 'write':
      // Content Writing: ใช้ Claude (ภาษาไทยดี)
      return {
        primary: isClaudeAvailable() ? 'claude' : 'gpt4o',
        fallback: 'gpt4o',
        defaultTemp: 0.7,
        defaultMaxTokens: 16000,
      };

    default:
      return {
        primary: 'gpt4o',
        fallback: isGeminiAvailable() ? 'gemini' : 'gpt4o',
        defaultTemp: 0.5,
        defaultMaxTokens: 4000,
      };
  }
}

async function callModel(modelName, { prompt, temperature, maxTokens, systemPrompt }) {
  switch (modelName) {
    case 'claude':
      return callClaude({ prompt, temperature, maxTokens, systemPrompt });
    case 'gemini':
      return callGemini({ prompt, temperature, maxTokens });
    case 'gpt4o':
    default:
      return callAI({ prompt, temperature, maxTokens, model: 'gpt-4o' });
  }
}

/**
 * แสดงสถานะ API ที่พร้อมใช้งาน
 */
export function getAvailableModels() {
  return {
    gpt4o: !!process.env.OPENAI_API_KEY,
    claude: isClaudeAvailable(),
    gemini: isGeminiAvailable(),
  };
}
