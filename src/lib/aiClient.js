// ============================================================
// [ระบบทำปกออโต้] สมอง AI — ตัวเรียกโมเดลวิเคราะห์ข่าว
// ------------------------------------------------------------
// เลือก provider อัตโนมัติจากคีย์ที่มีใน .env.local:
//   - ANTHROPIC_API_KEY  → Claude (ดีที่สุดด้านวิเคราะห์ข่าว, ค่าเริ่มต้น)
//   - OPENAI_API_KEY     → GPT
// ปรับ model ได้ผ่าน env: ANALYSIS_MODEL, ANALYSIS_PROVIDER
// ============================================================

import { withRetry } from './retry.js';
import { recordLLM } from './costStore.js';
import { logApiUsage } from './ai/usageLogger.js'; // ★ 7 ก.ค. อุดรูรั่วต้นทุน → /cost เห็นยอดจริง

const DEFAULTS = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
};

export function resolveProvider() {
  const forced = (process.env.ANALYSIS_PROVIDER || '').toLowerCase().trim();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (forced === 'anthropic') return hasAnthropic ? 'anthropic' : null;
  if (forced === 'openai') return hasOpenAI ? 'openai' : null;

  // อัตโนมัติ: Claude ก่อน แล้วค่อย OpenAI
  if (hasAnthropic) return 'anthropic';
  if (hasOpenAI) return 'openai';
  return null;
}

export function resolveModel(provider) {
  return process.env.ANALYSIS_MODEL || DEFAULTS[provider] || DEFAULTS.anthropic;
}

const MAX_FORCED_MODEL_LEN = 256; // ต้องตรงกับ MAX_PIN_MODEL_LEN ใน src/lib/s5PinnedAi.js
// ★ correction item 4 (round 2): model-identity string (forced pin / provider actual model) ต้อง exact
//   เป๊ะ — ห้าม trim/normalize เด็ดขาด มีช่องว่างหัว/ท้ายเมื่อไหร่ = invalid ทันที (ไม่ใช่ "ตัดขอบให้ใช้ได้")
const isExactModelStr = (v, maxLen) => typeof v === 'string' && v.length > 0 && v.length <= maxLen && v === v.trim();

