/**
 * ☁️ scripts/research-agent/apiFallback.mjs — สมองสำรองโหมด API (SPEC-v2 ส่วน 4 · ข้อ 19 แผนสำรอง)
 * ─────────────────────────────────────────────────────────────────────────────
 * ใช้เมื่อ RESEARCH_AGENT_BRAIN=api หรือ Codex ล้ม/โควตาหมดทุกบัญชี:
 *   OpenAI Responses API · gpt-6-astra · reasoning low · เครื่องมือ web_search อย่างเดียว (ไม่มีเบราว์เซอร์/เชลล์/ไฟล์)
 *   แบบเดียวกับ tools/web-agent.mjs ของแล็บ → ผลเป็น JSON ตามสัญญาเดียวกัน → normalize/gate เหมือนผล Codex
 *   tool_log: รายการแรก 'api-fallback' (หมายเหตุมีจำนวนค้น/โทเคน) + web_search ทีละครั้ง · ค่าเงินจริงจากโทเคนคืนใน meta.costUsd
 *   (worker บวกเข้า usage.costUsd เอง — รายการ tool_log คงรูป {tool,args,ok,note,ms} ตามสัญญา 2.2)
 * ⚠️ โหมดนี้เสียเงิน API จริง (ไม่ใช่โควตา subscription) — คิดค่าใน usage.costUsd เสมอ
 * ไม่โยน error · ฉีด fetchImpl/now ได้ (เทสไม่ยิงจริง) · ห้ามพิมพ์คีย์ (ข้อความ error ผ่าน redactSecrets)
 */
import { extractJson } from './codexRunner.mjs';
import { modelCostUsd, API_WEB_SEARCH_PER_CALL_USD } from './pricing.mjs';
import { redactSecrets } from './schema.mjs';

export const API_URL = 'https://api.openai.com/v1/responses';
export const API_MODEL = 'gpt-6-astra';

/** ประกอบ body ของคำขอ (แยกไว้ให้เทสตรวจได้) */
export function buildApiRequest({ prompt, model = API_MODEL, effort = 'low', maxOutputTokens = 12000 }) {
  return {
    model,
    reasoning: { effort: effort === 'medium' ? 'medium' : 'low' },
    tools: [{ type: 'web_search' }],
    input: String(prompt || ''),
    max_output_tokens: maxOutputTokens,
  };
}

/** ดึงข้อความคำตอบ + รายการ web_search จากซอง Responses API */
export function parseApiResponse(j) {
  const output = Array.isArray(j && j.output) ? j.output : [];
  const text = output.flatMap((o) => (Array.isArray(o.content) ? o.content : []))
    .filter((c) => c && c.type === 'output_text').map((c) => String(c.text || '')).join('\n');
  const searches = output.filter((o) => o && o.type === 'web_search_call').map((o) => {
    const action = o.action || {};
    const q = action.query || (Array.isArray(action.queries) ? action.queries.join(' | ') : '') || action.url || '';
    return { query: String(q).slice(0, 200), ok: o.status ? o.status === 'completed' : true };
  });
  const usage = j && j.usage ? j.usage : {};
  return {
    text,
    searches,
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
  };
}

/**
 * เรียกสมองสำรอง 1 รอบ — ไม่โยน error
 * @param {object} p
 * @param {string} p.prompt         ใบงานแบบ brainKind 'api' (taskBuilder)
 * @param {string} p.apiKey         OPENAI_API_KEY (worker อ่านจาก env — ห้ามพิมพ์)
 * @param {number} p.timeoutMs
 * @param {'low'|'medium'} [p.effort]
 * @param {string[]} [p.secretValues]
 * @param {object} [deps] { fetchImpl, now }
 */
export async function runApiFallback(p, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const now = deps.now || Date.now;
  const t0 = now();
  const secrets = [...((p && p.secretValues) || []), (p && p.apiKey) || ''];
  const base = { brain: 'api', model: API_MODEL, effort: p && p.effort === 'medium' ? 'medium' : 'low', account: 'api' };
  const fail = (errorType, error, extra = {}) => ({
    ok: false, ...base, errorType, error: redactSecrets(String(error || errorType), secrets).slice(0, 400), elapsedMs: now() - t0, json: null, ...extra,
  });
  try {
    if (!p || !p.apiKey) return fail('API_NO_KEY', 'ไม่มี OPENAI_API_KEY สำหรับโหมดสำรอง');
    if (!String(p.prompt || '').trim()) return fail('API_BAD_ARGS', 'ใบงานว่าง');
    const timeoutMs = Math.max(10_000, Number(p.timeoutMs) || 5 * 60_000);
    let r;
    let j = null;
    try {
      r = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildApiRequest({ prompt: p.prompt, effort: base.effort })),
        signal: AbortSignal.timeout(timeoutMs),
      });
      try { j = await r.json(); } catch { j = null; }
    } catch (e) {
      const name = String((e && e.name) || '');
      return fail(/Timeout|Abort/i.test(name) ? 'API_TIMEOUT' : 'API_NETWORK', (e && e.message) || e);
    }
    if (!r.ok) {
      const msg = j && j.error ? `${j.error.code || r.status} ${j.error.message || ''}` : `HTTP ${r.status}`;
      return fail(r.status === 429 ? 'API_QUOTA' : (r.status === 401 || r.status === 403 ? 'API_AUTH' : 'API_HTTP'), msg, { httpStatus: r.status });
    }
    const parsed = parseApiResponse(j);
    const tokenCost = modelCostUsd(API_MODEL, parsed.inputTokens, parsed.outputTokens);
    const searchCost = Math.round(parsed.searches.length * API_WEB_SEARCH_PER_CALL_USD * 10000) / 10000;
    const elapsedMs = now() - t0;
    const toolLog = [
      {
        tool: 'api-fallback', args: `${API_MODEL} ${base.effort} + web_search`, ok: true,
        note: `โหมดสำรอง API · ค้น ${parsed.searches.length} ครั้ง · โทเคน ${parsed.inputTokens}/${parsed.outputTokens}`,
        ms: elapsedMs,
      },
      ...parsed.searches.map((s) => ({ tool: 'web_search', args: redactSecrets(s.query, secrets), ok: s.ok, note: 'api-fallback', ms: null })),
    ];
    const json = extractJson(parsed.text);
    const meta = {
      elapsedMs, tokensUsed: parsed.inputTokens + parsed.outputTokens, costUsd: Math.round((tokenCost + searchCost) * 10000) / 10000,
      apiToolLog: toolLog, searches: parsed.searches.length,
    };
    if (!json) return fail('API_BAD_JSON', 'คำตอบโหมด API ไม่มี JSON', meta);
    // tool_log = บันทึกจริงจากซอง API เท่านั้น (ที่โมเดลจดเองซ้ำกับของจริง → นับงบเพี้ยน จึงไม่ใช้)
    return { ok: true, ...base, json: { ...json, tool_log: toolLog }, ...meta };
  } catch (e) {
    return fail('API_INTERNAL', (e && e.message) || e);
  }
}
