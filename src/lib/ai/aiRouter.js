/**
 * ========================================
 * AI ROUTER — Smart Model Selection
 * ========================================
 * เลือก AI model ที่เหมาะสมสำหรับแต่ละ task อัตโนมัติ
 * 
 * Strategy:
 *   Extraction → Gemini Flash (เร็ว + ถูก)
 *   Breakdown  → GPT-4o (คิดลึก + structured)
 *   Writing    → Claude Opus 4.8 → Claude Fable 5
 *   Fallback   → GPT-5.6 Sol (ถ้า Claude ใช้งานไม่ได้)
 */
import { callAI } from './openai.js';
import { callClaude, isClaudeAvailable } from './claudeClient.js';
import { callGemini, isGeminiAvailable } from './geminiClient.js';
import { MODEL_PRIMARY } from './modelConfig.js';
import { rethrowPipelineDeadline } from '../utils/pipelineDeadline.js';
import { withTimeoutSignal } from '../utils/withTimeout.js';

const WRITER_ATTEMPT_TIMEOUT_MS = Object.freeze({
  opus: 90_000,
  fable: 75_000,
  sol: 90_000,
});

function runWriterAttempt(factory, timeoutMs, step, parentSignal) {
  // บังคับให้ withTimeoutSignal ยกเลิก HTTP จริงแม้ caller เก่าไม่ได้ส่ง signal มา
  const abortableParent = parentSignal
    || (typeof AbortController !== 'undefined' ? new AbortController().signal : undefined);
  return withTimeoutSignal(factory, timeoutMs, step, abortableParent);
}

/**
 * เลือก model + เรียก AI อัตโนมัติ
 * @param {string} task - 'extract', 'breakdown', 'write', 'general'
 * @param {object} options - { prompt, temperature, maxTokens, systemPrompt, textNewsLengthPolicy }
 */
