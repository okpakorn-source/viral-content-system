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
import { MODEL_PRIMARY } from './modelConfig.js';
import { rethrowPipelineDeadline } from '../utils/pipelineDeadline.js';

/**
 * เลือก model + เรียก AI อัตโนมัติ
 * @param {string} task - 'extract', 'breakdown', 'write', 'general'
 * @param {object} options - { prompt, temperature, maxTokens, systemPrompt }
 */
export async function callSmartAI(task, options) {
  const { prompt, temperature, maxTokens, systemPrompt, signal } = options;
  
  // กำหนด strategy ตาม task
  const strategy = getStrategy(task);
  
  console.log(`[SmartAI] Task="${task}" → Cascading Chain: [${strategy.chain.join(' ➡️ ')}]`);

  const temp = temperature ?? strategy.defaultTemp;
  const maxT = maxTokens ?? strategy.defaultMaxTokens;
  const errors = [];

  for (let i = 0; i < strategy.chain.length; i++) {
    const modelName = strategy.chain[i];
    try {
      const result = await callModel(modelName, { prompt, temperature: temp, maxTokens: maxT, systemPrompt, signal });
      if (i > 0) {
        console.log(`[SmartAI] ✅ Fallback ${modelName} succeeded`);
      } else {
        console.log(`[SmartAI] ✅ ${modelName} succeeded`);
      }
      // ★ 16 ก.ค. 69 (B1): คืน "โมเดลจริง" (_modelUsed จาก client) แทนป้าย chain —
      //   ป้ายเดิม 'gpt4o' จริงๆ วิ่ง MODEL_PRIMARY(gpt-5.5) ทำ log/UI/cost เพี้ยนทั้งระบบ
      //   (ไม่มีโค้ดไหน branch ตามค่านี้ — ใช้แสดงผล/logPipeline เท่านั้น, grep ยืนยัน 16 ก.ค.)
      return { result, model: (result && result._modelUsed) || modelName };
    } catch (err) {
      rethrowPipelineDeadline(err, `smart_ai:${modelName}`);
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
      // ★ 15 ส.ค. 69 (เจ้าของเคาะหลังศึกดวล 2 รอบ: fable ชนะ 18/18 + 17-4): นักเขียนหลัก → claude-fable-5
      //   ผ่าน token ใหม่ 'claude-write' (โซ่ถอยในตัว: fable → opus-4.8 → gpt เดิม) — แตะเฉพาะสายเขียน
      //   case 'claude' เดิมคงไว้ทุกไบต์ให้ breakdown/ผู้ใช้อื่น (แผน Fable: ห้ามแก้ DEFAULT_WRITE_MODEL กลาง กันลาม fabricationGate)
      //   ของเดิม: if (isClaudeAvailable()) chain.push('claude');
      //   ถอยกลับระบบเดิมเป๊ะ: ตั้ง env CLAUDE_WRITE_MODEL=claude-opus-4-8 (primary=fallback → เรียกครั้งเดียวเหมือนเดิม)
      if (isClaudeAvailable()) chain.push('claude-write');
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

async function callModel(modelName, { prompt, temperature, maxTokens, systemPrompt, signal }) {
  switch (modelName) {
    case 'claude':
      return callClaude({ prompt, temperature, maxTokens, systemPrompt, signal });

    // ★ 15 ส.ค. 69 (เจ้าของเคาะ · แผน Fable+Sol · แล็บพิสูจน์ ladder 5 เคส): สายนักเขียนโดยเฉพาะ
    //   fable-5 ล้ม (refusal/HTTP/เนื้อว่าง/JSON พัง — โยนเป็น error จาก callClaude ทั้งหมด) → ถอย opus-4.8
    //   ไม่ถอยเมื่อ: งบเวลาหมด (signal.aborted — ชั้นนอกตัดแล้ว) · ตั้ง fallback=off · primary=fallback (โหมดถอยกลับระบบเดิม)
    //   opus-4.8 ล้มซ้ำ → โยนต่อเข้าโซ่ chain เดิม (gpt4o) — โซ่ GPT เดิมไม่ถูกลบ (กฎ AGENTS.md)
    case 'claude-write': {
      // 🔴 ห้ามตั้ง env CLAUDE_WRITE_MODEL=claude-fable-5 เด็ดขาด (ปล่อยว่าง = fable อยู่แล้ว) —
      //    env ตัวนี้ป้อน DEFAULT_WRITE_MODEL ใน claudeClient ด้วย ตั้งแล้วจะลาก fabricationGate + โซ่สำรอง breakdown
      //    ไป fable ทั้งคู่ (จ่ายแพง 2 เท่าผิดจุด) — ใช้ env นี้ทางเดียว: =claude-opus-4-8 เพื่อถอยกลับระบบเดิม
      // ★ ผู้ตรวจก่อน push: strip เครื่องหมายคำพูด/ช่องว่าง (กับดัก vercel env ใน memory) + off เทียบแบบไม่สนตัวพิมพ์
      const _clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '');
      const _primary = _clean(process.env.CLAUDE_WRITE_MODEL) || 'claude-fable-5';
      const _fbRaw = _clean(process.env.CLAUDE_WRITE_FALLBACK_MODEL);
      const _fb = _fbRaw || 'claude-opus-4-8';
      try {
        return await callClaude({ prompt, temperature, maxTokens, systemPrompt, signal, model: _primary });
      } catch (wErr) {
        rethrowPipelineDeadline(wErr, `claude-write:${_primary}`);
        const _noRetry = signal?.aborted || _fb.toLowerCase() === 'off' || _fb === _primary;
        if (_noRetry) throw wErr;
        console.warn(`[aiRouter] ⚠️ นักเขียนหลัก ${_primary} ล้ม (${String(wErr.message || '').slice(0, 90)}) → ถอยตัวสำรอง ${_fb}`);
        return await callClaude({ prompt, temperature, maxTokens, systemPrompt, signal, model: _fb });
      }
    }
    case 'gemini':
      // callGemini มี timeout 15s ในตัว — ไม่ต้องส่ง signal
      return callGemini({ prompt, temperature, maxTokens, signal });
    case 'gpt4o':
    default:
      return callAI({ prompt, temperature, maxTokens, model: MODEL_PRIMARY, signal });
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
