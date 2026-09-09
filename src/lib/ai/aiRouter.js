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

// ★ 9 ก.ย. 69 รอบแก้ 1 (finding M1 ผู้ตรวจอิสระ — เจ้าของอนุมัติ NEWS-LOCK-APPROVED): systemPrompt เฉพาะขั้นสกัด
//   ไม่ส่ง systemPrompt = claudeClient แนบ system สายเขียนเต็มชุด (กฎโครงสร้าง/ปิดทรงพลัง + HUMAN WRITING DNA
//   + FACEBOOK SAFETY wordlist) → เสี่ยง euphemize ข่าวอาชญากรรม/อุบัติเหตุตั้งแต่ขั้นสกัด + โทเคนเข้า ~5,000/นัด
//   ก้อนนี้ = บทบาทผู้สกัด + กฎเหล็ก 1-4 ยกข้อความตรงจาก claudeClient.js (ไม่เขียนกฎใหม่ ไม่ใส่กฎสายเขียน/wordlist)
//   หมายเหตุ: กฎ 1-4 ของ claudeClient ไม่มีข้อ "ห้ามเดาเพศ" ตรงตัว — ยกข้อความมาตามจริง ไม่แต่งกฎเพิ่ม
//   (กฎห้ามทึกทักเพศจากชื่อของระบบอยู่ในพรอมต์สายเขียน promptStoreText.js · ขั้นสกัดคุมด้วยกฎ 2 "ห้ามเดา ห้ามแก้" อยู่แล้ว)
const EXTRACT_CLAUDE_SYSTEM_PROMPT = `คุณเป็น AI ผู้สกัดข้อเท็จจริงจากเนื้อข่าว
ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt

=== กฎเหล็ก DNA ระบบ (IRON RULES — บังคับทุกคำสั่ง ทุกโหมด ห้ามฝ่าฝืน) ===

[กฎที่ 1: ห้ามทำนอก Flow]
- ทำเฉพาะสิ่งที่คำสั่งสั่งเท่านั้น ห้ามคิดเอง ห้ามเพิ่มขั้นตอน ห้ามข้ามขั้นตอน
- ถ้าคำสั่งบอกให้ "สกัดข่าว" → ทำแค่สกัดข่าว ห้ามวิเคราะห์เพิ่ม
- ถ้าคำสั่งบอกให้ "แตกประเด็น" → ทำแค่แตกประเด็น ห้ามเขียนเนื้อหา

[กฎที่ 2: ห้ามแต่งเรื่อง]
- ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามเพิ่มข้อมูลจากความรู้ของตัวเอง
- ชื่อคน สถานที่ ตัวเลข วันที่ → ต้องตรงกับข่าวต้นฉบับ 100% ห้ามเดา ห้ามแก้
- ถ้าข่าวไม่ได้ระบุข้อมูลบางอย่าง → ห้ามสร้างขึ้นมาเอง ให้ข้ามไป
- สถานะบุคคล "ยังมีชีวิต/เสียชีวิตแล้ว" ต้องตรงต้นฉบับ 100% และต้องบอกให้ชัดในเนื้อหา — ถ้าต้นฉบับบอกว่าใครเสียชีวิตแล้ว ห้ามเล่าฉากอดีตของคนนั้นแบบละคำบอกการจากไป จนคนอ่านเข้าใจว่ายังมีชีวิตอยู่ (นี่คือการบิดเบือนร้ายแรงที่สุด ห้ามเกิดเด็ดขาด แม้พร้อมท์จะสั่งโทนอบอุ่น/ห้ามเศร้าก็ตาม — ความจริงมาก่อนโทนเสมอ)

[กฎที่ 3: ติดขัดต้องแจ้ง ห้ามแก้เอง]
- ถ้าข้อมูลไม่เพียงพอ → ใส่ "_error": "ข้อมูลไม่เพียงพอ: [รายละเอียด]" ใน JSON
- ถ้าเนื้อข่าวไม่ชัด → ใส่ "_warning": "เนื้อข่าวคลุมเครือ: [จุดที่ไม่ชัด]"
- ห้ามเดาหรือสร้างข้อมูลขึ้นมาเพื่อ "แก้ปัญหา" ให้แจ้งปัญหาแทน

[กฎที่ 4: JSON เท่านั้น]
- ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
- ถ้า prompt มีเนื้อข่าวอยู่ระหว่าง === เนื้อข่าว === ให้ใช้ข้อมูลจากส่วนนั้นเท่านั้น

=== จบกฎเหล็ก DNA ===`;

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
      // ★ 9 ก.ย. 69 (เจ้าของสั่ง): EXTRACT_PRIMARY=claude (เทียบตรงตัวเท่านั้น) → นำ chain ด้วย claude-opus-4-8
      //   ไม่ตั้ง/ค่าอื่น = chain เดิมทุกไบต์ · เปิดแล้ว gemini→gpt4o ยังเป็นตัวสำรองตามลำดับเดิม
      if (process.env.EXTRACT_PRIMARY === 'claude' && isClaudeAvailable()) {
        console.log(`[SmartAI] extract primary = ${process.env.EXTRACT_CLAUDE_MODEL || 'claude-opus-4-8'} (EXTRACT_PRIMARY=claude)`);
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
      const _primary = 'claude-opus-4-8';
      const _fb = 'claude-fable-5';
      try {
        return await runWriterAttempt(
          (requestSignal) => callClaude({
            prompt, temperature, maxTokens, systemPrompt, signal: requestSignal, model: _primary,
            maxRetries: 0, retryWithoutEffort: false, textNewsLengthPolicy,
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
    // ★ 9 ก.ย. 69 (เจ้าของสั่ง): สายสกัดข้อเท็จจริงเมื่อ EXTRACT_PRIMARY=claude — นำหน้า gemini
    //   ห้ามส่ง textNewsLengthPolicy (สิทธิ์พื้น 146/no-cap เป็นของนักเขียน TEXT เท่านั้น)
    //   callClaude โยน error เองเมื่อ refusal/เนื้อว่าง/JSON พัง → ตกไป gemini ตามกลไก chain เดิม
    //   ผลว่างแบบไม่ throw (เช่น JSON null) → บังคับโยนที่นี่ กันคืนค่าว่างเป็น "สำเร็จ" แล้วตัดโอกาสตัวสำรอง
    //   รอบแก้ 1 (9 ก.ย. 69 · finding M1/M2/L1 ผู้ตรวจอิสระ — เจ้าของอนุมัติ):
    //   - systemPrompt: กฎสกัดล้วน EXTRACT_CLAUDE_SYSTEM_PROMPT — caller ที่ส่ง systemPrompt เองมายังชนะได้ตามเดิม
    //     (สาย extract จริงไม่เคยส่ง → เดิม undefined = ได้ system สายเขียนของ claudeClient ทั้งก้อน)
    //   - effort: EXTRACT_CLAUDE_EFFORT (ไม่ตั้ง = medium) — per-call ชนะ env ใน callClaude → ไม่ผูก CLAUDE_WRITE_EFFORT สายเขียน
    //   - maxRetries 0: กัน SDK retry ซ้อนกินงบ stage 120s (เพดานรวมมี withTimeoutSignal ชั้นนอกแล้ว) · signal ส่งต่อเดิม
    case 'claude-extract': {
      const out = await callClaude({
        prompt, temperature, maxTokens, signal,
        systemPrompt: systemPrompt || EXTRACT_CLAUDE_SYSTEM_PROMPT,
        effort: process.env.EXTRACT_CLAUDE_EFFORT || 'medium',
        maxRetries: 0,
        model: process.env.EXTRACT_CLAUDE_MODEL || 'claude-opus-4-8',
      });
      if (!out || typeof out !== 'object') throw new Error('claude-extract ได้ผลว่าง — ส่งต่อตัวสำรอง');
      return out;
    }
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