export async function callSmartAI(task, options) {
  const { prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy = false } = options;
  // สิทธิ์พื้น 146/no-cap เป็นของนักเขียนข่าว TEXT เท่านั้น
  // ต่อให้ caller งานอื่นส่ง true ผิดมา Router ต้องตัดทิ้ง ไม่ให้รั่วเข้า Breakdown/การ์ด/Blueprint/QC
  const useTextNewsLengthPolicy = task === 'write' && textNewsLengthPolicy === true;
  
  // กำหนด strategy ตาม task
  const strategy = getStrategy(task);
  
  console.log(`[SmartAI] Task="${task}" → Cascading Chain: [${strategy.chain.join(' ➡️ ')}]`);

  const temp = temperature ?? strategy.defaultTemp;
  const maxT = maxTokens ?? strategy.defaultMaxTokens;
  const errors = [];

  for (let i = 0; i < strategy.chain.length; i++) {
    const modelName = strategy.chain[i];
    try {
      const result = await callModel(modelName, {
        prompt,
        temperature: temp,
        maxTokens: maxT,
        systemPrompt,
        signal,
        textNewsLengthPolicy: useTextNewsLengthPolicy,
      });
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
      if (signal?.aborted) throw err;
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
      // Content Writing: Opus 4.8 -> Fable 5 -> GPT-5.6 Sol (ครั้งละ 1 request)
      // ★ 21 ส.ค. 69 (เจ้าของเลือกจากศึกตาบอด R118): นักเขียนหลัก → claude-opus-4-8
      //   ผ่าน token เฉพาะสายเขียน เพื่อไม่ให้ fallback Sol→Terra / SDK retry ของงานอื่นเปลี่ยนตาม
      //   case 'claude' เดิมคงไว้ทุกไบต์ให้ breakdown/ผู้ใช้อื่น (แผน Fable: ห้ามแก้ DEFAULT_WRITE_MODEL กลาง กันลาม fabricationGate)
      //   ของเดิม: if (isClaudeAvailable()) chain.push('claude');
      if (isClaudeAvailable()) chain.push('claude-write');
      chain.push('writer-sol');
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

async function callModel(modelName, { prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy }) {
  switch (modelName) {
    case 'claude':
      return callClaude({ prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy });

    // ★ 21 ส.ค. 69 (เจ้าของเคาะจากศึกตาบอด R118): สายนักเขียนโดยเฉพาะ
    //   opus-4.8 ล้ม (refusal/HTTP/เนื้อว่าง/JSON พัง — โยนเป็น error จาก callClaude ทั้งหมด) → ถอย fable-5
    //   ไม่ถอยเมื่อ: งบเวลาหมด (signal.aborted — ชั้นนอกตัดแล้ว)
    //   fable-5 ล้มซ้ำ → โยนต่อให้ writer-sol หนึ่งครั้ง แล้วจบ (ไม่มี Terra/ไม่มี Sol รอบสอง)
    case 'claude-write': {
      // ล็อกในโค้ดเพื่อไม่ให้ค่า CLAUDE_WRITE_MODEL เก่าบน Vercel ทับผลศึกตาบอดของเจ้าของ
      // ★ 2 ก.ย. 69 ห้องทดลอง (เจ้าของสั่ง "ลองเปลี่ยนโมเดลสำหรับทดลอง"): WRITER_MODEL_LAB = ชื่อ env ใหม่ ไม่มีบน Vercel
      //   → production ยังล็อก opus-4-8 เป๊ะ · ตั้งค่าเฉพาะสนามเทสในเครื่อง (เช่น claude-fable-5-1) · ตัวสำรองสลับไม่ให้ซ้ำตัวหลัก
      const _lab = String(process.env.WRITER_MODEL_LAB || '').trim();
      const _primary = _lab || 'claude-opus-4-8';
      const _fb = _primary === 'claude-fable-5' ? 'claude-opus-4-8' : 'claude-fable-5';
      const _primaryTimeout = /fable/.test(_primary) ? WRITER_ATTEMPT_TIMEOUT_MS.fable : WRITER_ATTEMPT_TIMEOUT_MS.opus;
      if (_lab) console.log(`[aiRouter] 🧪 WRITER_MODEL_LAB=${_primary} (สนามเทส — production ไม่ใช้ค่านี้)`);
      try {
        return await runWriterAttempt(
          (requestSignal) => callClaude({
            prompt, temperature, maxTokens, systemPrompt, signal: requestSignal, model: _primary,
            maxRetries: 0, retryWithoutEffort: false, textNewsLengthPolicy,
          }),
          _primaryTimeout, 'writer_opus', signal
        );
      } catch (wErr) {
        rethrowPipelineDeadline(wErr, `claude-write:${_primary}`);
        if (signal?.aborted) throw wErr;
        console.warn(`[aiRouter] ⚠️ นักเขียนหลัก ${_primary} ล้ม (${String(wErr.message || '').slice(0, 90)}) → ถอยตัวสำรอง ${_fb}`);
        return await runWriterAttempt(
          (requestSignal) => callClaude({
            prompt, temperature, maxTokens, systemPrompt, signal: requestSignal, model: _fb,
            maxRetries: 0, retryWithoutEffort: false, textNewsLengthPolicy,
          }),
          WRITER_ATTEMPT_TIMEOUT_MS.fable, 'writer_fable', signal
        );
      }
    }
    case 'writer-sol':
      return runWriterAttempt(
        (requestSignal) => callAI({
          prompt, temperature, maxTokens, model: MODEL_PRIMARY, signal: requestSignal,
          allowModelFallback: false, maxRetries: 0, textNewsLengthPolicy,
        }),
        WRITER_ATTEMPT_TIMEOUT_MS.sol, 'writer_sol', signal
      );
    case 'gemini':
      // callGemini มี timeout 15s ในตัว — ไม่ต้องส่ง signal
      return callGemini({ prompt, temperature, maxTokens, signal });
    case 'gpt4o':
    default:
      return callAI({ prompt, temperature, maxTokens, model: MODEL_PRIMARY, signal, textNewsLengthPolicy });
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
