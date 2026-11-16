/**
 * =====================================================
 * Multi-Model Callers — ตัวเรียกโมเดลสำหรับ News Studio (Plan B: Gemini 4 Carbon + Argon + Hydrogen + GPT-5.6-Sol)
 * =====================================================
 * รองรับ:
 *   1. Google Gemini API (gemini-4-carbon, gemini-4-argon, gemini-4-hydrogen, gemini-3.1-pro-preview)
 *   2. OpenAI Responses / Chat API (gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.3-codex, gpt-5.4)
 *   3. Anthropic Claude (claude-opus-5-5, claude-fable-5-2)
 *
 * อ่านคีย์จาก process.env (บน Vercel / เซิร์ฟเวอร์จริง) และ fallback อ่านจาก .env / .env.local
 */
import fs from 'fs';
import path from 'path';

const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '');

export function loadStudioEnv(rootDir) {
  const out = {};
  const resolvedRoot = rootDir || process.cwd();
  for (const name of ['.env', '.env.local']) {
    try {
      const p = path.join(resolvedRoot, name);
      if (!fs.existsSync(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
        if (m) out[m[1]] = clean(m[2]);
      }
    } catch { /* บน serverless อาจไม่มีไฟล์ .env บนดิสก์ */ }
  }
  // ให้ process.env ทับค่าว่างหรือเติมคีย์ที่ตั้งผ่านระบบโฮสต์ (เช่น Vercel)
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SERPER_API_KEY', 'TAVILY_API_KEY', 'NEWS_STUDIO_PLAN', 'NEWS_STUDIO_DISCORD']) {
    if (clean(process.env?.[k])) out[k] = clean(process.env[k]);
  }
  return out;
}

export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch {
        const cleaned = s.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(cleaned);
      }
    }
    throw new Error(`แปลง JSON ไม่สำเร็จ: ${s.slice(0, 140)}`);
  }
}

async function withRetry(fn, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

export function createMultiModelHub(env = loadStudioEnv(), { logUsage } = {}) {
  const anthropicKey = clean(env.ANTHROPIC_API_KEY || process.env?.ANTHROPIC_API_KEY);
  const openaiKey = clean(env.OPENAI_API_KEY || process.env?.OPENAI_API_KEY);
  const geminiKey = clean(env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || process.env?.GEMINI_API_KEY || process.env?.GOOGLE_AI_API_KEY);

  const safeLog = (payload) => {
    try {
      const p = logUsage?.(payload);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ห้ามให้ logUsage ทำให้งานเขียนล้ม */ }
  };

  /** เรียก Anthropic Claude (claude-opus-5-5 / claude-fable-5-2) */
  async function callClaude({ model = 'claude-opus-5-5', system = '', user = '', maxTokens = 8000, thinking = false, effort = 'medium', json = false, timeoutMs = 95000, role = 'claude' }) {
    if (!anthropicKey) throw new Error('ไม่มี ANTHROPIC_API_KEY');
    return withRetry(async () => {
      const body = {
        model,
        max_tokens: maxTokens,
        output_config: { effort },
        messages: [{ role: 'user', content: String(user || '') }],
      };
      if (system) body.system = String(system);
      if (thinking) body.thinking = { type: 'adaptive' };

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Claude ${model} HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 140)}`);
        safeLog({ provider: 'anthropic', model, inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, feature: `newsStudio:${role}` });
        if (data.stop_reason === 'max_tokens') throw new Error(`Claude ${model} ถูกตัดที่เพดาน max_tokens (${maxTokens})`);
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!text) throw new Error(`Claude ${model} ตอบว่างเปล่า`);
        return json ? extractJson(text) : text;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /** เรียก OpenAI (gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.3-codex, gpt-5.4) ผ่าน /v1/responses */
  async function callOpenAI({ model = 'gpt-5.6-sol', system = '', user = '', maxTokens = 8000, effort = 'medium', json = false, timeoutMs = 95000, role = 'openai' }) {
    if (!openaiKey) throw new Error('ไม่มี OPENAI_API_KEY');
    return withRetry(async () => {
      const input = [];
      if (system) input.push({ role: 'system', content: String(system) });
      input.push({ role: 'user', content: String(user || '') });

      const body = {
        model,
        input,
        max_output_tokens: maxTokens,
      };
      if (effort && (model.includes('5.6') || model.includes('codex') || model.includes('o3'))) {
        body.reasoning = { effort };
      }
      if (json) {
        body.text = { format: { type: 'json_object' } };
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`OpenAI ${model} HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 140)}`);
        safeLog({ provider: 'openai', model, inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, feature: `newsStudio:${role}` });
        let text = data.output_text || '';
        if (!text && Array.isArray(data.output)) {
          text = data.output
            .flatMap((o) => o.content || [])
            .filter((c) => c.type === 'output_text' || c.type === 'text')
            .map((c) => c.text || '')
            .join('')
            .trim();
        }
        if (!text) throw new Error(`OpenAI ${model} ตอบว่างเปล่า`);
        return json ? extractJson(text) : text;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /** เรียก Google Gemini (gemini-4-carbon, gemini-4-argon, gemini-4-hydrogen, gemini-3.1-pro-preview) */
  async function callGemini({ model = 'gemini-4-carbon', system = '', user = '', maxTokens = 16384, thinkingBudget = 3072, json = false, timeoutMs = 180000, role = 'gemini' }) {
    if (!geminiKey) {
      const err = new Error('ระบบยังไม่ได้ตั้งค่า GEMINI_API_KEY');
      err.errorType = 'GEMINI_KEY_MISSING';
      throw err;
    }
    const isG4 = /gemini-4/i.test(model);
    const effectiveMaxTokens = isG4 ? Math.max(16384, maxTokens) : maxTokens;
    return withRetry(async () => {
      const generationConfig = {
        maxOutputTokens: effectiveMaxTokens,
        temperature: 0.35,
      };
      if (isG4 && thinkingBudget > 0) {
        generationConfig.thinkingConfig = { thinkingBudget };
      }
      if (json) {
        generationConfig.responseMimeType = 'application/json';
      }
      const body = {
        contents: [{ role: 'user', parts: [{ text: String(user || '') }] }],
        generationConfig,
      };
      if (system) {
        body.systemInstruction = { parts: [{ text: String(system) }] };
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 140)}`);
        safeLog({
          provider: 'gemini',
          model,
          inputTokens: data.usageMetadata?.promptTokenCount || 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
          feature: `newsStudio:${role}`,
        });
        const text = (data.candidates?.[0]?.content?.parts || [])
          .filter((p) => !p.thought && typeof p.text === 'string')
          .map((p) => p.text)
          .join('')
          .trim();
        if (!text) throw new Error(`Gemini ${model} ตอบว่างเปล่า`);
        return json ? extractJson(text) : text;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  return { callClaude, callOpenAI, callGemini };
}
