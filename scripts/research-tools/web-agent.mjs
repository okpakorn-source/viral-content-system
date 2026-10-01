// 🕵️ web-agent — "นักค้นคนที่สอง": GPT-6 Astra (low) + web_search ผ่าน OpenAI Responses API (~10–20 วิ · เสียเงิน API)
// ใช้: node tools/web-agent.mjs "โจทย์/คำถาม"      (โจทย์ภาษาไทยยาว → --input out/q.json {"q":"..."})
// คืน JSON: {ok, tool, text, searches, cites[], usage} · ใช้ไม่เกิน 2 ครั้งต่องาน · ใช้เทียบผล/หาสิ่งที่ค้นเองไม่เจอ
// คีย์ (ยืนยัน 1 ต.ค. 69 · เทส research-agent-tools ข้อ 7b/7c): worker "ไม่ส่ง" OPENAI_API_KEY ให้ Codex (codexRunner ตัดทิ้ง
//   กัน Codex คิดเงินแบบ API แทนโควตา subscription) → ที่นี่ ensureKeys อ่านเฉพาะชื่อนี้จาก <ราก repo>/.env.local เอง
//   ราก = RESEARCH_TOOLS_REPO_ROOT (worker ส่ง) → ไฟล์ .repo-root (โหมดสำเนา) → สองชั้นเหนือ _common.mjs ตัวจริง (โหมด junction)
//   ⇒ คีย์ต้องอยู่ใน .env.local ของ repo ที่รัน worker (ตั้งเป็น env ระบบอย่างเดียว = เครื่องมือนี้ตอบ NO_KEY)
import { ensureKeys, fetchJson, parseArgs, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/web-agent.mjs "โจทย์" | --input out/q.json ({"q":"..."})';
export const MODEL = 'gpt-6-astra';

export async function run(argv, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const a = parseArgs(argv, { options: ['q'] });
  const q = String(a.q || a._.join(' ')).trim();
  if (!q) throw new UsageError('ต้องมีโจทย์');
  if (ensureKeys(['OPENAI_API_KEY'], { env }).length) return { ok: false, tool: 'web-agent', errorType: 'NO_KEY', error: 'ไม่มี OPENAI_API_KEY' };
  const r = await fetchJson(fetchImpl, 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: 'low' },
      tools: [{ type: 'web_search' }],
      input: `${q.slice(0, 4000)}\n\nตอบสั้น เป็นข้อ พร้อม URL และวันที่ของแหล่งทุกข้อ ถ้าไม่พบให้บอกว่าไม่พบ ห้ามเดา`,
      max_output_tokens: 1500,
    }),
    timeoutMs: 90_000,
  });
  const j = r.data || {};
  if (!r.ok) return { ok: false, tool: 'web-agent', errorType: 'HTTP', error: `openai http ${r.status} ${String((j.error && j.error.message) || '').slice(0, 200)}` };
  const output = Array.isArray(j.output) ? j.output : [];
  const content = output.flatMap((o) => (Array.isArray(o.content) ? o.content : []));
  const text = content.filter((c) => c.type === 'output_text').map((c) => c.text).join('\n');
  const searches = output.filter((o) => o.type === 'web_search_call').length;
  const cites = [...new Set(content.flatMap((c) => c.annotations || []).filter((x) => x.type === 'url_citation').map((x) => x.url))];
  const usage = j.usage ? { input_tokens: j.usage.input_tokens || 0, output_tokens: j.usage.output_tokens || 0 } : null;
  return { ok: true, tool: 'web-agent', model: MODEL, text, searches, cites, usage };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