// เรียกโมเดล — คืน { text, provider, model, actualModel, usage }
// cost: { step, caseId } → บันทึกต้นทุน (ไม่ส่ง = ไม่บันทึก)
// ★ 15 ก.ค. (Batch 5B1) — forceProvider/forceModel: ใช้เฉพาะสาย S5 strict pinned (s5PinnedAi.js) เพื่อ
//   บังคับ provider/model ตรง pin ที่ล็อกไว้แบบ exact — ข้าม resolveProvider()/resolveModel() (env) ไปเลย ·
//   ผู้เรียกเดิมทั้งหมด (ไม่ส่งทั้งสองค่านี้เลย) ได้พฤติกรรมเดิมทุก byte · ★ correction: ถ้าส่งมาเพียงค่าเดียว
//   หรือค่าใดค่าหนึ่งผิดรูปแบบ (ไม่ใช่ 'anthropic'/'openai' หรือ model ว่าง/ยาวเกิน) ⇒ throw INVALID_FORCED_PIN
//   ทันที — ห้าม fallback ไป resolve จาก env เงียบๆ เด็ดขาด (เดิมมีช่องโหว่: ส่งมาค่าเดียวจะหลุดไปเส้นทาง env)
// signal (optional): AbortSignal ส่งต่อให้ fetch จริงของ provider — ผู้เรียกเดิมไม่ส่ง = fetch ไม่มี signal เดิมเป๊ะ
// redactBody (optional): true = ตัด raw provider response body ออกจาก error message ทั้งหมด (สาย strict เท่านั้น)
// retries (optional, default เดิม 5) ให้สาย strict ปรับเป็น 1 ต่อการยิงจริงหนึ่งครั้ง
export async function callBrain({ system, user, maxTokens = 4000, temperature = 0.2, onRetry, cost, retries = 5, forceProvider, forceModel, signal, redactBody }) {
  let provider;
  let model;
  const forceAttempted = forceProvider !== undefined || forceModel !== undefined;
  if (forceAttempted) {
    const validForce = forceProvider === 'anthropic' || forceProvider === 'openai';
    // ★ correction item 4 (round 2): ปฏิเสธ forceModel ที่มีช่องว่างหัวท้าย — ห้าม trim ให้แล้วยอมรับ
    const validModel = isExactModelStr(forceModel, MAX_FORCED_MODEL_LEN);
    if (!validForce || !validModel) {
      const e = new Error('invalid or partial forced pin (forceProvider/forceModel must both be present, exact, and valid)');
      e.errorType = 'INVALID_FORCED_PIN';
      throw e;
    }
    const hasKey = forceProvider === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENAI_API_KEY;
    if (!hasKey) {
      const e = new Error(
        'ยังไม่ได้ตั้งคีย์ AI — ใส่ ANTHROPIC_API_KEY (หรือ OPENAI_API_KEY) ในไฟล์ .env.local ของโปรเจกต์นี้'
      );
      e.errorType = 'NO_API_KEY';
      throw e;
    }
    provider = forceProvider;
    model = forceModel; // ★ ไม่ trim — ใช้ตรงๆ (ผ่านเช็คแล้วว่าไม่มีช่องว่างหัวท้าย)
  } else {
    provider = resolveProvider();
    if (!provider) {
      const e = new Error(
        'ยังไม่ได้ตั้งคีย์ AI — ใส่ ANTHROPIC_API_KEY (หรือ OPENAI_API_KEY) ในไฟล์ .env.local ของโปรเจกต์นี้'
      );
      e.errorType = 'NO_API_KEY';
      throw e;
    }
    model = resolveModel(provider);
  }

  // retry กัน AI overloaded (529/503/429) — ถ้ายังพลาดค่อยล้มแบบสะอาด
  const r = await withRetry(
    () =>
      provider === 'anthropic'
        ? callAnthropic({ system, user, model, maxTokens, temperature, signal, redactBody })
        : callOpenAI({ system, user, model, maxTokens, temperature, signal, redactBody }),
    { retries, onAttempt: onRetry }
  );
  if (cost) await recordLLM({ provider: r.provider, model: r.model, usage: r.usage, step: cost.step, caseId: cost.caseId });
  // ★ 7 ก.ค. อุดรูรั่วต้นทุน: recordLLM เขียนลง costStore ที่ /cost ไม่อ่าน (ตายด้าน) → log เข้า api_usage_logs
  //   ด้วยตัวเดียวกับ openai/claudeClient (error-safe ในตัว) — คง recordLLM ไว้ตามเดิม
  try {
    const u = r.usage || {};
    await logApiUsage({
      provider: r.provider, model: r.model,
      inputTokens: u.input_tokens ?? u.prompt_tokens ?? 0,
      outputTokens: u.output_tokens ?? u.completion_tokens ?? 0,
      feature: cost?.step || 'ai-client',
    });
  } catch { /* log ล้มไม่กระทบท่อ */ }
  return r;
}

