/**
 * ========================================
 * AI ROUTER — Smart Model Selection
 * ========================================
 * เลือก AI model ที่เหมาะสมสำหรับแต่ละ task อัตโนมัติ
 * 
 * Strategy:
 *   Extraction → Gemini Flash (เร็ว + ถูก)
 *   Breakdown  → GPT-4o (คิดลึก + structured)
 *   Writing    → Claude Opus 5.5 (★ 23 ก.ย. 69 · เดิม Opus 4.8) → Claude Fable 5
 *   Fallback   → GPT-5.6 Sol (ถ้า Claude ใช้งานไม่ได้)
 */
import { callAI } from './openai.js';
import { callClaude, isClaudeAvailable } from './claudeClient.js';
import { callGemini, isGeminiAvailable } from './geminiClient.js';
import { MODEL_PRIMARY } from './modelConfig.js';
import { rethrowPipelineDeadline } from '../utils/pipelineDeadline.js';
import { withTimeoutSignal } from '../utils/withTimeout.js';
import { EXTRACT_SYSTEM_PROMPT, taskSystemPrompt, slimSystem } from './taskSystemPrompts.js'; // ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ) — OV-04/MC-16: system สั้นเฉพาะงาน + ชุดสกัดเดียวกันทุกโมเดลใน chain (ถอย SYSTEM_PROMPT_SLIM=0)

// ★ 23 ก.ย. 69 (เจ้าของสั่ง): เพดานเวลาต่อไม้ของนักเขียน — opus 90s→150s · fable 75s→90s · sol คง 90s (ของเดิม: opus 90s · fable 75s · sol 90s)
//   ผลวัดจริง 23 ก.ย. 19:10 (คีย์ production · พรอมต์เขียน 17k โทเคน · 2 เวอร์ชัน): opus-5-5 medium 34.5/39.7 วิ (TTFB 17–21 วิ)
//   เทียบ opus-4-8 32.3 วิ · production 4-8 นักเขียนจริง 35–37 วิ → ตั้งเพดาน 150 วิ = margin ~3.8× ของรอบช้าสุดที่วัดได้ (39.7 วิ) เผื่อพรอมต์จริงใหญ่กว่า
//   ตัวเลขเจ้าของอนุมัติจากผลวัด ("ปรับเพดานเวลาให้รอนานขึ้นได้จะได้ไม่ล้ม") · ผลรวมโซ่ 150+90+90 = 330 วิ
//   ⚠️ ข้อจำกัด: withTimeoutSignal จอง (assertCanStart) เต็มค่า ms จากงบงาน 700s ก่อนเริ่มทุกขั้น → generate_A คง 420s (ยก = บีบหน้าต่างก่อนเขียน)
//   จึงต้องให้ write_inner ≤ 420−60(research) = 360 → ตั้ง 350 และโซ่ 330 ต้องพอดีใน 350 (ดู tests/opus55-timeouts.test.mjs)
//   → write_inner (summarizeServiceText) = 350 ≥ 330+เผื่อ 20 และ generate_A (autoFlowServiceText) = 420 ≥ write_inner+research 60 — tests/opus55-timeouts.test.mjs ล็อกไว้
const WRITER_ATTEMPT_TIMEOUT_MS = Object.freeze({
  opus: 150_000,
  fable: 90_000,
  sol: 90_000,
});

// ★ 9 ก.ย. 69 รอบแก้ 1 (finding M1 ผู้ตรวจอิสระ — เจ้าของอนุมัติ NEWS-LOCK-APPROVED): systemPrompt เฉพาะขั้นสกัด
//   ไม่ส่ง systemPrompt = claudeClient แนบ system สายเขียนเต็มชุด (กฎโครงสร้าง/ปิดทรงพลัง + HUMAN WRITING DNA
//   + FACEBOOK SAFETY wordlist) → เสี่ยง euphemize ข่าวอาชญากรรม/อุบัติเหตุตั้งแต่ขั้นสกัด + โทเคนเข้า ~5,000/นัด
//   ก้อนนี้ = บทบาทผู้สกัด + กฎเหล็ก 1-4 ยกข้อความตรงจาก claudeClient.js (ไม่เขียนกฎใหม่ ไม่ใส่กฎสายเขียน/wordlist)
//   หมายเหตุ: กฎ 1-4 ของ claudeClient ไม่มีข้อ "ห้ามเดาเพศ" ตรงตัว — ยกข้อความมาตามจริง ไม่แต่งกฎเพิ่ม
//   (กฎห้ามทึกทักเพศจากชื่อของระบบอยู่ในพรอมต์สายเขียน promptStoreText.js · ขั้นสกัดคุมด้วยกฎ 2 "ห้ามเดา ห้ามแก้" อยู่แล้ว)
// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ) — MC-16: ข้อความก้อนนี้ย้ายไป ./taskSystemPrompts.js ในชื่อ EXTRACT_SYSTEM_PROMPT (ข้อความเดิมทุกไบต์ —
//   ข้อสอบ tests/system-prompt-slim-ov04.test.mjs ล็อกความเท่ากับกฎเหล็ก 1–4 ของ claudeClient.js) เพราะตัวสำรอง gemini/gpt ใน chain สกัดต้องได้ system ชุดเดียวกับ claude-extract
//   (ของเดิม: const EXTRACT_CLAUDE_SYSTEM_PROMPT = `คุณเป็น AI ผู้สกัดข้อเท็จจริงจากเนื้อข่าว … === จบกฎเหล็ก DNA ===`; — 26 บรรทัด · เนื้อหาเดียวกับ correctionAiGuard.js IRON_RULES_1_TO_4)

// ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S1 · เจ้าของอนุมัติ) — MC-01/PL-02: ขอบเขตตัวกรองคำเสี่ยง (safetyFilter.sanitizeOutput)
//   ผล "ข้อเท็จจริง" (สกัด/แตกประเด็น/รีเสิร์ช) ห้ามผ่านตัวกรอง — ตัวกรองเคยพลิกข้อเท็จจริงตั้งแต่ขั้นสกัด (ผูกคอแต่ช่วยทัน→เสียชีวิต)
//   นักเขียน ('write') = ข้อความโพสต์ → ผ่านตัวกรองขอบคำ · งานอื่น (default) caller ตัดสินเองผ่าน options.sanitizeScope
//   caller ส่ง options.sanitizeScope มาชนะตารางนี้ · SANITIZE_LEGACY=1 = client กรองแบบเดิมทุก call ไม่สนค่านี้
const TASK_SANITIZE_SCOPE = Object.freeze({
  extract: 'facts',
  breakdown: 'facts',
  analyze: 'facts',
  write: 'post',
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
  // ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ) — OV-04/MC-16: system สั้นเฉพาะงานระดับ router — caller ส่งมาเองชนะ ·
  //   extract/breakdown/analyze ไม่ส่ง = ค่าเริ่มต้นจากตาราง TASK_SYSTEM_PROMPT (extract → EXTRACT_SYSTEM_PROMPT ชุดเดียวกับ claude-extract ให้ gemini/gpt ตัวสำรองด้วย = MC-16)
  //   · 'write' ไม่แทรกเด็ดขาด (system นักเขียนเดิมทุกไบต์) · SYSTEM_PROMPT_SLIM=0 = ส่งต่อค่าจาก caller เท่านั้นเหมือนเดิม
  //   (ของเดิม: const { prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy = false, sanitizeScope: sanitizeScopeOpt } = options;)
  const { prompt, temperature, maxTokens, systemPrompt: systemPromptOpt, signal, textNewsLengthPolicy = false, sanitizeScope: sanitizeScopeOpt } = options;
  const systemPrompt = taskSystemPrompt(task, systemPromptOpt);
  // สิทธิ์พื้น 146/no-cap เป็นของนักเขียนข่าว TEXT เท่านั้น
  // ต่อให้ caller งานอื่นส่ง true ผิดมา Router ต้องตัดทิ้ง ไม่ให้รั่วเข้า Breakdown/การ์ด/Blueprint/QC
  const useTextNewsLengthPolicy = task === 'write' && textNewsLengthPolicy === true;
  // ★ 24 ก.ย. 69 (S1): ขอบเขตตัวกรองคำเสี่ยงตาม task (caller ส่งมาเองชนะ) — ดู TASK_SANITIZE_SCOPE
  const sanitizeScope = sanitizeScopeOpt || TASK_SANITIZE_SCOPE[task];
  
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
        sanitizeScope,
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
      // ★ 9 ก.ย. 69 (เจ้าของสั่ง): EXTRACT_PRIMARY=claude (เทียบตรงตัวเท่านั้น) → นำ chain ด้วย claude-opus-4-8
      //   ไม่ตั้ง/ค่าอื่น = chain เดิมทุกไบต์ · เปิดแล้ว gemini→gpt4o ยังเป็นตัวสำรองตามลำดับเดิม
      // ★ 23 ก.ย. 69 (เจ้าของสั่ง): opus-4-8 → opus-5-5 — default ของ EXTRACT_CLAUDE_MODEL (log นี้ + case 'claude-extract')
      //   ถอยกลับไม่ต้องแก้โค้ด: EXTRACT_CLAUDE_MODEL=claude-opus-4-8
      if (process.env.EXTRACT_PRIMARY === 'claude' && isClaudeAvailable()) {
        console.log(`[SmartAI] extract primary = ${process.env.EXTRACT_CLAUDE_MODEL || 'claude-opus-5-5'} (EXTRACT_PRIMARY=claude)`);
        chain.push('claude-extract');
      }
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
      // ★ 23 ก.ย. 69 (เจ้าของสั่ง): opus-4-8 → opus-5-5 — นักเขียนหลัก = claude-opus-5-5 → Fable 5 → Sol (ลำดับ/กติกาเดิม · เพดานต่อไม้ใหม่ 150/90/90 วิ)
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

// ★ 24 ก.ย. 69 (S1): + sanitizeScope ส่งต่อทุก client (ของเดิม: callModel(modelName, { prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy }))
async function callModel(modelName, { prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy, sanitizeScope }) {
  switch (modelName) {
    case 'claude':
      return callClaude({ prompt, temperature, maxTokens, systemPrompt, signal, textNewsLengthPolicy, sanitizeScope });

    // ★ 21 ส.ค. 69 (เจ้าของเคาะจากศึกตาบอด R118): สายนักเขียนโดยเฉพาะ
    //   opus-4.8 ล้ม (refusal/HTTP/เนื้อว่าง/JSON พัง — โยนเป็น error จาก callClaude ทั้งหมด) → ถอย fable-5
    //   ไม่ถอยเมื่อ: งบเวลาหมด (signal.aborted — ชั้นนอกตัดแล้ว)
    //   fable-5 ล้มซ้ำ → โยนต่อให้ writer-sol หนึ่งครั้ง แล้วจบ (ไม่มี Terra/ไม่มี Sol รอบสอง)
    case 'claude-write': {
      // ล็อกในโค้ดเพื่อไม่ให้ค่า CLAUDE_WRITE_MODEL เก่าบน Vercel ทับผลศึกตาบอดของเจ้าของ
      // ★ 23 ก.ย. 69 (เจ้าของสั่ง): opus-4-8 → opus-5-5 (ของเดิม: const _primary = 'claude-opus-4-8';)
      //   สายนี้ไม่อ่าน env โดยตั้งใจ → ถอยกลับ = แก้ค่านี้คืนเป็น 'claude-opus-4-8'
      //   opus-5-5 คิดก่อนตอบเสมอ (ปิดไม่ได้) → callClaude ยกเพดาน max_tokens ≥16000 ให้เอง (_thinkingOn ครอบ prefix opus-5)
      const _primary = 'claude-opus-5-5';
      const _fb = 'claude-fable-5';
      try {
        return await runWriterAttempt(
          (requestSignal) => callClaude({
            prompt, temperature, maxTokens, systemPrompt, signal: requestSignal, model: _primary,
            maxRetries: 0, retryWithoutEffort: false, textNewsLengthPolicy,
            sanitizeScope,
          }),
          WRITER_ATTEMPT_TIMEOUT_MS.opus, 'writer_opus', signal
        );
      } catch (wErr) {
        rethrowPipelineDeadline(wErr, `claude-write:${_primary}`);
        if (signal?.aborted) throw wErr;
        console.warn(`[aiRouter] ⚠️ นักเขียนหลัก ${_primary} ล้ม (${String(wErr.message || '').slice(0, 90)}) → ถอยตัวสำรอง ${_fb}`);
        return await runWriterAttempt(
          (requestSignal) => callClaude({
            prompt, temperature, maxTokens, systemPrompt, signal: requestSignal, model: _fb,
            maxRetries: 0, retryWithoutEffort: false, textNewsLengthPolicy,
            sanitizeScope,
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
          sanitizeScope,
        }),
        WRITER_ATTEMPT_TIMEOUT_MS.sol, 'writer_sol', signal
      );
    // ★ 9 ก.ย. 69 (เจ้าของสั่ง): สายสกัดข้อเท็จจริงเมื่อ EXTRACT_PRIMARY=claude — นำหน้า gemini
    //   ห้ามส่ง textNewsLengthPolicy (สิทธิ์พื้น 146/no-cap เป็นของนักเขียน TEXT เท่านั้น)
    //   callClaude โยน error เองเมื่อ refusal/เนื้อว่าง/JSON พัง → ตกไป gemini ตามกลไก chain เดิม
    //   ผลว่างแบบไม่ throw (เช่น JSON null) → บังคับโยนที่นี่ กันคืนค่าว่างเป็น "สำเร็จ" แล้วตัดโอกาสตัวสำรอง
    //   รอบแก้ 1 (9 ก.ย. 69 · finding M1/M2/L1 ผู้ตรวจอิสระ — เจ้าของอนุมัติ):
    //   - systemPrompt: กฎสกัดล้วน EXTRACT_CLAUDE_SYSTEM_PROMPT — caller ที่ส่ง systemPrompt เองมายังชนะได้ตามเดิม (★ 24 ก.ย. 69 S8: ปัจจุบันชื่อ EXTRACT_SYSTEM_PROMPT ใน ./taskSystemPrompts.js — router ส่งชุดเดียวกันให้ gemini/gpt ตัวสำรองด้วย)
    //     (สาย extract จริงไม่เคยส่ง → เดิม undefined = ได้ system สายเขียนของ claudeClient ทั้งก้อน)
    //   - effort: EXTRACT_CLAUDE_EFFORT (ไม่ตั้ง = medium) — per-call ชนะ env ใน callClaude → ไม่ผูก CLAUDE_WRITE_EFFORT สายเขียน
    //   - maxRetries 0: กัน SDK retry ซ้อนกินงบ stage 120s (เพดานรวมมี withTimeoutSignal ชั้นนอกแล้ว) · signal ส่งต่อเดิม
    case 'claude-extract': {
      const out = await callClaude({
        prompt, temperature, maxTokens, signal,
        systemPrompt: systemPrompt || EXTRACT_SYSTEM_PROMPT, // ★ 24 ก.ย. 69 (S8 — MC-16): ชื่อเดิม EXTRACT_CLAUDE_SYSTEM_PROMPT · โหมดถอย router ส่ง undefined มา = ยังได้ชุดสกัดตามรอบแก้ M1 เหมือนเดิม
        effort: process.env.EXTRACT_CLAUDE_EFFORT || 'medium',
        maxRetries: 0,
        // ★ 23 ก.ย. 69 (เจ้าของสั่ง): opus-4-8 → opus-5-5 · ถอยกลับ: EXTRACT_CLAUDE_MODEL=claude-opus-4-8
        model: process.env.EXTRACT_CLAUDE_MODEL || 'claude-opus-5-5',
        sanitizeScope, // ★ 24 ก.ย. 69 (S1): 'facts' — ผลสกัดต้องคงคำต้นฉบับ ไม่ผ่านตัวกรองคำเสี่ยง
      });
      if (!out || typeof out !== 'object') throw new Error('claude-extract ได้ผลว่าง — ส่งต่อตัวสำรอง');
      return out;
    }
    case 'gemini':
      // callGemini มี timeout 15s ในตัว — ไม่ต้องส่ง signal
      // ★ 24 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 1 S8 · เจ้าของอนุมัติ) — MC-16: ส่ง system สั้นเฉพาะงานให้ gemini ด้วย (callGemini รับ systemPrompt แล้ว · ไม่ส่ง = systemInstruction ฝังเดิม)
      //   โหมดถอย SYSTEM_PROMPT_SLIM=0: slimSystem คืน {} = args เดิมทุกไบต์ (ของเดิม: return callGemini({ prompt, temperature, maxTokens, signal, sanitizeScope });)
      return callGemini({ prompt, temperature, maxTokens, signal, sanitizeScope, ...slimSystem(systemPrompt) });
    case 'gpt4o':
    default:
      // ★ 24 ก.ย. 69 (S8 — OV-04/MC-16): ส่ง system สั้นเฉพาะงานให้ gpt ด้วย (เดิมทิ้ง systemPrompt = ได้ system สายเขียนของ openai.js ทั้งก้อน แม้ caller ส่งมา)
      //   โหมดถอย SYSTEM_PROMPT_SLIM=0: slimSystem คืน {} = args เดิมทุกไบต์ (ของเดิม: return callAI({ prompt, temperature, maxTokens, model: MODEL_PRIMARY, signal, textNewsLengthPolicy, sanitizeScope });)
      return callAI({ prompt, temperature, maxTokens, model: MODEL_PRIMARY, signal, textNewsLengthPolicy, sanitizeScope, ...slimSystem(systemPrompt) });
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
