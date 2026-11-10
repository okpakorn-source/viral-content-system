/**
 * =====================================================
 * News Studio — ตัวเรียกโมเดลของท่อเขียนข่าวตัวใหม่ (10 พ.ย. 69)
 * =====================================================
 * ทำไมไม่ใช้ตัวเรียกของท่อเดิม (era/claudeClient.js · era/openai.js):
 *   - ตัวเดิมบังคับตอบ JSON + ยัดกฎสำนวนชุดเก่าเข้า system เอง → ชนกับกฎชุดเดียวของนักเขียนแบบครู
 *   - ตัวเดิมเอาคำตอบผ่าน sanitizeOutput (แทนคำ 33 คู่แบบไม่ดูขอบคำ) → ท่อใหม่เทียบถ้อยคำกับเนื้อข่าวแบบตรงตัว
 *     (ถ้อยคำที่ต้องคง · คำพูดที่ห้ามแต่ง · ถ้อยคำที่ผู้ตรวจชี้) ถูกแทนคำกลางทาง = ตรวจผิดทั้งเส้น
 *   - ตัวเดิมไม่ดู stop_reason → คำตอบถูกตัด/ถูกปฏิเสธ หลุดไปเป็นเนื้อข่าวได้
 *
 * ไฟล์นี้ไม่สร้าง client เอง และไม่ import แบบ alias — ผู้เรียกส่ง client + ตัวบันทึกการใช้งานเข้ามา (เทสได้โดยไม่ยิง API)
 */

const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '');

/**
 * งบเวลา (วินาที) — ต้องจบใน maxDuration 300 ของ route แม้ทุกขั้นช้าถึงเพดาน:
 *   รอบแรก: ทิศทาง 90 (วิเคราะห์ 30 เดินขนาน) + บรรณารักษ์ 30 + เขียน 75 + ตรวจ 75 (ผู้อ่าน 60 เดินขนาน) = 270
 *   รอบแก้: เริ่มได้เมื่อผ่านไปไม่เกิน STUDIO_BUDGET.retryDeadlineMs (130) + เขียน 75 + ตรวจ 75 = 280
 *   เกิน STUDIO_BUDGET.hardMs (285) = ปิดงานเป็น "ไม่สำเร็จ" พร้อมบันทึกเหตุ ก่อนโฮสต์ตัด
 * SDK ไม่ลองซ้ำเอง (maxRetries 0) เพราะลองซ้ำหลังหมดเวลา = เวลาคูณสอง — ลองซ้ำ 1 ครั้งเฉพาะเมื่อล้มเร็วด้วยเหตุชั่วคราว (ดู callWithQuickRetry)
 */
