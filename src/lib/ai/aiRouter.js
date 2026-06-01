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
  
  console.log(`[SmartAI] Task="${task}" → Cascading Chain: [${strategy.chain.join(' ➡️ ')}]`);

  const temp = temperature ?? strategy.defaultTemp;
  const maxT = maxTokens ?? strategy.defaultMaxTokens;
  const errors = [];

  for (let i = 0; i < strategy.chain.length; i++) {
    const modelName = strategy.chain[i];
    try {
      const result = await callModel(modelName, { prompt, temperature: temp, maxTokens: maxT, systemPrompt });
      if (i > 0) {
        console.log(`[SmartAI] ✅ Fallback ${modelName} succeeded`);
      } else {
        console.log(`[SmartAI] ✅ ${modelName} succeeded`);
      }
      return { result, model: modelName };
    } catch (err) {
      console.warn(`[SmartAI] ⚠️ Model '${modelName}' failed: ${err.message}`);
      errors.push(`${modelName}: ${err.message}`);
    }
  }

  console.error(`[SmartAI] ❌ AI ทุก model ใน chain ล้มเหลว: ${errors.join(' | ')}`);
  throw new Error(`AI ล้มเหลวครบทุกช่องทาง: ${errors.join(', ')}`);
}

function getStrategy(task) {
  let chain = [];
  let defaultTemp = 0.5;
  let defaultMaxTokens = 4000;

  switch (task) {
    case 'extract':
      // Extraction: ใช้ Gemini Flash (ถูก + เร็ว) -> fallback gpt4o
      if (isGeminiAvailable()) chain.push('gemini');
      chain.push('gpt4o');
      defaultTemp = 0.2;
      defaultMaxTokens = 4000;
      break;

    case 'breakdown':
      // Breakdown: ใช้ GPT-4o (คิดลึก) -> fallback claude
      chain.push('gpt4o');
      if (isClaudeAvailable()) chain.push('claude');
      defaultTemp = 0.5;
      defaultMaxTokens = 8000;
      break;

    case 'write':
      // Content Writing: ใช้ Claude -> GPT-4o
      if (isClaudeAvailable()) chain.push('claude');
      chain.push('gpt4o');
      defaultTemp = 0.7;
      defaultMaxTokens = 16000;
      break;

    default:
      chain.push('gpt4o');
      if (isGeminiAvailable()) chain.push('gemini');
      defaultTemp = 0.5;
      defaultMaxTokens = 4000;
      break;
  }

  // Deduplicate array
  chain = [...new Set(chain)];
  
  if (chain.length === 0) chain.push('gpt4o');

  return { chain, defaultTemp, defaultMaxTokens };
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
