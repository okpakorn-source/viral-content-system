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

// เรียกโมเดล — คืน { text, provider, model, usage }
// cost: { step, caseId } → บันทึกต้นทุน (ไม่ส่ง = ไม่บันทึก)
export async function callBrain({ system, user, maxTokens = 4000, temperature = 0.2, onRetry, cost }) {
  const provider = resolveProvider();
  if (!provider) {
    const e = new Error(
      'ยังไม่ได้ตั้งคีย์ AI — ใส่ ANTHROPIC_API_KEY (หรือ OPENAI_API_KEY) ในไฟล์ .env.local ของโปรเจกต์นี้'
    );
    e.errorType = 'NO_API_KEY';
    throw e;
  }
  const model = resolveModel(provider);

  // retry กัน AI overloaded (529/503/429) — ถ้ายังพลาดค่อยล้มแบบสะอาด
  const r = await withRetry(
    () =>
      provider === 'anthropic'
        ? callAnthropic({ system, user, model, maxTokens, temperature })
        : callOpenAI({ system, user, model, maxTokens, temperature }),
    { retries: 5, onAttempt: onRetry }
  );
  if (cost) await recordLLM({ provider: r.provider, model: r.model, usage: r.usage, step: cost.step, caseId: cost.caseId });
  return r;
}

async function callAnthropic({ system, user, model, maxTokens, temperature }) {
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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    const e = new Error(`Anthropic API error ${res.status}: ${truncate(body, 400)}`);
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

  return { text, provider: 'anthropic', model, usage: data.usage || null };
}

async function callOpenAI({ system, user, model, maxTokens, temperature }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
  });

  if (!res.ok) {
    const body = await res.text();
    const e = new Error(`OpenAI API error ${res.status}: ${truncate(body, 400)}`);
    e.status = res.status;
    e.errorType = res.status >= 500 || res.status === 429 ? 'AI_BUSY' : 'PROVIDER_ERROR';
    throw e;
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  return { text, provider: 'openai', model, usage: data.usage || null };
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