export const STUDIO_BUDGET = Object.freeze({ retryDeadlineMs: 130000, hardMs: 285000, quickRetryWithinMs: 12000, quickRetryWaitMs: 1500 });
const TRANSIENT = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** เรียก 1 ครั้ง · ถ้าล้ม "เร็ว" ด้วยเหตุชั่วคราว (โมเดลแน่น/เครือข่ายสะดุด) ลองอีก 1 ครั้ง · ล้มช้าหรือหมดเวลา = ไม่ลองซ้ำ */
async function callWithQuickRetry(fn, { now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const started = now();
  try {
    return await fn();
  } catch (e) {
    if (!TRANSIENT.has(Number(e?.status)) || now() - started > STUDIO_BUDGET.quickRetryWithinMs) throw e;
    await wait(STUDIO_BUDGET.quickRetryWaitMs);
    return fn();
  }
}

/** โมเดล/ระดับความคิดของแต่ละบทบาท — ค่าตั้งต้นคือชุดที่ผ่านการทดลอง 7 รอบ · เปลี่ยนได้ด้วย env โดยไม่แก้โค้ด */
export function studioModels(env = process.env) {
  const writer = clean(env.NEWS_STUDIO_WRITER_MODEL) || 'claude-opus-4-8';
  return {
    writer: { provider: 'anthropic', model: writer, effort: clean(env.NEWS_STUDIO_WRITER_EFFORT) || 'medium', thinking: false, maxTokens: 8000, timeoutMs: 75000 },
    director: { provider: 'anthropic', model: clean(env.NEWS_STUDIO_DIRECTOR_MODEL) || writer, effort: clean(env.NEWS_STUDIO_DIRECTOR_EFFORT) || 'high', thinking: true, maxTokens: 16000, timeoutMs: 90000 },
    checker: { provider: 'anthropic', model: clean(env.NEWS_STUDIO_CHECKER_MODEL) || writer, effort: clean(env.NEWS_STUDIO_CHECKER_EFFORT) || 'high', thinking: true, maxTokens: 16000, timeoutMs: 75000 },
    reader: { provider: 'anthropic', model: clean(env.NEWS_STUDIO_READER_MODEL) || writer, effort: clean(env.NEWS_STUDIO_READER_EFFORT) || 'medium', thinking: false, maxTokens: 4000, timeoutMs: 60000 },
    analyzer: { provider: 'openai', model: clean(env.NEWS_STUDIO_ANALYZER_MODEL) || 'gpt-5.4-mini', maxTokens: 800, timeoutMs: 30000 },
    librarian: { provider: 'openai', model: clean(env.NEWS_STUDIO_LIBRARIAN_MODEL) || 'gpt-5.4-mini', maxTokens: 1500, timeoutMs: 30000 },
  };
}

function fail(errorType, message) {
  const err = new Error(message);
  err.errorType = errorType;
  return err;
}

/**
 * ตัวเรียก Claude แบบข้อความล้วน: รับ {system, user} คืนข้อความที่โมเดลตอบ (ไม่แปลง ไม่แทนคำ)
 * @param {object} p
 * @param {object} p.client  Anthropic SDK client (ไม่มี = โยน error บอกชัดว่าขาดคีย์ ตอนถูกเรียก)
 * @param {{model:string, effort:string, thinking:boolean, maxTokens:number, timeoutMs:number}} p.spec
 * @param {string} p.role  ชื่อบทบาท (ใช้ในข้อความ error และป้ายบันทึกการใช้งาน)
 * @param {(u:{provider,model,inputTokens,outputTokens,feature}) => any} [p.logUsage]  ล้มได้ ไม่ทำให้งานล้ม
 */
export function makeAnthropicCaller({ client, spec, role, logUsage, retryClock }) {
  return async function callAnthropic({ system, user }) {
    if (!client) throw fail('ANTHROPIC_KEY_MISSING', `เรียก${role}ไม่ได้: ระบบยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY`);
    const req = {
      model: spec.model,
      max_tokens: spec.maxTokens,
      output_config: { effort: spec.effort },
      system,
      messages: [{ role: 'user', content: user }],
    };
    if (spec.thinking) req.thinking = { type: 'adaptive' };
    let res;
    try {
      res = await callWithQuickRetry(() => client.messages.create(req, { timeout: spec.timeoutMs, maxRetries: 0 }), retryClock);
    } catch (e) {
      const status = e?.status ? ` (HTTP ${e.status})` : '';
      throw fail('MODEL_CALL_FAILED', `เรียก${role}ไม่สำเร็จ${status}: ${String(e?.message || e).slice(0, 160)}`);
    }
    try {
      const p = logUsage?.({ provider: 'anthropic', model: spec.model, inputTokens: res.usage?.input_tokens || 0, outputTokens: res.usage?.output_tokens || 0, feature: `newsStudio:${role}` });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* บันทึกการใช้งานพัง ไม่ทำให้งานเขียนพัง */ }
    if (res.stop_reason === 'refusal') throw fail('MODEL_REFUSED', `${role}ปฏิเสธคำขอ (${res.stop_details?.category || 'ไม่ระบุเหตุ'})`);
    if (res.stop_reason === 'max_tokens') throw fail('MODEL_OUTPUT_TRUNCATED', `คำตอบของ${role}ถูกตัดที่เพดานความยาว`);
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text.trim()) throw fail('MODEL_EMPTY', `${role}ตอบว่างเปล่า`);
    return text;
  };
}

/**
 * ตัวเรียก OpenAI แบบ JSON: รับข้อความคำถาม คืน object ที่ parse แล้ว (ไม่ยัด system ของท่อเดิม ไม่แทนคำ)
 */
export function makeOpenAIJsonCaller({ client, spec, role, logUsage, retryClock }) {
  return async function callOpenAIJson(prompt) {
    if (!client) throw fail('OPENAI_KEY_MISSING', `เรียก${role}ไม่ได้: ระบบยังไม่ได้ตั้งค่า OPENAI_API_KEY`);
    let res;
    try {
      res = await callWithQuickRetry(() => client.chat.completions.create({
        model: spec.model,
        messages: [{ role: 'user', content: String(prompt || '') }],
        max_completion_tokens: spec.maxTokens,
        response_format: { type: 'json_object' },
      }, { timeout: spec.timeoutMs, maxRetries: 0 }), retryClock);
    } catch (e) {
      const status = e?.status ? ` (HTTP ${e.status})` : '';
      throw fail('MODEL_CALL_FAILED', `เรียก${role}ไม่สำเร็จ${status}: ${String(e?.message || e).slice(0, 160)}`);
    }
    try {
      const p = logUsage?.({ provider: 'openai', model: spec.model, inputTokens: res.usage?.prompt_tokens || 0, outputTokens: res.usage?.completion_tokens || 0, feature: `newsStudio:${role}` });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* เหมือนข้างบน */ }
    const raw = res.choices?.[0]?.message?.content || '';
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') throw new Error('ไม่ใช่ object');
      return obj;
    } catch {
      throw fail('MODEL_BAD_JSON', `${role}ตอบมาไม่เป็น JSON ที่อ่านได้`);
    }
  };
}