async function callAnthropic({ system, user, model, maxTokens, temperature, signal, redactBody }) {
  const payload = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  // โมเดลรุ่นใหม่ (claude 5 / opus-4-8) เลิกรับ temperature แล้ว
  // ส่งเฉพาะเมื่อ opt-in ผ่าน env สำหรับโมเดลรุ่นเก่าที่ยังต้องการ
  if (process.env.ANALYSIS_SEND_TEMPERATURE === '1' && typeof temperature === 'number') {
    payload.temperature = temperature;
  }

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    // ★ correction (round 4): ห้ามอ่าน/reflect err เลย — instanceof เดินพรอโทไทป์เชนทั้งสาย แม้ err เองไม่ใช่
    //   Proxy ก็ยังโดน getPrototypeOf trap ของ Proxy ที่ซ้อนอยู่ลึกกว่าในเชนได้ (พิสูจน์แล้วว่า instanceof ไม่
    //   trap-free จริง) · ใช้สถานะของ signal ที่เราถืออยู่เอง (ไม่ใช่ err — ไม่มีทางเป็นค่าไม่น่าเชื่อถือ เพราะเป็น
    //   signal ที่ s5PinnedAi.js สร้าง/ส่งมาเองเสมอ หรือไม่ก็ undefined) ตัดสินแทน: signal.aborted จริง = ยิง
    //   cancellation จริง → map เป็น ABORTED เสมอ · ไม่งั้น rethrow err ดิบเป๊ะ ไม่แตะเลยแม้แต่ byte เดียว
    //   (พฤติกรรมเดิม/non-strict เดิมทุกอย่าง — ผู้เรียกเดิมไม่ส่ง signal เลย = signal?.aborted เป็น undefined
    //   เสมอ ⇒ rethrow err ดิบเหมือนเดิมทุกกรณี)
    if (signal?.aborted) {
      const e = new Error('Anthropic API call aborted — request timed out');
      e.errorType = 'ABORTED';
      throw e;
    }
    throw err;
  }

  if (!res.ok) {
    // ★ correction item 7: redactBody=true (สาย strict เท่านั้น) = ไม่มี raw provider response body ใน error message
    let message = `Anthropic API error ${res.status}`;
    if (!redactBody) {
      const body = await res.text();
      message += `: ${truncate(body, 400)}`;
    }
    const e = new Error(message);
    e.status = res.status;
    e.errorType = res.status === 529 || res.status >= 500 || res.status === 429 ? 'AI_BUSY' : 'PROVIDER_ERROR';
    throw e;
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // ★ 15 ก.ค. (Batch 5B1 + correction item 4 round 2): actualModel = ค่า data.model ที่ Anthropic ตอบกลับ
  //   จริง เก็บแบบ verbatim (ไม่ trim) — self-report ของ provider เอง ไม่ใช่ข้อพิสูจน์ cryptographic ·
  //   blank/มีช่องว่างหัวท้าย/ผิดชนิด/ยาวเกิน = ถือว่า "ไม่มี" (null) ไม่ใช่ตัดขอบให้ใช้ได้
  const actualModel = isExactModelStr(data.model, MAX_FORCED_MODEL_LEN) ? data.model : null;
  return { text, provider: 'anthropic', model, actualModel, usage: data.usage || null };
}

async function callOpenAI({ system, user, model, maxTokens, temperature, signal, redactBody }) {
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal,
    });
  } catch (err) {
    // ★ correction (round 4): ห้ามอ่าน/reflect err เลย — ใช้สถานะ signal ที่เราถืออยู่เองตัดสินแทน (ดูคำอธิบาย
    //   เต็มใน callAnthropic ด้านบน) · signal.aborted จริง = ABORTED เสมอ · ไม่งั้น rethrow err ดิบเป๊ะ
    if (signal?.aborted) {
      const e = new Error('OpenAI API call aborted — request timed out');
      e.errorType = 'ABORTED';
      throw e;
    }
    throw err;
  }

  if (!res.ok) {
    // ★ correction item 7: redactBody=true (สาย strict เท่านั้น) = ไม่มี raw provider response body ใน error message
    let message = `OpenAI API error ${res.status}`;
    if (!redactBody) {
      const body = await res.text();
      message += `: ${truncate(body, 400)}`;
    }
    const e = new Error(message);
    e.status = res.status;
    e.errorType = res.status >= 500 || res.status === 429 ? 'AI_BUSY' : 'PROVIDER_ERROR';
    throw e;
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  // ★ 15 ก.ค. (Batch 5B1 + correction item 4 round 2): actualModel = ค่า data.model ที่ OpenAI ตอบกลับ
  //   จริง เก็บแบบ verbatim (ไม่ trim) — self-report ของ provider เอง ไม่ใช่ข้อพิสูจน์ cryptographic ·
  //   blank/มีช่องว่างหัวท้าย/ผิดชนิด/ยาวเกิน = ถือว่า "ไม่มี" (null) ไม่ใช่ตัดขอบให้ใช้ได้
  const actualModel = isExactModelStr(data.model, MAX_FORCED_MODEL_LEN) ? data.model : null;
  return { text, provider: 'openai', model, actualModel, usage: data.usage || null };
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
